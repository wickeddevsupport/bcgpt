import type { ChannelAccountSnapshot } from "../channels/plugins/types.js";
import type { OpenClawConfig } from "../config/config.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveChannelDefaultAccountId } from "../channels/plugins/helpers.js";
import { type ChannelId, getChannelPlugin, listChannelPlugins } from "../channels/plugins/index.js";
import { formatErrorMessage } from "../infra/errors.js";
import { resetDirectoryCache } from "../infra/outbound/target-resolver.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

export type ChannelRuntimeSnapshot = {
  channels: Partial<Record<ChannelId, ChannelAccountSnapshot>>;
  channelAccounts: Partial<Record<ChannelId, Record<string, ChannelAccountSnapshot>>>;
};

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

type ChannelRuntimeStore = {
  aborts: Map<string, AbortController>;
  tasks: Map<string, Promise<unknown>>;
  runtimes: Map<string, ChannelAccountSnapshot>;
};

type ChannelScopeOptions = {
  scopeKey?: string;
  cfg?: OpenClawConfig;
};

const GLOBAL_SCOPE_KEY = "__global__";

function normalizeScopeKey(scopeKey?: string): string {
  const trimmed = scopeKey?.trim();
  return trimmed ? trimmed : GLOBAL_SCOPE_KEY;
}

function toScopedAccountKey(scopeKey: string, accountId: string): string {
  return `${scopeKey}::${accountId}`;
}

function createRuntimeStore(): ChannelRuntimeStore {
  return {
    aborts: new Map(),
    tasks: new Map(),
    runtimes: new Map(),
  };
}

function isAccountEnabled(account: unknown): boolean {
  if (!account || typeof account !== "object") {
    return true;
  }
  const enabled = (account as { enabled?: boolean }).enabled;
  return enabled !== false;
}

function resolveDefaultRuntime(channelId: ChannelId): ChannelAccountSnapshot {
  const plugin = getChannelPlugin(channelId);
  return plugin?.status?.defaultRuntime ?? { accountId: DEFAULT_ACCOUNT_ID };
}

function cloneDefaultRuntime(channelId: ChannelId, accountId: string): ChannelAccountSnapshot {
  return { ...resolveDefaultRuntime(channelId), accountId };
}

type ChannelManagerOptions = {
  loadConfig: () => OpenClawConfig;
  channelLogs: Record<ChannelId, SubsystemLogger>;
  channelRuntimeEnvs: Record<ChannelId, RuntimeEnv>;
};

export type ChannelManager = {
  getRuntimeSnapshot: (opts?: ChannelScopeOptions) => ChannelRuntimeSnapshot;
  startChannels: () => Promise<void>;
  startChannel: (channel: ChannelId, accountId?: string, opts?: ChannelScopeOptions) => Promise<void>;
  stopChannel: (channel: ChannelId, accountId?: string, opts?: ChannelScopeOptions) => Promise<void>;
  markChannelLoggedOut: (
    channelId: ChannelId,
    cleared: boolean,
    accountId?: string,
    opts?: ChannelScopeOptions,
  ) => void;
};

