import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { AppViewState } from "./app-view-state.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ThemeMode } from "./theme.ts";
import type { SessionsListResult } from "./types.ts";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { CHAT_SESSIONS_ACTIVE_MINUTES, refreshChat, refreshChatAvatar } from "./app-chat.ts";
import { syncUrlWithSessionKey } from "./app-settings.ts";
import { OpenClawApp } from "./app.ts";
import { ChatState, loadChatHistory } from "./controllers/chat.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { icons } from "./icons.ts";
import { iconForTab, pathForTab, titleForTab, type Tab } from "./navigation.ts";

export function renderTab(state: AppViewState, tab: Tab) {
  const href = pathForTab(tab, state.basePath);
  return html`
    <a
      href=${href}
      class="nav-item ${state.tab === tab ? "active" : ""}"
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      <span class="nav-item__text">${titleForTab(tab)}</span>
    </a>
  `;
}

function normalizeProviderId(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "local-ollama") {
    return "ollama";
  }
  return normalized;
}

function resolveSessionRow(
  sessions: SessionsListResult | null,
  key: string,
): SessionsListResult["sessions"][number] | undefined {
  return sessions?.sessions?.find((row) => row.key === key);
}

function humanizeAgentSessionRest(rest: string): string {
  const trimmed = rest.trim();
  if (!trimmed) {
    return "Chat";
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "main") {
    return "Main";
  }
  if (normalized.startsWith("chat:")) {
    const suffix = trimmed.slice(5).trim();
    return suffix ? `Chat ${suffix.slice(0, 8)}` : "Chat";
  }
  if (normalized.startsWith("subagent:")) {
    const suffix = trimmed.slice(9).trim();
    return suffix ? `Subagent ${suffix.replace(/:/g, " / ")}` : "Subagent";
  }
  return trimmed
    .split(":")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function agentNameFromSessionKey(
  key: string,
  agentsList: AppViewState["agentsList"],
  row?: SessionsListResult["sessions"][number],
): string | null {
  const parsed = parseAgentSessionKey(key);
  if (!parsed?.agentId) {
    return null;
  }
  const agent = agentsList?.agents?.find((entry) => entry.id === parsed.agentId);
  if (!agent) {
    return null;
  }
  const name = agent.identity?.name?.trim() || agent.name?.trim() || parsed.agentId;
  const displayTail =
    (typeof row?.displayName === "string" && row.displayName.trim() && row.displayName.trim() !== key
      ? row.displayName.trim()
      : "") ||
    (typeof row?.label === "string" && row.label.trim() && row.label.trim() !== key
      ? row.label.trim()
      : "") ||
    (parsed.rest.trim().toLowerCase() === "main" ? "" : humanizeAgentSessionRest(parsed.rest));
  return displayTail ? `${name} · ${displayTail}` : name;
}

function resolveSessionModelRef(row?: SessionsListResult["sessions"][number]): string {
  const provider = normalizeProviderId(row?.modelProvider ?? "");
  const model = String(row?.model ?? "").trim();
  if (!provider || !model) {
    return "";
  }
  return `${provider}/${model}`;
}

export function resolveSelectedAgentIdForSession(
  state: Pick<AppViewState, "assistantAgentId" | "agentsList">,
  sessionKey: string,
): string | null {
  const parsedAgentId = parseAgentSessionKey(sessionKey)?.agentId?.trim();
  if (parsedAgentId) {
    return parsedAgentId;
  }
  const assistantAgentId = state.assistantAgentId?.trim();
  if (assistantAgentId) {
    return assistantAgentId;
  }
  const defaultAgentId = state.agentsList?.defaultId?.trim();
  if (defaultAgentId) {
    return defaultAgentId;
  }
  const firstAgentId = state.agentsList?.agents?.[0]?.id?.trim();
  return firstAgentId || null;
}

function syncSelectedAgentForSession(
  state: Pick<AppViewState, "agentsSelectedId" | "assistantAgentId" | "agentsList">,
  sessionKey: string,
): void {
  const nextAgentId = resolveSelectedAgentIdForSession(state, sessionKey);
  if (nextAgentId) {
    state.agentsSelectedId = nextAgentId;
  }
}

type ActivateChatSessionOptions = {
  ensureExists?: boolean;
  label?: string | null;
  replaceHistory?: boolean;
  syncUrl?: boolean;
};

export function buildNewAgentSessionKey(agentId: string): string {
  return `agent:${agentId.trim()}:chat:${Date.now().toString(36)}`;
}

export function buildNewSessionLabel(agentName?: string | null, now = new Date()): string {
  const timestamp = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const prefix = agentName?.trim() ? `${agentName.trim()} ` : "";
  return `${prefix}chat ${timestamp}`;
}

async function ensureChatSessionExists(
  state: AppViewState,
  key: string,
  opts?: { label?: string | null },
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return true;
  }
  const params: Record<string, unknown> = { key };
  const label = opts?.label?.trim();
  if (label) {
    params.label = label;
  }
  try {
    await state.client.request("sessions.patch", params);
    await loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
      activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
      includeGlobal: false,
      includeUnknown: false,
    });
    return true;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

