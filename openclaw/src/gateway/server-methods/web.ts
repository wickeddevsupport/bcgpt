import type { GatewayRequestHandlers } from "./types.js";
import type { OpenClawConfig } from "../../config/config.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWebLoginStartParams,
  validateWebLoginWaitParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";

const WEB_LOGIN_METHODS = new Set(["web.login.start", "web.login.wait"]);

const resolveWebLoginProvider = () =>
  listChannelPlugins().find((plugin) =>
    (plugin.gatewayMethods ?? []).some((method) => WEB_LOGIN_METHODS.has(method)),
  ) ?? null;

async function loadWebConfigForClient(client?: {
  pmosWorkspaceId?: string;
  pmosRole?: string;
} | null): Promise<OpenClawConfig> {
  const { loadConfig } = await import("../../config/config.js");
  let cfg = loadConfig();
  const workspaceId =
    typeof client?.pmosWorkspaceId === "string" ? client.pmosWorkspaceId.trim() : "";
  const isSuperAdmin = client?.pmosRole === "super_admin";
  if (!workspaceId || isSuperAdmin) {
    return cfg;
  }
  try {
    const { loadEffectiveWorkspaceConfig } = await import("../workspace-config.js");
    cfg = (await loadEffectiveWorkspaceConfig(workspaceId)) as OpenClawConfig;
  } catch (err) {
    throw new Error(
      `failed to load workspace-scoped web config for ${workspaceId}: ${formatForLog(err)}`,
    );
  }
  return cfg;
}

function resolveWebRuntimeScopeKey(client?: { pmosWorkspaceId?: string; pmosRole?: string } | null): string | undefined {
  const workspaceId =
    typeof client?.pmosWorkspaceId === "string" ? client.pmosWorkspaceId.trim() : "";
  if (!workspaceId || client?.pmosRole === "super_admin") {
    return undefined;
  }
  return `workspace:${workspaceId}`;
}

export const webHandlers: GatewayRequestHandlers = {
  "web.login.start": async ({ params, respond, context, client }) => {
    if (!validateWebLoginStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.start params: ${formatValidationErrors(validateWebLoginStartParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId =
        typeof (params as { accountId?: unknown }).accountId === "string"
          ? (params as { accountId?: string }).accountId
          : undefined;
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "web login provider is not available"),
        );
        return;
      }
      const cfg = await loadWebConfigForClient(client);
      await context.stopChannel(provider.id, accountId, {
        scopeKey: resolveWebRuntimeScopeKey(client),
        cfg,
      });
      if (!provider.gateway?.loginWithQrStart) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `web login is not supported by provider ${provider.id}`,
          ),
        );
        return;
      }
      const result = await provider.gateway.loginWithQrStart({
        force: Boolean((params as { force?: boolean }).force),
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        verbose: Boolean((params as { verbose?: boolean }).verbose),
        accountId,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.wait": async ({ params, respond, context, client }) => {
    if (!validateWebLoginWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.wait params: ${formatValidationErrors(validateWebLoginWaitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId =
        typeof (params as { accountId?: unknown }).accountId === "string"
          ? (params as { accountId?: string }).accountId
          : undefined;
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "web login provider is not available"),
        );
        return;
      }
      if (!provider.gateway?.loginWithQrWait) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `web login is not supported by provider ${provider.id}`,
          ),
        );
        return;
      }
      const result = await provider.gateway.loginWithQrWait({
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        accountId,
      });
      if (result.connected) {
        const cfg = await loadWebConfigForClient(client);
        await context.startChannel(provider.id, accountId, {
          scopeKey: resolveWebRuntimeScopeKey(client),
          cfg,
        });
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
