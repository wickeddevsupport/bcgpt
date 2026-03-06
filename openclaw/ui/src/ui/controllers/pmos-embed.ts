import { normalizeBasePath } from "../navigation.ts";

export function buildOpsUiEmbedUrl(basePath: string, flowId?: string | null): string {
  const base = normalizeBasePath(basePath ?? "");
  const trimmedFlowId = typeof flowId === "string" ? flowId.trim() : "";
  if (trimmedFlowId) {
    return `${base}/ops-ui/flows/${encodeURIComponent(trimmedFlowId)}`;
  }
  return `${base}/ops-ui`;
}

export function buildOpsUiConnectionsUrl(basePath: string): string {
  const base = normalizeBasePath(basePath ?? "");
  return `${base}/ops-ui/connections`;
}