export async function activateChatSession(
  state: AppViewState,
  nextKey: string,
  opts?: ActivateChatSessionOptions,
): Promise<boolean> {
  const next = nextKey.trim();
  if (!next) {
    return false;
  }
  if (opts?.ensureExists) {
    const ready = await ensureChatSessionExists(state, next, { label: opts?.label ?? null });
    if (!ready) {
      return false;
    }
  }
  state.sessionKey = next;
  syncSelectedAgentForSession(state, next);
  state.chatMessage = "";
  state.chatAttachments = [];
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatRunId = null;
  state.chatQueue = [];
  state.resetToolStream();
  state.resetChatScroll();
  state.applySettings({
    ...state.settings,
    sessionKey: next,
    lastActiveSessionKey: next,
  });
  if (opts?.syncUrl !== false) {
    syncUrlWithSessionKey(
      state as unknown as Parameters<typeof syncUrlWithSessionKey>[0],
      next,
      opts?.replaceHistory ?? true,
    );
  }
  await Promise.allSettled([
    state.loadAssistantIdentity(),
    loadChatHistory(state as unknown as ChatState),
    refreshChatAvatar(state as unknown as Parameters<typeof refreshChatAvatar>[0]),
  ]);
  return true;
}

export function renderChatControls(state: AppViewState) {
  const mainSessionKey = resolveMainSessionKey(state.hello, state.sessionsResult);
  const rawOptions = resolveSessionOptions(
    state.sessionKey,
    state.sessionsResult,
    mainSessionKey,
    {
      includeMissingCurrent: true,
    },
  );
  const rowByKey = new Map(
    (state.sessionsResult?.sessions ?? []).map((row) => [row.key, row] as const),
  );
  const sessionOptions = rawOptions.map((opt) => {
    if (mainSessionKey && opt.key === mainSessionKey) {
      return { ...opt, displayName: "Workspace Assistant" };
    }
    const row = rowByKey.get(opt.key);
    const agentName = agentNameFromSessionKey(opt.key, state.agentsList, row);
    return agentName ? { ...opt, displayName: agentName } : opt;
  });
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;

  const agents = state.agentsList?.agents ?? [];
  const currentParsed = parseAgentSessionKey(state.sessionKey);
  const activeSession = resolveSessionRow(state.sessionsResult, state.sessionKey);
  const currentSessionModelRef = resolveSessionModelRef(activeSession);
  const modelRows = Array.isArray(state.pmosModelRows) ? state.pmosModelRows : [];
  const sessionModelRows = Array.from(
    new Map(
      modelRows
        .filter((row) => row.ref.trim())
        .map((row) => [row.ref.trim(), row] as const),
    ).values(),
  ).sort((left, right) => {
    const readinessLeft = Number(left.active || left.keyConfigured || left.providerReady);
    const readinessRight = Number(right.active || right.keyConfigured || right.providerReady);
    return (
      readinessRight - readinessLeft ||
      left.provider.localeCompare(right.provider) ||
      left.ref.localeCompare(right.ref)
    );
  });
  const activeModelRef = modelRows.find((row) => row.active)?.ref?.trim() ?? "";
  const isWorkspaceAssistantSession = Boolean(mainSessionKey && state.sessionKey === mainSessionKey);
  const currentAgentId = isWorkspaceAssistantSession ? "" : currentParsed?.agentId ?? "";

  const switchSession = (next: string, opts?: { ensureExists?: boolean; replaceHistory?: boolean }) => {
    void activateChatSession(state, next, {
      ensureExists: opts?.ensureExists ?? false,
      replaceHistory: opts?.replaceHistory ?? true,
    });
  };

  // Refresh icon
  const refreshIcon = html`
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
  const focusIcon = html`
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 7V4h3"></path><path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path><path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;

  // Resolve main key for building agent session keys
  const sessionDefaults =
    (state.hello?.snapshot as { sessionDefaults?: { mainKey?: string } } | undefined)
      ?.sessionDefaults ?? null;
  const agentMainKey = sessionDefaults?.mainKey?.trim() || "main";
  const currentSessionIsMain =
    state.sessionKey === "main" ||
    Boolean(mainSessionKey && state.sessionKey === mainSessionKey) ||
    currentParsed?.rest.trim().toLowerCase() === "main";
  const canDeleteCurrentSession =
    Boolean(state.connected && state.client && state.sessionKey.trim()) && !currentSessionIsMain;
  const resolveAgentDisplayName = (agentId: string): string => {
    const agent = agents.find((entry) => entry.id === agentId);
    return agent?.identity?.name?.trim() || agent?.name?.trim() || agentId;
  };
  const createNewSession = () => {
    const targetAgentId =
      currentParsed?.agentId?.trim() ||
      parseAgentSessionKey(mainSessionKey ?? "")?.agentId?.trim() ||
      state.assistantAgentId?.trim() ||
      state.agentsList?.defaultId?.trim() ||
      agents[0]?.id?.trim() ||
      "";
    if (!targetAgentId) {
      if (mainSessionKey) {
        switchSession(mainSessionKey, { ensureExists: true, replaceHistory: false });
      }
      return;
    }
    const nextKey = buildNewAgentSessionKey(targetAgentId);
    void activateChatSession(state, nextKey, {
      ensureExists: true,
      label: buildNewSessionLabel(resolveAgentDisplayName(targetAgentId)),
      replaceHistory: false,
    });
  };
  const deleteCurrentSession = async () => {
    if (!canDeleteCurrentSession || !state.client) {
      return;
    }
    const key = state.sessionKey.trim();
    const parsed = parseAgentSessionKey(key);
    const fallbackKey = parsed?.agentId?.trim()
      ? `agent:${parsed.agentId.trim()}:${agentMainKey}`
      : (mainSessionKey ?? "main");
    const confirmed = window.confirm(
      `Delete session "${key}"?\n\nDeletes the session entry and archives its transcript.`,
    );
    if (!confirmed) {
      return;
    }
    try {
      await state.client.request("sessions.delete", { key, deleteTranscript: true });
      await loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
        activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
        includeGlobal: false,
        includeUnknown: false,
      });
      await activateChatSession(state, fallbackKey, {
        ensureExists: Boolean(parseAgentSessionKey(fallbackKey)),
        replaceHistory: true,
      });
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  };
  const applySessionModel = async (value: string) => {
    if (!state.client || !state.connected) {
      return;
    }
    try {
      state.lastError = null;
      await state.client.request("sessions.patch", {
        key: state.sessionKey,
        model: value.trim() || null,
      });
      await loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
        activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
        includeGlobal: false,
        includeUnknown: false,
      });
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  };

  return html`
    <div class="chat-controls">
      <div class="chat-controls__group">
        <label class="field chat-controls__agent" title="Switch agent">
          <span class="chat-controls__label">Agent</span>
          <select
            .value=${currentAgentId}
            ?disabled=${!state.connected}
            @change=${(e: Event) => {
              const nextAgentId = (e.target as HTMLSelectElement).value;
              if (!nextAgentId) {
                switchSession(mainSessionKey || "main", { ensureExists: true });
                return;
              }
              switchSession(`agent:${nextAgentId}:${agentMainKey}`, { ensureExists: true });
            }}
          >
            <option value="">Workspace Assistant</option>
            ${agents.map((agent) => {
              const emoji = agent.identity?.emoji ?? "";
              const name = agent.identity?.name ?? agent.name ?? agent.id;
              return html`<option value=${agent.id}>${emoji ? `${emoji} ` : ""}${name}</option>`;
            })}
          </select>
        </label>

        <label class="field chat-controls__session" title="Switch session">
          <span class="chat-controls__label">Session</span>
          <select
            .value=${state.sessionKey}
            ?disabled=${!state.connected}
            @change=${(e: Event) => switchSession((e.target as HTMLSelectElement).value)}
          >
            ${repeat(
              sessionOptions,
              (entry) => entry.key,
              (entry) =>
                html`<option value=${entry.key}>
                  ${entry.displayName ?? entry.key}
                </option>`,
            )}
          </select>
        </label>

        <div class="chat-controls__session-actions">
          <button
            class="btn btn--sm"
            ?disabled=${!state.connected}
            @click=${createNewSession}
            title="Create a new session for the current agent"
          >
            New
          </button>
          <button
            class="btn btn--sm danger"
            ?disabled=${!canDeleteCurrentSession}
            @click=${deleteCurrentSession}
            title=${canDeleteCurrentSession
              ? "Delete the current session"
              : "Main sessions stay available as the anchor thread for each agent"}
          >
            Delete
          </button>
        </div>
      </div>

      <div class="chat-controls__group">
        <label class="field chat-controls__model-select" title="Set a model for this session">
          <span class="chat-controls__label">Model</span>
          <select
            .value=${currentSessionModelRef}
            ?disabled=${!state.connected}
            @change=${(e: Event) => void applySessionModel((e.target as HTMLSelectElement).value)}
          >
            <option value="">Inherit agent / workspace default</option>
            ${sessionModelRows.map((row) => {
              const alias = row.alias.trim();
              const status = row.active ? "default" : row.keyConfigured || row.providerReady ? "ready" : "key";
              const label = alias ? `${alias} · ${row.ref}` : row.ref;
              return html`
                <option value=${row.ref}>${label} (${status})</option>
              `;
            })}
          </select>
        </label>

        <button
          class="btn btn--sm ${activeModelRef ? "chat-controls__model" : "chat-controls__model chat-controls__model--warn"}"
          title=${activeModelRef
            ? `Workspace default model: ${activeModelRef}`
            : "No workspace default model configured"}
          @click=${() => state.setTab("models" as Tab)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
            <path d="M2 17l10 5 10-5"></path>
            <path d="M2 12l10 5 10-5"></path>
          </svg>
          <span>${activeModelRef || "Manage models"}</span>
        </button>
      </div>

      <span class="chat-controls__separator">|</span>

      <!-- Refresh -->
      <button
        class="btn btn--sm btn--icon"
        ?disabled=${state.chatLoading || !state.connected}
        @click=${async () => {
          const app = state as unknown as OpenClawApp;
          app.chatManualRefreshInFlight = true;
          app.chatNewMessagesBelow = false;
          await app.updateComplete;
          app.resetToolStream();
          try {
            await refreshChat(state as unknown as Parameters<typeof refreshChat>[0], {
              scheduleScroll: false,
            });
            app.scrollToBottom({ smooth: true });
          } finally {
            requestAnimationFrame(() => {
              app.chatManualRefreshInFlight = false;
              app.chatNewMessagesBelow = false;
            });
          }
        }}
        title="Refresh chat data"
      >
        ${refreshIcon}
      </button>
      <!-- Thinking toggle -->
      <button
        class="btn btn--sm btn--icon ${showThinking ? "active" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) return;
          state.applySettings({
            ...state.settings,
            chatShowThinking: !state.settings.chatShowThinking,
          });
        }}
        aria-pressed=${showThinking}
        title=${disableThinkingToggle ? "Disabled during onboarding" : "Toggle assistant thinking/working output"}
      >
        ${icons.brain}
      </button>
      <!-- Focus toggle -->
      <button
        class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
        ?disabled=${disableFocusToggle}
        @click=${() => {
          if (disableFocusToggle) return;
          state.applySettings({
            ...state.settings,
            chatFocusMode: !state.settings.chatFocusMode,
          });
        }}
        aria-pressed=${focusActive}
        title=${disableFocusToggle ? "Disabled during onboarding" : "Toggle focus mode (hide sidebar + page header)"}
      >
        ${focusIcon}
      </button>
    </div>
  `;
}

