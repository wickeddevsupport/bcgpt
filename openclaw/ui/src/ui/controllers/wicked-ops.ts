import type { UiSettings } from "../storage.ts";

type ToolInvokeOk = { ok: true; result: any };
type ToolInvokeErr = { ok: false; error?: { type?: string; message?: string } };

function normalizeBasePath(basePath: string): string {
  const trimmed = (basePath ?? "").trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function resolveToolsInvokeUrl(state: { basePath: string }): string {
  const base = normalizeBasePath(state.basePath);
  return base ? `${base}/tools/invoke` : "/tools/invoke";
}

async function invokeTool(
  state: { settings: UiSettings; basePath: string; sessionKey?: string },
  tool: string,
  args: Record<string, unknown>,
) {
  const token = state.settings.token?.trim() ?? "";
  if (!token) {
    throw new Error("Wicked OS access key missing. Go to Dashboard -> System -> paste key -> Connect.");
  }
  const res = await fetch(resolveToolsInvokeUrl(state), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tool, args, sessionKey: state.sessionKey ?? "main" }),
  });
  const data = (await res.json().catch(() => null)) as ToolInvokeOk | ToolInvokeErr | null;
  if (!data) {
    throw new Error(`Tool invoke failed (${res.status}): empty response`);
  }
  if (!data.ok) {
    const message = data.error?.message ?? `Tool invoke failed (${res.status})`;
    throw new Error(message);
  }
  return (data.result as { details?: unknown } | null)?.details ?? data.result;
}

export async function generateN8nWorkflow(
  state: { settings: UiSettings; basePath: string; sessionKey?: string },
  name: string,
  description: string,
  workspaceId?: string | null,
) {
  const args: Record<string, unknown> = { name, description };
  if (workspaceId) args.workspaceId = workspaceId;
  return await invokeTool(state, "ops_workflow_generate", args);
}
