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
  const trimmedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (trimmedProjectId) {
    if (trimmedFlowId) {
      return `${base}/ops-ui/projects/${encodeURIComponent(trimmedProjectId)}/flows/${encodeURIComponent(trimmedFlowId)}`;
    }
    return `${base}/ops-ui/projects/${encodeURIComponent(trimmedProjectId)}/flows`;
  }
  if (trimmedFlowId) {
    return `${base}/ops-ui/flows/${encodeURIComponent(trimmedFlowId)}`;
  }
  return `${base}/ops-ui/flows`;
}

export function buildOpsUiConnectionsUrl(basePath: string, projectId?: string | null): string {
  const base = normalizeBasePath(basePath ?? "");
  const trimmedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (trimmedProjectId) {
    return `${base}/ops-ui/projects/${encodeURIComponent(trimmedProjectId)}/connections?limit=10`;
  }
  return `${base}/ops-ui/connections`;
}