type SessionDefaultsSnapshot = {
  mainSessionKey?: string;
  mainKey?: string;
};

function resolveMainSessionKey(
  hello: AppViewState["hello"],
  sessions: SessionsListResult | null,
): string | null {
  const snapshot = hello?.snapshot as { sessionDefaults?: SessionDefaultsSnapshot } | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  const hasSessions = Array.isArray(sessions?.sessions) && sessions.sessions.length > 0;
  const sessionHasKey = (key: string) =>
    Boolean(sessions?.sessions?.some((row) => typeof row.key === "string" && row.key === key));
  if (mainSessionKey) {
    if (hasSessions && !sessionHasKey(mainSessionKey)) {
      // Ignore stale hello snapshot defaults once sessions.list has loaded; PMOS workspace
      // bootstrap/repair may finalize after websocket connect.
    } else {
      return mainSessionKey;
    }
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    if (hasSessions && !sessionHasKey(mainKey)) {
      // Ignore stale alias when sessions list disproves it.
    } else {
      return mainKey;
    }
  }
  if (sessions?.sessions?.some((row) => row.key === "main")) {
    return "main";
  }
  return null;
}

export function resolveSessionDisplayName(
  key: string,
  row?: SessionsListResult["sessions"][number],
) {
  const displayName = row?.displayName?.trim() || "";
  const label = row?.label?.trim() || "";
  if (displayName && displayName !== key) {
    return `${displayName} (${key})`;
  }
  if (label && label !== key) {
    return `${label} (${key})`;
  }
  return key;
}

