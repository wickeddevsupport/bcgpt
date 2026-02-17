import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/config.js";
import { CONFIG_DIR, ensureDir, isRecord } from "../utils.js";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isJsonObject(base) || !isJsonObject(patch)) {
    return patch;
  }
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key];
    out[key] = deepMerge(prev, value);
  }
  return out;
}

export function workspaceConfigPath(workspaceId: string): string {
  const safe = String(workspaceId).trim() || "default";
  return path.join(CONFIG_DIR, "workspaces", safe, "config.json");
}

export async function readWorkspaceConfig(workspaceId: string): Promise<JsonObject | null> {
  const p = workspaceConfigPath(workspaceId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isJsonObject(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeWorkspaceConfig(workspaceId: string, next: JsonObject): Promise<void> {
  const p = workspaceConfigPath(workspaceId);
  await ensureDir(path.dirname(p));
  const raw = JSON.stringify(next, null, 2).trimEnd().concat("\n");
  await fs.writeFile(p, raw, "utf-8");
}

export async function patchWorkspaceConfig(
  workspaceId: string,
  patch: JsonObject,
): Promise<JsonObject> {
  const existing = (await readWorkspaceConfig(workspaceId)) ?? {};
  const merged = deepMerge(existing, patch);
  const next = isJsonObject(merged) ? merged : {};
  await writeWorkspaceConfig(workspaceId, next);
  return next;
}

export async function loadEffectiveWorkspaceConfig(workspaceId: string): Promise<JsonObject> {
  const globalCfg = loadConfig() as unknown;
  const globalObject = isJsonObject(globalCfg) ? globalCfg : {};
  const workspaceCfg = (await readWorkspaceConfig(workspaceId)) ?? {};
  const merged = deepMerge(globalObject, workspaceCfg);
  return isJsonObject(merged) ? merged : globalObject;
}
