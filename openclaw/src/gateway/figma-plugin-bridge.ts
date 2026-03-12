import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, ensureDir } from "../utils.js";
import { parseFigmaFileKey } from "./figma-rest-audit.js";

export type FigmaPluginBridgeCategory = {
  id: string;
  label: string | null;
  description: string | null;
  color: string | null;
};

export type FigmaPluginBridgeAnnotation = {
  id: string | null;
  nodeId: string | null;
  nodeName: string | null;
  pageId: string | null;
  pageName: string | null;
  labelMarkdown: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  authorName: string | null;
  authorId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FigmaPluginBridgeSnapshot = {
  fileKey: string;
  fileName: string | null;
  selectionNodeIds: string[];
  scope: "selection" | "current_page" | "document";
  syncedAt: string;
  pluginVersion: string | null;
  editorType: string | null;
  categories: FigmaPluginBridgeCategory[];
  annotations: FigmaPluginBridgeAnnotation[];
};

type StoredFigmaPluginBridgeRecord = {
  bridgeToken: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  snapshotsByFileKey: Record<string, FigmaPluginBridgeSnapshot>;
};

export type FigmaPluginBridgeStatus = {
  configured: boolean;
  lastSyncedAt: string | null;
  syncedFileCount: number;
  availableFileKeys: string[];
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeNodeId(value: unknown): string | null {
  const raw = stringOrNull(value);
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  if (/^\d+-\d+$/.test(decoded)) {
    return decoded.replace("-", ":");
  }
  return decoded;
}

function safeWorkspaceId(workspaceId: string): string {
  return String(workspaceId).trim() || "default";
}

function workspaceFigmaPluginBridgePath(workspaceId: string): string {
  return path.join(CONFIG_DIR, "workspaces", safeWorkspaceId(workspaceId), "figma-plugin-bridge.json");
}

function normalizeScope(value: unknown): FigmaPluginBridgeSnapshot["scope"] {
  const raw = stringOrNull(value)?.toLowerCase();
  if (raw === "selection" || raw === "document" || raw === "current_page") {
    return raw;
  }
  if (raw === "current-page") {
    return "current_page";
  }
  return "selection";
}

function normalizeCategory(value: unknown): FigmaPluginBridgeCategory | null {
  const entry = isJsonObject(value) ? value : null;
  if (!entry) return null;
  const id = stringOrNull(entry.id) ?? stringOrNull(entry.categoryId);
  if (!id) return null;
  return {
    id,
    label: stringOrNull(entry.label) ?? stringOrNull(entry.name),
    description: stringOrNull(entry.description),
    color: stringOrNull(entry.color),
  };
}

function normalizeAnnotation(
  value: unknown,
  categoryLabels: Map<string, string | null>,
): FigmaPluginBridgeAnnotation | null {
  const entry = isJsonObject(value) ? value : null;
  if (!entry) return null;
  const categoryId = stringOrNull(entry.categoryId) ?? stringOrNull(entry.category_id);
  return {
    id: stringOrNull(entry.id),
    nodeId: normalizeNodeId(entry.nodeId) ?? normalizeNodeId(entry.node_id),
    nodeName: stringOrNull(entry.nodeName) ?? stringOrNull(entry.node_name),
    pageId: normalizeNodeId(entry.pageId) ?? normalizeNodeId(entry.page_id),
    pageName: stringOrNull(entry.pageName) ?? stringOrNull(entry.page_name),
    labelMarkdown:
      stringOrNull(entry.labelMarkdown) ??
      stringOrNull(entry.label_markdown) ??
      stringOrNull(entry.label) ??
      stringOrNull(entry.message),
    categoryId,
    categoryLabel:
      stringOrNull(entry.categoryLabel) ??
      stringOrNull(entry.category_label) ??
      (categoryId ? categoryLabels.get(categoryId) ?? null : null),
    authorName:
      stringOrNull(entry.authorName) ??
      stringOrNull(entry.author_name) ??
      stringOrNull(entry.authorHandle),
    authorId: stringOrNull(entry.authorId) ?? stringOrNull(entry.author_id),
    createdAt: stringOrNull(entry.createdAt) ?? stringOrNull(entry.created_at),
    updatedAt: stringOrNull(entry.updatedAt) ?? stringOrNull(entry.updated_at),
  };
}

function normalizeSelectionNodeIds(value: unknown): string[] {
  return [...new Set(asArray(value).map((entry) => normalizeNodeId(entry)).filter(Boolean) as string[])];
}

function normalizeSnapshot(payload: Record<string, unknown>): FigmaPluginBridgeSnapshot {
  const fileKey =
    parseFigmaFileKey(stringOrNull(payload.fileKey)) ??
    parseFigmaFileKey(stringOrNull(payload.file_key)) ??
    null;
  if (!fileKey) {
    throw new Error("FIGMA_PLUGIN_BRIDGE_FILE_KEY_REQUIRED");
  }
  const categories = asArray(payload.categories)
    .map((entry) => normalizeCategory(entry))
    .filter((entry): entry is FigmaPluginBridgeCategory => Boolean(entry));
  const categoryLabels = new Map(categories.map((category) => [category.id, category.label]));
  const annotations = asArray(payload.annotations)
    .map((entry) => normalizeAnnotation(entry, categoryLabels))
    .filter((entry): entry is FigmaPluginBridgeAnnotation => Boolean(entry));
  return {
    fileKey,
    fileName: stringOrNull(payload.fileName) ?? stringOrNull(payload.file_name),
    selectionNodeIds: normalizeSelectionNodeIds(payload.selectionNodeIds ?? payload.selection_node_ids),
    scope: normalizeScope(payload.scope),
    syncedAt: stringOrNull(payload.syncedAt) ?? stringOrNull(payload.synced_at) ?? new Date().toISOString(),
    pluginVersion: stringOrNull(payload.pluginVersion) ?? stringOrNull(payload.plugin_version),
    editorType: stringOrNull(payload.editorType) ?? stringOrNull(payload.editor_type),
    categories,
    annotations,
  };
}

async function readRecord(workspaceId: string): Promise<StoredFigmaPluginBridgeRecord | null> {
  try {
    const raw = await fs.readFile(workspaceFigmaPluginBridgePath(workspaceId), "utf-8");
    const parsed = JSON.parse(raw);
    if (!isJsonObject(parsed)) {
      return null;
    }
    const snapshotsByFileKey = isJsonObject(parsed.snapshotsByFileKey)
      ? Object.fromEntries(
          Object.entries(parsed.snapshotsByFileKey)
            .map(([fileKey, value]) => {
              if (!isJsonObject(value)) return null;
              try {
                return [fileKey, normalizeSnapshot({ fileKey, ...value })];
              } catch {
                return null;
              }
            })
            .filter(Boolean) as Array<[string, FigmaPluginBridgeSnapshot]>,
        )
      : {};
    const bridgeToken = stringOrNull(parsed.bridgeToken);
    if (!bridgeToken) {
      return null;
    }
    return {
      bridgeToken,
      createdAt: stringOrNull(parsed.createdAt) ?? new Date().toISOString(),
      updatedAt: stringOrNull(parsed.updatedAt) ?? new Date().toISOString(),
      lastSyncedAt: stringOrNull(parsed.lastSyncedAt),
      snapshotsByFileKey,
    };
  } catch {
    return null;
  }
}

async function writeRecord(workspaceId: string, record: StoredFigmaPluginBridgeRecord): Promise<void> {
  const filePath = workspaceFigmaPluginBridgePath(workspaceId);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(record, null, 2).trimEnd().concat("\n"), "utf-8");
}

function createBridgeToken(): string {
  return `figpb_${randomBytes(24).toString("base64url")}`;
}

export async function prepareWorkspaceFigmaPluginBridge(workspaceId: string): Promise<{
  bridgeToken: string;
  status: FigmaPluginBridgeStatus;
}> {
  const existing = await readRecord(workspaceId);
  const now = new Date().toISOString();
  if (existing) {
    return {
      bridgeToken: existing.bridgeToken,
      status: {
        configured: true,
        lastSyncedAt: existing.lastSyncedAt,
        syncedFileCount: Object.keys(existing.snapshotsByFileKey).length,
        availableFileKeys: Object.keys(existing.snapshotsByFileKey).sort((a, b) => a.localeCompare(b)),
      },
    };
  }
  const next: StoredFigmaPluginBridgeRecord = {
    bridgeToken: createBridgeToken(),
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
    snapshotsByFileKey: {},
  };
  await writeRecord(workspaceId, next);
  return {
    bridgeToken: next.bridgeToken,
    status: {
      configured: true,
      lastSyncedAt: null,
      syncedFileCount: 0,
      availableFileKeys: [],
    },
  };
}

export async function readWorkspaceFigmaPluginBridgeStatus(
  workspaceId: string,
): Promise<FigmaPluginBridgeStatus> {
  const record = await readRecord(workspaceId);
  if (!record) {
    return {
      configured: false,
      lastSyncedAt: null,
      syncedFileCount: 0,
      availableFileKeys: [],
    };
  }
  const availableFileKeys = Object.keys(record.snapshotsByFileKey).sort((a, b) => a.localeCompare(b));
  return {
    configured: true,
    lastSyncedAt: record.lastSyncedAt,
    syncedFileCount: availableFileKeys.length,
    availableFileKeys,
  };
}

export async function readWorkspaceFigmaPluginBridgeSnapshot(
  workspaceId: string,
  fileKey: string | null,
): Promise<FigmaPluginBridgeSnapshot | null> {
  const normalizedFileKey = parseFigmaFileKey(fileKey);
  if (!normalizedFileKey) {
    return null;
  }
  const record = await readRecord(workspaceId);
  if (!record) {
    return null;
  }
  return record.snapshotsByFileKey[normalizedFileKey] ?? null;
}

export async function syncWorkspaceFigmaPluginBridgeSnapshot(params: {
  workspaceId: string;
  bridgeToken: string;
  payload: Record<string, unknown>;
}): Promise<{
  ok: true;
  snapshot: FigmaPluginBridgeSnapshot;
  status: FigmaPluginBridgeStatus;
}> {
  const record = await readRecord(params.workspaceId);
  if (!record || record.bridgeToken !== params.bridgeToken.trim()) {
    throw new Error("FIGMA_PLUGIN_BRIDGE_AUTH_FAILED");
  }
  const snapshot = normalizeSnapshot(params.payload);
  const now = new Date().toISOString();
  const next: StoredFigmaPluginBridgeRecord = {
    ...record,
    updatedAt: now,
    lastSyncedAt: now,
    snapshotsByFileKey: {
      ...record.snapshotsByFileKey,
      [snapshot.fileKey]: snapshot,
    },
  };
  await writeRecord(params.workspaceId, next);
  return {
    ok: true,
    snapshot,
    status: {
      configured: true,
      lastSyncedAt: now,
      syncedFileCount: Object.keys(next.snapshotsByFileKey).length,
      availableFileKeys: Object.keys(next.snapshotsByFileKey).sort((a, b) => a.localeCompare(b)),
    },
  };
}
