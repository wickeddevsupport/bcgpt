import fs from "node:fs";
import path from "node:path";
import type { AuthProfileStore } from "./types.js";
import { saveJsonFile } from "../../infra/json-file.js";
import { resolveUserPath } from "../../utils.js";
import { resolveOpenClawAgentDir } from "../agent-paths.js";
import { AUTH_PROFILE_FILENAME, AUTH_STORE_VERSION, LEGACY_AUTH_FILENAME } from "./constants.js";

export function resolveAuthStorePath(agentDir?: string): string {
  const resolved = resolveUserPath(agentDir ?? resolveOpenClawAgentDir());
  return path.join(resolved, AUTH_PROFILE_FILENAME);
}

export function resolveWorkspaceIdForAgentDir(agentDir?: string): string | null {
  if (!agentDir) {
    return null;
  }
  const resolved = path.normalize(resolveUserPath(agentDir));
  const marker = `${path.sep}workspaces${path.sep}`;
  const markerIndex = resolved.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const rest = resolved.slice(markerIndex + marker.length);
  const [workspaceId] = rest.split(path.sep);
  return workspaceId?.trim() || null;
}

export function isWorkspaceScopedAgentDir(agentDir?: string): boolean {
  return resolveWorkspaceIdForAgentDir(agentDir) !== null;
}

export function resolveWorkspacePrimaryAgentDir(
  agentDir?: string,
  primaryAgentId = "assistant",
): string | null {
  const workspaceId = resolveWorkspaceIdForAgentDir(agentDir);
  if (!workspaceId) {
    return null;
  }
  const resolved = path.normalize(resolveUserPath(agentDir ?? resolveOpenClawAgentDir()));
  const marker = `${path.sep}workspaces${path.sep}${workspaceId}${path.sep}`;
  const markerIndex = resolved.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const stateRoot = resolved.slice(0, markerIndex);
  return path.join(stateRoot, "workspaces", workspaceId, "agents", primaryAgentId, "agent");
}

export function resolveLegacyAuthStorePath(agentDir?: string): string {
  const resolved = resolveUserPath(agentDir ?? resolveOpenClawAgentDir());
  return path.join(resolved, LEGACY_AUTH_FILENAME);
}

export function resolveAuthStorePathForDisplay(agentDir?: string): string {
  const pathname = resolveAuthStorePath(agentDir);
  return pathname.startsWith("~") ? pathname : resolveUserPath(pathname);
}

export function ensureAuthStoreFile(pathname: string) {
  if (fs.existsSync(pathname)) {
    return;
  }
  const payload: AuthProfileStore = {
    version: AUTH_STORE_VERSION,
    profiles: {},
  };
  saveJsonFile(pathname, payload);
}
