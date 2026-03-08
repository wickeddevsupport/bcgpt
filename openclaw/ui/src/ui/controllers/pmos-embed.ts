import { normalizeBasePath } from "../navigation.ts";

function appendProjectId(url: string, projectId?: string | null): string {
  const trimmedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!trimmedProjectId) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}projectId=${encodeURIComponent(trimmedProjectId)}`;
}

export function buildOpsUiEmbedUrl(
  basePath: string,
  flowId?: string | null,
  projectId?: string | null,
): string {
  const base = normalizeBasePath(basePath ?? "");
  const trimmedFlowId = typeof flowId === "string" ? flowId.trim() : "";
  if (trimmedFlowId) {
    return appendProjectId(`${base}/ops-ui/flows/${encodeURIComponent(trimmedFlowId)}`, projectId);
  }
  return appendProjectId(`${base}/ops-ui/flows`, projectId);
}

export function buildOpsUiConnectionsUrl(basePath: string, projectId?: string | null): string {
  const base = normalizeBasePath(basePath ?? "");
  return appendProjectId(`${base}/ops-ui/connections`, projectId);
}