// Channel docking: lifecycle hooks (`plugin.gateway`) flow through this manager.
export function createChannelManager(opts: ChannelManagerOptions): ChannelManager {
  const { loadConfig, channelLogs, channelRuntimeEnvs } = opts;

  const channelStores = new Map<ChannelId, ChannelRuntimeStore>();

  const getStore = (channelId: ChannelId): ChannelRuntimeStore => {
    const existing = channelStores.get(channelId);
    if (existing) {
      return existing;
    }
    const next = createRuntimeStore();
    channelStores.set(channelId, next);
    return next;
  };

  const getRuntime = (
    channelId: ChannelId,
    accountId: string,
    scopeKey = GLOBAL_SCOPE_KEY,
  ): ChannelAccountSnapshot => {
    const store = getStore(channelId);
    return (
      store.runtimes.get(toScopedAccountKey(scopeKey, accountId)) ??
      cloneDefaultRuntime(channelId, accountId)
    );
  };

  const setRuntime = (
    channelId: ChannelId,
    accountId: string,
    patch: ChannelAccountSnapshot,
    scopeKey = GLOBAL_SCOPE_KEY,
  ): ChannelAccountSnapshot => {
    const store = getStore(channelId);
    const current = getRuntime(channelId, accountId, scopeKey);
    const next = { ...current, ...patch, accountId };
    store.runtimes.set(toScopedAccountKey(scopeKey, accountId), next);
    return next;
  };

  const startChannel = async (channelId: ChannelId, accountId?: string, opts?: ChannelScopeOptions) => {
    const plugin = getChannelPlugin(channelId);
    const startAccount = plugin?.gateway?.startAccount;
    if (!startAccount) {
      return;
    }
    const scopeKey = normalizeScopeKey(opts?.scopeKey);
    const cfg = opts?.cfg ?? loadConfig();
    resetDirectoryCache({ channel: channelId, accountId });
    const store = getStore(channelId);
    const accountIds = accountId ? [accountId] : plugin.config.listAccountIds(cfg);
    if (accountIds.length === 0) {
      return;
    }

    await Promise.all(
      accountIds.map(async (id) => {
        const scopedAccountKey = toScopedAccountKey(scopeKey, id);
        if (store.tasks.has(scopedAccountKey)) {
          return;
        }
        const account = plugin.config.resolveAccount(cfg, id);
        const enabled = plugin.config.isEnabled
          ? plugin.config.isEnabled(account, cfg)
          : isAccountEnabled(account);
        if (!enabled) {
          setRuntime(channelId, id, {
            accountId: id,
            running: false,
            lastError: plugin.config.disabledReason?.(account, cfg) ?? "disabled",
          }, scopeKey);
          return;
        }

        let configured = true;
        if (plugin.config.isConfigured) {
          configured = await plugin.config.isConfigured(account, cfg);
        }
        if (!configured) {
          setRuntime(channelId, id, {
            accountId: id,
            running: false,
            lastError: plugin.config.unconfiguredReason?.(account, cfg) ?? "not configured",
          }, scopeKey);
          return;
        }

        const abort = new AbortController();
        store.aborts.set(scopedAccountKey, abort);
        setRuntime(channelId, id, {
          accountId: id,
          running: true,
          lastStartAt: Date.now(),
          lastError: null,
        }, scopeKey);

        const log = channelLogs[channelId];
        const task = startAccount({
          cfg,
          accountId: id,
          account,
          runtime: channelRuntimeEnvs[channelId],
          abortSignal: abort.signal,
          log,
          getStatus: () => getRuntime(channelId, id, scopeKey),
          setStatus: (next) => setRuntime(channelId, id, next, scopeKey),
        });
        const tracked = Promise.resolve(task)
          .catch((err) => {
            const message = formatErrorMessage(err);
            setRuntime(channelId, id, { accountId: id, lastError: message }, scopeKey);
            log.error?.(`[${id}] channel exited: ${message}`);
          })
          .finally(() => {
            store.aborts.delete(scopedAccountKey);
            store.tasks.delete(scopedAccountKey);
            setRuntime(channelId, id, {
              accountId: id,
              running: false,
              lastStopAt: Date.now(),
            }, scopeKey);
          });
        store.tasks.set(scopedAccountKey, tracked);
      }),
    );
  };

  const stopChannel = async (channelId: ChannelId, accountId?: string, opts?: ChannelScopeOptions) => {
    const plugin = getChannelPlugin(channelId);
    const scopeKey = normalizeScopeKey(opts?.scopeKey);
    const cfg = opts?.cfg ?? loadConfig();
    const store = getStore(channelId);
    const knownIds = new Set<string>([
      ...(plugin ? plugin.config.listAccountIds(cfg) : []),
    ]);
    if (accountId) {
      knownIds.clear();
      knownIds.add(accountId);
    }

    await Promise.all(
      Array.from(knownIds.values()).map(async (id) => {
        const scopedAccountKey = toScopedAccountKey(scopeKey, id);
        const abort = store.aborts.get(scopedAccountKey);
        const task = store.tasks.get(scopedAccountKey);
        if (!abort && !task && !plugin?.gateway?.stopAccount) {
          return;
        }
        abort?.abort();
        if (plugin?.gateway?.stopAccount) {
          const account = plugin.config.resolveAccount(cfg, id);
          await plugin.gateway.stopAccount({
            cfg,
            accountId: id,
            account,
            runtime: channelRuntimeEnvs[channelId],
            abortSignal: abort?.signal ?? new AbortController().signal,
            log: channelLogs[channelId],
            getStatus: () => getRuntime(channelId, id, scopeKey),
            setStatus: (next) => setRuntime(channelId, id, next, scopeKey),
          });
        }
        try {
          await task;
        } catch {
          // ignore
        }
        store.aborts.delete(scopedAccountKey);
        store.tasks.delete(scopedAccountKey);
        setRuntime(channelId, id, {
          accountId: id,
          running: false,
          lastStopAt: Date.now(),
        }, scopeKey);
      }),
    );
  };

  const startChannels = async () => {
    for (const plugin of listChannelPlugins()) {
      await startChannel(plugin.id);
    }
  };

  const markChannelLoggedOut = (
    channelId: ChannelId,
    cleared: boolean,
    accountId?: string,
    opts?: ChannelScopeOptions,
  ) => {
    const plugin = getChannelPlugin(channelId);
    if (!plugin) {
      return;
    }
    const scopeKey = normalizeScopeKey(opts?.scopeKey);
    const cfg = opts?.cfg ?? loadConfig();
    const resolvedId =
      accountId ??
      resolveChannelDefaultAccountId({
        plugin,
        cfg,
      });
    const current = getRuntime(channelId, resolvedId, scopeKey);
    const next: ChannelAccountSnapshot = {
      accountId: resolvedId,
      running: false,
      lastError: cleared ? "logged out" : current.lastError,
    };
    if (typeof current.connected === "boolean") {
      next.connected = false;
    }
    setRuntime(channelId, resolvedId, next, scopeKey);
  };

  const getRuntimeSnapshot = (opts?: ChannelScopeOptions): ChannelRuntimeSnapshot => {
    const scopeKey = normalizeScopeKey(opts?.scopeKey);
    const cfg = opts?.cfg ?? loadConfig();
    const channels: ChannelRuntimeSnapshot["channels"] = {};
    const channelAccounts: ChannelRuntimeSnapshot["channelAccounts"] = {};
    for (const plugin of listChannelPlugins()) {
      const store = getStore(plugin.id);
      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId = resolveChannelDefaultAccountId({
        plugin,
        cfg,
        accountIds,
      });
      const accounts: Record<string, ChannelAccountSnapshot> = {};
      for (const id of accountIds) {
        const account = plugin.config.resolveAccount(cfg, id);
        const enabled = plugin.config.isEnabled
          ? plugin.config.isEnabled(account, cfg)
          : isAccountEnabled(account);
        const described = plugin.config.describeAccount?.(account, cfg);
        const configured = described?.configured;
        const current =
          store.runtimes.get(toScopedAccountKey(scopeKey, id)) ?? cloneDefaultRuntime(plugin.id, id);
        const next = { ...current, accountId: id };
        if (!next.running) {
          if (!enabled) {
            next.lastError ??= plugin.config.disabledReason?.(account, cfg) ?? "disabled";
          } else if (configured === false) {
            next.lastError ??= plugin.config.unconfiguredReason?.(account, cfg) ?? "not configured";
          }
        }
        accounts[id] = next;
      }
      const defaultAccount =
        accounts[defaultAccountId] ?? cloneDefaultRuntime(plugin.id, defaultAccountId);
      channels[plugin.id] = defaultAccount;
      channelAccounts[plugin.id] = accounts;
    }
    return { channels, channelAccounts };
  };

  return {
    getRuntimeSnapshot,
    startChannels,
    startChannel,
    stopChannel,
    markChannelLoggedOut,
  };
}
