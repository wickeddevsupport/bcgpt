import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, ensureDir } from "../utils.js";

export type WorkspaceConnectors = {
  ops?: {
    url?: string;
    apiKey?: string;
    projectId?: string;
    user?: { email?: string; password?: string };
  };
  bcgpt?: { url?: string; apiKey?: string };
  [k: string]: unknown;
};

export function workspaceConnectorsPath(workspaceId: string) {
  const safe = String(workspaceId).trim() || "default";
  return path.join(CONFIG_DIR, "workspaces", safe, "connectors.json");
}

export async function readWorkspaceConnectors(workspaceId: string): Promise<WorkspaceConnectors | null> {
  const p = workspaceConnectorsPath(workspaceId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as WorkspaceConnectors;
    return parsed;
  } catch (err) {
    return null;
  }
}

export async function writeWorkspaceConnectors(workspaceId: string, next: WorkspaceConnectors): Promise<void> {
  const dir = path.dirname(workspaceConnectorsPath(workspaceId));
  await ensureDir(dir);
  const raw = JSON.stringify(next, null, 2).trimEnd().concat("\n");
  await fs.writeFile(workspaceConnectorsPath(workspaceId), raw, "utf-8");
}