function resolveSessionOptions(
  sessionKey: string,
  sessions: SessionsListResult | null,
  mainSessionKey?: string | null,
  opts?: { includeMissingCurrent?: boolean },
) {
  const seen = new Set<string>();
  const options: Array<{ key: string; displayName?: string }> = [];
  const includeMissingCurrent = opts?.includeMissingCurrent ?? true;

  const resolvedMain = mainSessionKey && sessions?.sessions?.find((s) => s.key === mainSessionKey);
  const resolvedCurrent = sessions?.sessions?.find((s) => s.key === sessionKey);

  // Add main session key first
  if (mainSessionKey) {
    seen.add(mainSessionKey);
    options.push({
      key: mainSessionKey,
      displayName: resolveSessionDisplayName(mainSessionKey, resolvedMain || undefined),
    });
  }

  // Add current session key next
  const canIncludeCurrent =
    Boolean(sessionKey) &&
    (!sessions?.sessions || sessions.sessions.length === 0 || resolvedCurrent || includeMissingCurrent);
  if (canIncludeCurrent && !seen.has(sessionKey)) {
    seen.add(sessionKey);
    options.push({
      key: sessionKey,
      displayName: resolveSessionDisplayName(sessionKey, resolvedCurrent),
    });
  }

  // Add sessions from the result
  if (sessions?.sessions) {
    for (const s of sessions.sessions) {
      if (!seen.has(s.key)) {
        seen.add(s.key);
        options.push({
          key: s.key,
          displayName: resolveSessionDisplayName(s.key, s),
        });
      }
    }
  }

  return options;
}

