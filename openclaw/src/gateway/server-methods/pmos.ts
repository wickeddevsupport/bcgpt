import type { GatewayRequestHandlers } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";

type ConnectorResult = {
  url: string | null;
  configured: boolean;
  reachable: boolean | null;
  authOk: boolean | null;
  error: string | null;
  flagsUrl?: string | null;
  authUrl?: string | null;
  healthUrl?: string | null;
  mcpUrl?: string | null;
};

async function fetchJson(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: unknown | null; error: string | null }> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        ...(opts.headers ?? {}),
        // Always request JSON; caller may override content-type.
        accept: "application/json",
      },
    });
    const text = await res.text().catch(() => "");
    const json = (() => {
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    })();
    return { ok: res.ok, status: res.status, json, error: res.ok ? null : text || res.statusText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  const normalized = value || fallback;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function readConfigString(cfg: unknown, path: string[]): string | null {
  let cur: unknown = cfg;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      return null;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  if (typeof cur !== "string") {
    return null;
  }
  const trimmed = cur.trim();
  return trimmed ? trimmed : null;
}

export const pmosHandlers: GatewayRequestHandlers = {
  "pmos.connectors.status": async ({ respond }) => {
    try {
      const cfg = loadConfig() as unknown;

      const apUrl = normalizeBaseUrl(
        readConfigString(cfg, ["pmos", "connectors", "activepieces", "url"]) ??
          process.env.ACTIVEPIECES_URL ??
          null,
        "https://flow.wickedlab.io",
      );
      const apKey =
        readConfigString(cfg, ["pmos", "connectors", "activepieces", "apiKey"]) ??
        (process.env.ACTIVEPIECES_API_KEY?.trim() || null);

      const bcgptUrl = normalizeBaseUrl(
        readConfigString(cfg, ["pmos", "connectors", "bcgpt", "url"]) ??
          process.env.BCGPT_URL ??
          null,
        "https://bcgpt.wickedlab.io",
      );
      const bcgptKey =
        readConfigString(cfg, ["pmos", "connectors", "bcgpt", "apiKey"]) ??
        (process.env.BCGPT_API_KEY?.trim() || null);

      const ap: ConnectorResult = {
        url: apUrl,
        configured: Boolean(apKey),
        reachable: null,
        authOk: apKey ? null : false,
        flagsUrl: `${apUrl}/api/v1/flags`,
        authUrl: apKey ? `${apUrl}/api/v1/flows?limit=1` : null,
        error: null,
      };

      const bcgpt: ConnectorResult = {
        url: bcgptUrl,
        configured: Boolean(bcgptKey),
        reachable: null,
        authOk: bcgptKey ? null : false,
        healthUrl: `${bcgptUrl}/health`,
        mcpUrl: `${bcgptUrl}/mcp`,
        error: null,
      };

      // Activepieces reachability (public)
      const apFlags = await fetchJson(ap.flagsUrl!, { method: "GET" });
      ap.reachable = apFlags.ok;
      if (!apFlags.ok) {
        ap.error = apFlags.error || "ACTIVEPIECES_UNREACHABLE";
      }

      // Activepieces API key check
      if (apKey) {
        const apAuth = await fetchJson(ap.authUrl!, {
          method: "GET",
          headers: {
            authorization: `Bearer ${apKey}`,
          },
        });
        ap.authOk = apAuth.ok;
        if (!apAuth.ok && !ap.error) {
          ap.error = apAuth.error || "ACTIVEPIECES_AUTH_FAILED";
        }
      }

      // BCGPT reachability
      const bcgptHealth = await fetchJson(bcgpt.healthUrl!, { method: "GET" });
      bcgpt.reachable = bcgptHealth.ok;
      if (!bcgptHealth.ok) {
        bcgpt.error = bcgptHealth.error || "BCGPT_UNREACHABLE";
      }

      // BCGPT API key check (MCP tools/list is the lightest auth probe)
      if (bcgptKey) {
        const bcgptAuth = await fetchJson(bcgpt.mcpUrl!, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bcgpt-api-key": bcgptKey,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "pmos-connectors-status",
            method: "tools/list",
            params: {},
          }),
        });
        const json = bcgptAuth.json as { error?: unknown } | null;
        const hasError = Boolean(json && typeof json === "object" && "error" in json && json.error);
        bcgpt.authOk = bcgptAuth.ok && !hasError;
        if ((!bcgptAuth.ok || hasError) && !bcgpt.error) {
          bcgpt.error = bcgptAuth.error || "BCGPT_AUTH_FAILED";
        }
      }

      respond(
        true,
        {
          checkedAtMs: Date.now(),
          activepieces: ap,
          bcgpt,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};