const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];

export function renderThemeToggle(state: AppViewState) {
  const index = Math.max(0, THEME_ORDER.indexOf(state.theme));
  const applyTheme = (next: ThemeMode) => (event: MouseEvent) => {
    const element = event.currentTarget as HTMLElement;
    const context: ThemeTransitionContext = { element };
    if (event.clientX || event.clientY) {
      context.pointerClientX = event.clientX;
      context.pointerClientY = event.clientY;
    }
    state.setTheme(next, context);
  };

  return html`
    <div class="theme-toggle" style="--theme-index: ${index};">
      <div class="theme-toggle__track" role="group" aria-label="Theme">
        <span class="theme-toggle__indicator"></span>
        <button
          class="theme-toggle__button ${state.theme === "system" ? "active" : ""}"
          @click=${applyTheme("system")}
          aria-pressed=${state.theme === "system"}
          aria-label="System theme"
          title="System"
        >
          ${renderMonitorIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "light" ? "active" : ""}"
          @click=${applyTheme("light")}
          aria-pressed=${state.theme === "light"}
          aria-label="Light theme"
          title="Light"
        >
          ${renderSunIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "dark" ? "active" : ""}"
          @click=${applyTheme("dark")}
          aria-pressed=${state.theme === "dark"}
          aria-label="Dark theme"
          title="Dark"
        >
          ${renderMoonIcon()}
        </button>
      </div>
    </div>
  `;
}

function renderSunIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path>
      <path d="M12 20v2"></path>
      <path d="m4.93 4.93 1.41 1.41"></path>
      <path d="m17.66 17.66 1.41 1.41"></path>
      <path d="M2 12h2"></path>
      <path d="M20 12h2"></path>
      <path d="m6.34 17.66-1.41 1.41"></path>
      <path d="m19.07 4.93-1.41 1.41"></path>
    </svg>
  `;
}

function renderMoonIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      ></path>
    </svg>
  `;
}

function renderMonitorIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <line x1="8" x2="16" y1="21" y2="21"></line>
      <line x1="12" x2="12" y1="17" y2="21"></line>
    </svg>
  `;
}
