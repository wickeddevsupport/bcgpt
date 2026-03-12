import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureDir, CONFIG_DIR } from "../utils.js";
import { parseFigmaFileKey } from "./figma-rest-audit.js";
import {
  readWorkspaceConnectors,
  type WorkspaceConnectors,
} from "./workspace-connectors.js";

export const DEFAULT_FIGMA_MCP_SERVER_URL = "https://mcp.figma.com/mcp";
export const DEFAULT_FIGMA_MCP_SCOPE = "mcp:connect";

type StoredWorkspaceFigmaMcpAuth = {
  mcpServerUrl: string;
  source: string | null;
  hasPersonalAccessToken: boolean;
  personalAccessToken: string | null;
};

type FigmaMcpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type FigmaMcpAuthStartResult =
  | { ok: true; alreadyAuthorized: true; authorizationUrl: null }
  | { ok: false; alreadyAuthorized: false; authorizationUrl: null; unsupported: true; reason: string };

export type FigmaMcpProbeStatus = {
  url: string;
  configured: boolean;
  reachable: boolean | null;
  authOk: boolean;
  authRequired: boolean;
  transport: "rest_compat" | "streamable_http";
  source: string | null;
  hasPersonalAccessToken: boolean;
  fallbackAvailable: boolean;
  error: string | null;
};

type ResolvedFigmaTarget = {
  fileKey: string | null;
  nodeId: string | null;
  selectedFileName: string | null;
  selectedFileUrl: string | null;
  selectedFileId: string | null;
};

type StoredCodeConnectMap = {
  fileKey: string;
  nodeId: string;
  componentName: string;
  source: string;
  label: string;
  updatedAt: string;
};

type FigmaApiRequestOptions = {
  timeoutMs?: number;
};

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isJsonObject(value) ? value : {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function parseNodeIdFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return normalizeNodeId(url.searchParams.get("node-id"));
  } catch {
    const match = value.match(/[?&]node-id=([^&#]+)/i);
    return normalizeNodeId(match?.[1] ?? null);
  }
}

function parseFileNameFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const designIndex = parts.findIndex((part) => part === "design" || part === "file");
    const slug = designIndex >= 0 ? parts[designIndex + 2] ?? null : parts.at(-1) ?? null;
    if (!slug) {
      return null;
    }
    return decodeURIComponent(slug).replace(/[-_]+/g, " ").trim() || null;
  } catch {
    return null;
  }
}

function parseRequiredScopeFromErrorMessage(value: unknown): string | null {
  const text = typeof value === "string" ? value : String(value ?? "");
  const match = text.match(/requires(?:\s+the)?\s+([a-z_]+:[a-z_]+)/i);
  return match?.[1] ?? null;
}

function safeWorkspaceId(workspaceId: string): string {
  return String(workspaceId).trim() || "default";
}

function workspaceFigmaCodeConnectPath(workspaceId: string): string {
  return path.join(CONFIG_DIR, "workspaces", safeWorkspaceId(workspaceId), "figma-code-connect.json");
}

function workspaceFigmaArtifactsDir(workspaceId: string): string {
  return path.join(CONFIG_DIR, "workspaces", safeWorkspaceId(workspaceId), "figma-artifacts");
}

function workspaceFigmaCapturePath(workspaceId: string, captureId: string): string {
  return path.join(workspaceFigmaArtifactsDir(workspaceId), `capture-${captureId}.json`);
}

function slugifyArtifactStem(value: string | null, fallback: string): string {
  const cleaned = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

async function writeWorkspaceFigmaArtifact(params: {
  workspaceId: string;
  stem: string;
  extension: string;
  content: string;
}): Promise<{ artifactId: string; absolutePath: string }> {
  const artifactId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const fileName = `${slugifyArtifactStem(params.stem, "artifact")}-${artifactId}.${params.extension.replace(/^\.+/, "")}`;
  const filePath = path.join(workspaceFigmaArtifactsDir(params.workspaceId), fileName);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, params.content, "utf-8");
  return { artifactId, absolutePath: filePath };
}

function toXmlAttr(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeNameKey(value: string | null): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toComponentStem(value: string | null): string {
  const cleaned = String(value ?? "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  if (!cleaned) {
    return "Component";
  }
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function getNodeBounds(node: Record<string, unknown>): {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
} {
  const absoluteBoundingBox = asRecord(node.absoluteBoundingBox);
  return {
    x: asNumber(absoluteBoundingBox.x),
    y: asNumber(absoluteBoundingBox.y),
    width: asNumber(absoluteBoundingBox.width),
    height: asNumber(absoluteBoundingBox.height),
  };
}

function buildMetadataXml(node: Record<string, unknown>, depth = 0, maxDepth = 6): string {
  const id = stringOrNull(node.id) ?? "";
  const name = stringOrNull(node.name) ?? "";
  const type = stringOrNull(node.type) ?? "UNKNOWN";
  const bounds = getNodeBounds(node);
  const attrs = [
    `id="${toXmlAttr(id)}"`,
    `name="${toXmlAttr(name)}"`,
    `type="${toXmlAttr(type)}"`,
    bounds.x !== null ? `x="${bounds.x}"` : null,
    bounds.y !== null ? `y="${bounds.y}"` : null,
    bounds.width !== null ? `width="${bounds.width}"` : null,
    bounds.height !== null ? `height="${bounds.height}"` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const children = asArray(node.children).filter(isJsonObject);
  if (!children.length || depth >= maxDepth) {
    return `<node ${attrs} />`;
  }
  const childXml = children.map((child) => buildMetadataXml(child, depth + 1, maxDepth)).join("");
  return `<node ${attrs}>${childXml}</node>`;
}

async function readWorkspaceCodeConnectMaps(workspaceId: string): Promise<StoredCodeConnectMap[]> {
  const filePath = workspaceFigmaCodeConnectPath(workspaceId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return asArray(parsed)
      .filter(isJsonObject)
      .map((value) => {
        const fileKey = parseFigmaFileKey(stringOrNull(value.fileKey)) ?? null;
        const nodeId = normalizeNodeId(value.nodeId);
        const componentName = stringOrNull(value.componentName);
        const source = stringOrNull(value.source);
        const label = stringOrNull(value.label) ?? "unknown";
        if (!fileKey || !nodeId || !componentName || !source) {
          return null;
        }
        return {
          fileKey,
          nodeId,
          componentName,
          source,
          label,
          updatedAt: stringOrNull(value.updatedAt) ?? new Date(0).toISOString(),
        } satisfies StoredCodeConnectMap;
      })
      .filter(Boolean) as StoredCodeConnectMap[];
  } catch {
    return [];
  }
}

async function writeWorkspaceCodeConnectMaps(
  workspaceId: string,
  maps: StoredCodeConnectMap[],
): Promise<void> {
  const filePath = workspaceFigmaCodeConnectPath(workspaceId);
  await ensureDir(path.dirname(filePath));
  const raw = JSON.stringify(maps, null, 2).trimEnd().concat("\n");
  await fs.writeFile(filePath, raw, "utf-8");
}

function flattenNodes(node: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    out.push(current);
    const children = asArray(current.children).filter(isJsonObject);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }
  return out;
}

function collectNodeStats(node: Record<string, unknown>): Record<string, unknown> {
  const flat = flattenNodes(node);
  const counts: Record<string, number> = {};
  let autoLayoutContainers = 0;
  let textNodes = 0;
  for (const current of flat) {
    const type = stringOrNull(current.type) ?? "UNKNOWN";
    counts[type] = (counts[type] ?? 0) + 1;
    if (type === "TEXT") {
      textNodes += 1;
    }
    if (["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(type)) {
      const layoutMode = stringOrNull(current.layoutMode) ?? "NONE";
      if (layoutMode !== "NONE") {
        autoLayoutContainers += 1;
      }
    }
  }
  return {
    totalNodes: flat.length,
    countsByType: counts,
    autoLayoutContainers,
    textNodes,
  };
}

function collectTextNodes(node: Record<string, unknown>, limit = 80): string[] {
  const flat = flattenNodes(node);
  const out: string[] = [];
  for (const current of flat) {
    if ((stringOrNull(current.type) ?? "") !== "TEXT") {
      continue;
    }
    const characters = stringOrNull(current.characters);
    if (!characters) {
      continue;
    }
    out.push(characters.trim());
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

function collectScreenshotCandidateNodeIds(
  node: Record<string, unknown>,
  preferredNodeId: string | null,
  limit = 12,
): string[] {
  const ordered = new Set<string>();
  if (preferredNodeId) {
    ordered.add(preferredNodeId);
  }
  const flat = flattenNodes(node);
  const typePriority = ["FRAME", "SECTION", "COMPONENT", "INSTANCE", "COMPONENT_SET", "GROUP", "CANVAS"];
  for (const type of typePriority) {
    for (const current of flat) {
      const currentType = stringOrNull(current.type);
      const currentId = stringOrNull(current.id);
      if (!currentId || currentType !== type) {
        continue;
      }
      ordered.add(currentId);
      if (ordered.size >= limit) {
        return [...ordered];
      }
    }
  }
  return [...ordered];
}

function resolveWorkspaceFigmaMcpAuthFromConnectors(
  connectors: WorkspaceConnectors | null,
): StoredWorkspaceFigmaMcpAuth {
  const figma = isJsonObject(connectors?.figma) ? connectors!.figma : {};
  const auth = isJsonObject(figma.auth) ? figma.auth : {};
  const identity = isJsonObject(figma.identity) ? figma.identity : {};
  const personalAccessToken = stringOrNull(auth.personalAccessToken);
  const hasPersonalAccessToken =
    Boolean(personalAccessToken) ||
    auth.hasPersonalAccessToken === true ||
    identity.hasPersonalAccessToken === true;
  return {
    mcpServerUrl: stringOrNull(auth.mcpServerUrl) ?? DEFAULT_FIGMA_MCP_SERVER_URL,
    source: stringOrNull(auth.source),
    hasPersonalAccessToken,
    personalAccessToken,
  };
}

async function readWorkspaceFigmaAuth(workspaceId: string): Promise<StoredWorkspaceFigmaMcpAuth> {
  const connectors = await readWorkspaceConnectors(workspaceId);
  return resolveWorkspaceFigmaMcpAuthFromConnectors(connectors);
}

async function readWorkspaceFigmaTarget(workspaceId: string): Promise<ResolvedFigmaTarget> {
  const connectors = await readWorkspaceConnectors(workspaceId);
  const figma = isJsonObject(connectors?.figma) ? connectors!.figma : {};
  const identity = isJsonObject(figma.identity) ? figma.identity : {};
  const selectedFileUrl = stringOrNull(identity.selectedFileUrl);
  const selectedFileId = stringOrNull(identity.selectedFileId);
  return {
    fileKey: parseFigmaFileKey(selectedFileId) ?? parseFigmaFileKey(selectedFileUrl),
    nodeId: parseNodeIdFromUrl(selectedFileUrl),
    selectedFileName: stringOrNull(identity.selectedFileName),
    selectedFileUrl,
    selectedFileId,
  };
}

function resolveRequestedTarget(
  args: Record<string, unknown>,
  workspaceTarget: ResolvedFigmaTarget,
): ResolvedFigmaTarget {
  const urlValue = stringOrNull(args.url);
  const requestedFileKey =
    parseFigmaFileKey(stringOrNull(args.fileKey)) ??
    parseFigmaFileKey(stringOrNull(args.file_key)) ??
    parseFigmaFileKey(stringOrNull(args.fileId)) ??
    parseFigmaFileKey(stringOrNull(args.file_id)) ??
    parseFigmaFileKey(urlValue) ??
    workspaceTarget.fileKey;
  const requestedNodeId =
    normalizeNodeId(args.nodeId) ??
    normalizeNodeId(args.node_id) ??
    parseNodeIdFromUrl(urlValue) ??
    workspaceTarget.nodeId;
  return {
    ...workspaceTarget,
    fileKey: requestedFileKey,
    nodeId: requestedNodeId,
  };
}

async function fetchFigmaJson(
  token: string,
  path: string,
  opts?: FigmaApiRequestOptions,
): Promise<unknown> {
  const response = await fetch(`https://api.figma.com${path}`, {
    method: "GET",
    headers: {
      "X-Figma-Token": token,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 20_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Figma REST ${response.status}: ${text || response.statusText}`);
  }
  return response.json();
}

async function fetchFile(token: string, fileKey: string, depth = 4): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    depth: String(depth),
    branch_data: "true",
  });
  return asRecord(
    await fetchFigmaJson(token, `/v1/files/${encodeURIComponent(fileKey)}?${query.toString()}`),
  );
}

async function fetchNode(
  token: string,
  fileKey: string,
  nodeId: string,
  depth = 6,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    ids: nodeId,
    depth: String(depth),
    geometry: "paths",
  });
  const payload = asRecord(
    await fetchFigmaJson(token, `/v1/files/${encodeURIComponent(fileKey)}/nodes?${query.toString()}`),
  );
  const nodes = asRecord(payload.nodes);
  const nodeEnvelope = asRecord(nodes[nodeId]);
  const document = asRecord(nodeEnvelope.document);
  if (!Object.keys(document).length) {
    throw new Error(`Figma node ${nodeId} was not returned for file ${fileKey}`);
  }
  return document;
}

async function fetchComments(token: string, fileKey: string): Promise<Record<string, unknown>[]> {
  const payload = asRecord(
    await fetchFigmaJson(token, `/v1/files/${encodeURIComponent(fileKey)}/comments`, {
      timeoutMs: 20_000,
    }),
  );
  return asArray(payload.comments).filter(isJsonObject);
}

async function fetchImages(
  token: string,
  fileKey: string,
  nodeIds: string[],
  format = "png",
): Promise<Record<string, string | null>> {
  const uniqueIds = [...new Set(nodeIds.map((value) => normalizeNodeId(value)).filter(Boolean) as string[])];
  if (!uniqueIds.length) {
    return {};
  }
  const query = new URLSearchParams({
    ids: uniqueIds.join(","),
    format,
    scale: "2",
    use_absolute_bounds: "true",
  });
  const payload = asRecord(
    await fetchFigmaJson(token, `/v1/images/${encodeURIComponent(fileKey)}?${query.toString()}`, {
      timeoutMs: 20_000,
    }),
  );
  const images = asRecord(payload.images);
  const out: Record<string, string | null> = {};
  for (const id of uniqueIds) {
    out[id] = stringOrNull(images[id]);
  }
  return out;
}

async function fetchLocalVariables(token: string, fileKey: string): Promise<Record<string, unknown>> {
  return asRecord(
    await fetchFigmaJson(token, `/v1/files/${encodeURIComponent(fileKey)}/variables/local`, {
      timeoutMs: 20_000,
    }),
  );
}

function collectBoundVariableIds(node: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const flat = flattenNodes(node);
  for (const current of flat) {
    const boundVariables = asRecord(current.boundVariables);
    for (const value of Object.values(boundVariables)) {
      if (typeof value === "string" && value.trim()) {
        ids.add(value.trim());
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.trim()) ids.add(item.trim());
        }
      }
      if (isJsonObject(value)) {
        const variableId = stringOrNull(value.id) ?? stringOrNull(value.variableId);
        if (variableId) ids.add(variableId);
      }
    }
  }
  return [...ids];
}

function normalizeVariableList(payload: Record<string, unknown>): Record<string, unknown>[] {
  const directCollections = asArray(asRecord(payload.meta).variables);
  if (directCollections.some(isJsonObject)) {
    return directCollections.filter(isJsonObject);
  }
  const variables = asArray(payload.variables);
  if (variables.some(isJsonObject)) {
    return variables.filter(isJsonObject);
  }
  const metaVariables = asRecord(payload.meta).variables;
  if (isJsonObject(metaVariables)) {
    return Object.values(metaVariables).filter(isJsonObject);
  }
  return [];
}

function filterCommentsForNode(
  comments: Record<string, unknown>[],
  nodeId: string | null,
): Record<string, unknown>[] {
  if (!nodeId) return comments;
  const wanted = normalizeNodeId(nodeId);
  return comments.filter((comment) => {
    const clientMeta = asRecord(comment.client_meta);
    const linkedNodeId =
      normalizeNodeId(clientMeta.node_id) ??
      normalizeNodeId(clientMeta.nodeId) ??
      normalizeNodeId(comment.node_id) ??
      normalizeNodeId(comment.nodeId);
    return linkedNodeId === wanted;
  });
}

function summarizeComments(comments: Record<string, unknown>[]): Array<Record<string, unknown>> {
  return comments.map((comment) => {
    const clientMeta = asRecord(comment.client_meta);
    const user = asRecord(comment.user);
    return {
      id: stringOrNull(comment.id),
      message: stringOrNull(comment.message),
      createdAt: stringOrNull(comment.created_at) ?? stringOrNull(comment.createdAt),
      resolvedAt: stringOrNull(comment.resolved_at) ?? stringOrNull(comment.resolvedAt),
      orderId: stringOrNull(comment.order_id) ?? stringOrNull(comment.orderId),
      nodeId:
        normalizeNodeId(clientMeta.node_id) ??
        normalizeNodeId(clientMeta.nodeId) ??
        normalizeNodeId(comment.node_id) ??
        normalizeNodeId(comment.nodeId),
      fileKey:
        parseFigmaFileKey(stringOrNull(comment.file_key)) ?? parseFigmaFileKey(stringOrNull(comment.fileKey)),
      user: {
        handle: stringOrNull(user.handle),
        name: stringOrNull(user.handle) ?? stringOrNull(user.id),
      },
    };
  });
}

function listMapItems(
  mapValue: unknown,
  limit = 100,
): Array<Record<string, unknown>> {
  if (isJsonObject(mapValue)) {
    return Object.entries(mapValue)
      .slice(0, limit)
      .map(([id, value]) => {
        const record = asRecord(value);
        return {
          id,
          key: stringOrNull(record.key),
          name: stringOrNull(record.name),
          description: stringOrNull(record.description),
          remote: record.remote === true,
          type:
            stringOrNull(record.styleType) ??
            stringOrNull(record.node_type) ??
            stringOrNull(record.type),
        };
      });
  }
  return [];
}

function summarizeListNames(items: Array<Record<string, unknown>>, limit = 8): string[] {
  return items
    .map((item) => stringOrNull(item.name) ?? stringOrNull(item.key))
    .filter(Boolean)
    .slice(0, limit) as string[];
}

function buildCodeConnectSuggestions(params: {
  nodeName: string | null;
  fileKey: string;
  nodeId: string | null;
  label: string;
  existingMappings: StoredCodeConnectMap[];
}): Array<Record<string, unknown>> {
  const nodeName = params.nodeName ?? "Component";
  const normalizedTarget = normalizeNameKey(nodeName);
  const fuzzyMatches = params.existingMappings
    .filter((entry) => normalizeNameKey(entry.componentName) === normalizedTarget)
    .slice(0, 5)
    .map((entry) => ({
      componentName: entry.componentName,
      source: entry.source,
      label: entry.label,
      nodeId: params.nodeId,
      confidence: "high",
      reason: "Matches an existing PMOS Code Connect mapping with the same normalized component name.",
    }));
  if (fuzzyMatches.length > 0) {
    return fuzzyMatches;
  }
  const stem = toComponentStem(nodeName);
  return [
    {
      componentName: stem,
      source: `src/components/${stem}.tsx`,
      label: params.label,
      nodeId: params.nodeId,
      confidence: "medium",
      reason: "Heuristic suggestion based on the Figma node name because no saved Code Connect mapping matched.",
    },
    {
      componentName: `${stem}View`,
      source: `src/features/${stem}/${stem}View.tsx`,
      label: params.label,
      nodeId: params.nodeId,
      confidence: "low",
      reason: "Alternate heuristic suggestion using a feature-folder layout.",
    },
  ];
}

function buildDesignSystemRules(params: {
  fileKey: string;
  fileName: string | null;
  framework: string | null;
  language: string | null;
  componentCount: number;
  componentSetCount: number;
  styleCount: number;
  variableCount: number;
  topComponentNames: string[];
  topStyleNames: string[];
  topVariableNames: string[];
}): string {
  const targetStack = [params.framework, params.language].filter(Boolean).join(" / ") || "your stack";
  const rules = [
    `Design system implementation rules for ${params.fileName ?? params.fileKey} targeting ${targetStack}.`,
    "",
    "Core rules:",
    "- Treat Figma variables as the source of truth for colors, spacing, typography, and effects.",
    "- Prefer reusable components and component sets over one-off frame styling.",
    "- Preserve Auto Layout intent when translating to code, including gap, padding, fill, and hug behavior.",
    "- Keep component APIs aligned with design variants and documented states.",
    "",
    `Observed inventory: ${params.componentCount} components, ${params.componentSetCount} component sets, ${params.styleCount} local styles, ${params.variableCount} variables.`,
    params.topComponentNames.length
      ? `Priority component families: ${params.topComponentNames.join(", ")}.`
      : "Priority component families: no strong component families detected yet.",
    params.topStyleNames.length
      ? `Key style names: ${params.topStyleNames.join(", ")}.`
      : "Key style names: sparse local styles; rely more on variables/tokens.",
    params.topVariableNames.length
      ? `Important variable names: ${params.topVariableNames.join(", ")}.`
      : "Important variable names: variable data is limited or absent.",
    "",
    "Implementation guidance:",
    "- Build primitives first: text, button, input, card, modal, and navigation shells.",
    "- Convert repeated design values into exported tokens before feature work starts.",
    "- Keep spacing and type scales centralized; avoid hard-coded pixel drift in components.",
    "- Add component stories/examples for every major variant before downstream screen assembly.",
    "- When a node has review comments, resolve the comment thread before freezing the component API.",
  ];
  return rules.join("\n");
}

function buildDesignContextCode(params: {
  fileKey: string;
  nodeId: string | null;
  fileName: string | null;
  metadataXml: string;
  screenshotUrl: string | null;
  comments: Array<Record<string, unknown>>;
  variableDefs: Array<Record<string, unknown>>;
  stats: Record<string, unknown>;
}): string {
  const lines = [
    `Figma design context for ${params.fileName ?? params.fileKey}${params.nodeId ? ` node ${params.nodeId}` : ""}.`,
    `File key: ${params.fileKey}.`,
    params.screenshotUrl ? `Screenshot URL: ${params.screenshotUrl}` : "Screenshot URL: unavailable.",
    `Comment count: ${params.comments.length}.`,
    `Variable definition count: ${params.variableDefs.length}.`,
    `Node stats: ${JSON.stringify(params.stats)}.`,
    "Metadata XML:",
    params.metadataXml,
  ];
  return lines.join("\n");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stringOrNull(match?.[1] ?? null);
}

async function fetchDesignCaptureSource(params: {
  url: string | null;
  html: string | null;
}): Promise<{
  sourceUrl: string | null;
  html: string | null;
  title: string | null;
  textExcerpt: string | null;
}> {
  let html = params.html;
  if (!html && params.url) {
    const response = await fetch(params.url, {
      headers: {
        "User-Agent": "OpenClaw/1.0 (+https://wickedlab.io)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Design capture fetch failed (${response.status}): ${text || response.statusText}`);
    }
    html = await response.text();
  }
  const normalizedHtml = stringOrNull(html);
  const title = extractHtmlTitle(normalizedHtml ?? "") ?? (params.url ? new URL(params.url).hostname : null);
  const textExcerpt = normalizedHtml ? truncateText(stripHtmlToText(normalizedHtml), 1200) : null;
  return {
    sourceUrl: params.url,
    html: normalizedHtml,
    title,
    textExcerpt,
  };
}

function requirePat(auth: StoredWorkspaceFigmaMcpAuth): string {
  if (!auth.personalAccessToken) {
    throw new Error("FIGMA_PAT_REQUIRED");
  }
  return auth.personalAccessToken;
}

const FIGMA_REST_COMPAT_TOOLS: FigmaMcpToolDefinition[] = [
  {
    name: "figma.get_design_context",
    description:
      "Return combined Figma design context for a file or node using the PMOS REST compatibility bridge, including metadata, screenshot URLs, comments, and variable references when available.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "figma.get_metadata",
    description:
      "Return structural node metadata and a lightweight XML-style tree summary for a file or node using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "figma.get_screenshot",
    description:
      "Return a Figma-rendered image URL for a target node or file using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
        format: { type: "string" },
      },
    },
  },
  {
    name: "figma.get_variable_defs",
    description:
      "Return local variable definitions and node-bound variable references where Figma REST exposes them, using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "figma.get_comments",
    description:
      "Return file comments, optionally filtered to a node, using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "figma.get_annotations",
    description:
      "Return review comments and pinned annotation-style notes, optionally filtered to a node, using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "figma.get_components",
    description:
      "Return defined components and component sets from a file using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "figma.get_code_connect_map",
    description:
      "Return PMOS-managed Code Connect mappings for a Figma file or node so design nodes can be related back to source components.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "figma.add_code_connect_map",
    description:
      "Create or update a PMOS-managed Code Connect mapping for a specific Figma node and component source path.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
        componentName: { type: "string" },
        source: { type: "string" },
        label: { type: "string" },
      },
      required: ["componentName", "source"],
    },
  },
  {
    name: "figma.get_code_connect_suggestions",
    description:
      "Generate PMOS-side Code Connect suggestions for a Figma node by using saved mappings first and then node-name heuristics.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
        clientFrameworks: { type: "string" },
        clientLanguages: { type: "string" },
      },
    },
  },
  {
    name: "figma.send_code_connect_mappings",
    description:
      "Save multiple PMOS-managed Code Connect mappings in bulk for Figma nodes and component source paths.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              componentName: { type: "string" },
              source: { type: "string" },
              label: { type: "string" },
            },
            required: ["nodeId", "componentName", "source"],
          },
        },
      },
      required: ["mappings"],
    },
  },
  {
    name: "figma.create_design_system_rules",
    description:
      "Generate implementation-facing design system rules from Figma variables, styles, and components using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        url: { type: "string" },
        clientFrameworks: { type: "string" },
        clientLanguages: { type: "string" },
      },
    },
  },
  {
    name: "figma.generate_diagram",
    description:
      "Generate a Mermaid diagram artifact in PMOS compatibility mode. This mirrors the official Figma MCP tool name, but saves a local diagram artifact instead of creating a FigJam document.",
    inputSchema: {
      type: "object",
      properties: {
        mermaidSyntax: { type: "string" },
        name: { type: "string" },
        userIntent: { type: "string" },
      },
      required: ["mermaidSyntax", "name"],
    },
  },
  {
    name: "figma.generate_figma_design",
    description:
      "Capture a URL or HTML snippet into a PMOS design artifact. In compatibility mode this creates a local capture bundle and report instead of a hosted Figma design file.",
    inputSchema: {
      type: "object",
      properties: {
        captureId: { type: "string" },
        fileKey: { type: "string" },
        fileName: { type: "string" },
        nodeId: { type: "string" },
        outputMode: { type: "string" },
        planKey: { type: "string" },
        url: { type: "string" },
        html: { type: "string" },
      },
    },
  },
  {
    name: "figma.get_figjam",
    description:
      "Return FigJam-friendly context for a board or node, including metadata, visible text notes, and optional screenshot URLs using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        nodeId: { type: "string" },
        url: { type: "string" },
        includeImagesOfNodes: { type: "boolean" },
      },
    },
  },
  {
    name: "figma.get_styles",
    description:
      "Return local styles from a file using the PMOS REST compatibility bridge.",
    inputSchema: {
      type: "object",
      properties: {
        fileKey: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "figma.whoami",
    description:
      "Return the current workspace Figma connector identity, selected-file context, and compatibility-service status from PMOS.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const FIGMA_TOOLS_AVAILABLE_WITHOUT_PAT = new Set<string>([
  "figma.whoami",
  "figma.generate_diagram",
  "figma.generate_figma_design",
  "figma.get_code_connect_map",
  "figma.add_code_connect_map",
  "figma.send_code_connect_mappings",
]);

async function callCompatTool(params: {
  workspaceId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const auth = await readWorkspaceFigmaAuth(params.workspaceId);
  const workspaceTarget = await readWorkspaceFigmaTarget(params.workspaceId);
  const target = resolveRequestedTarget(params.args, workspaceTarget);

  if (params.toolName === "figma.whoami") {
    const requestedUrl = stringOrNull(params.args.url);
    let effectiveFileName =
      target.fileKey && target.fileKey === workspaceTarget.fileKey
        ? workspaceTarget.selectedFileName
        : parseFileNameFromUrl(requestedUrl);
    const effectiveFileUrl = requestedUrl ?? workspaceTarget.selectedFileUrl;
    const effectiveFileId = target.fileKey ?? workspaceTarget.selectedFileId;
    let user: Record<string, unknown> | null = null;
    if (auth.personalAccessToken) {
      try {
        const me = asRecord(await fetchFigmaJson(auth.personalAccessToken, "/v1/me", { timeoutMs: 10_000 }));
        user = {
          id: stringOrNull(me.id),
          handle: stringOrNull(me.handle),
          email: stringOrNull(me.email),
          imageUrl: stringOrNull(me.img_url),
        };
      } catch {
        user = null;
      }
      if (target.fileKey && (!effectiveFileName || target.fileKey !== workspaceTarget.fileKey)) {
        try {
          const file = await fetchFile(auth.personalAccessToken, target.fileKey, 1);
          const document = asRecord(file.document);
          effectiveFileName =
            stringOrNull(file.name) ?? stringOrNull(document.name) ?? effectiveFileName;
        } catch {
          // Ignore file lookup failures and fall back to the URL slug or synced panel state.
        }
      }
    }
    return {
      source: "pmos-figma-rest-compat",
      transport: "rest_compat",
      workspaceId: params.workspaceId,
      selectedFileName: workspaceTarget.selectedFileName,
      selectedFileUrl: workspaceTarget.selectedFileUrl,
      selectedFileId: workspaceTarget.selectedFileId,
      effectiveFileName,
      effectiveFileUrl,
      effectiveFileId,
      requestedUrl,
      fileKey: target.fileKey,
      nodeId: target.nodeId,
      hasPersonalAccessToken: auth.hasPersonalAccessToken,
      sourceLabel: auth.source,
      mcpServerUrl: auth.mcpServerUrl,
      compatibilityMode: true,
      supportedToolCount: FIGMA_REST_COMPAT_TOOLS.length,
      availableWithoutPersonalAccessToken: [...FIGMA_TOOLS_AVAILABLE_WITHOUT_PAT],
      user,
    };
  }

  if (params.toolName === "figma.generate_diagram") {
    const mermaidSyntax = stringOrNull(params.args.mermaidSyntax);
    const name = stringOrNull(params.args.name);
    if (!mermaidSyntax || !name) {
      throw new Error("FIGMA_GENERATE_DIAGRAM_INVALID");
    }
    const artifact = await writeWorkspaceFigmaArtifact({
      workspaceId: params.workspaceId,
      stem: name,
      extension: "mmd",
      content: `${mermaidSyntax.trimEnd()}\n`,
    });
    return {
      source: "pmos-figma-rest-compat",
      transport: "rest_compat",
      compatibilityMode: true,
      status: "completed",
      name,
      mermaidSyntax,
      userIntent: stringOrNull(params.args.userIntent),
      artifactPath: artifact.absolutePath,
      artifactId: artifact.artifactId,
      note:
        "PMOS compatibility mode saved the Mermaid diagram as a local artifact instead of creating a FigJam board.",
    };
  }

  if (params.toolName === "figma.generate_figma_design") {
    const captureId = stringOrNull(params.args.captureId);
    if (captureId) {
      const capturePath = workspaceFigmaCapturePath(params.workspaceId, captureId);
      const raw = await fs.readFile(capturePath, "utf-8").catch(() => null);
      if (!raw) {
        throw new Error("FIGMA_CAPTURE_NOT_FOUND");
      }
      return JSON.parse(raw) as Record<string, unknown>;
    }

    const outputMode = stringOrNull(params.args.outputMode);
    if (!outputMode) {
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        compatibilityMode: true,
        status: "needs_output_mode",
        supportedOutputModes: ["newFile", "existingFile", "clipboard"],
        note:
          "PMOS compatibility mode creates a local capture bundle and design brief instead of a hosted Figma design file. Call figma.generate_figma_design again with outputMode and either url or html.",
      };
    }

    const sourceUrl = stringOrNull(params.args.url);
    const sourceHtml = stringOrNull(params.args.html);
    if (!sourceUrl && !sourceHtml) {
      throw new Error("FIGMA_DESIGN_SOURCE_REQUIRED");
    }
    const captured = await fetchDesignCaptureSource({
      url: sourceUrl,
      html: sourceHtml,
    });
    const effectiveCaptureId = randomUUID();
    const summary = {
      title: captured.title,
      outputMode,
      sourceUrl: captured.sourceUrl,
      requestedFileName: stringOrNull(params.args.fileName),
      targetFileKey: parseFigmaFileKey(stringOrNull(params.args.fileKey)),
      targetNodeId: normalizeNodeId(params.args.nodeId),
      planKey: stringOrNull(params.args.planKey),
      htmlLength: captured.html?.length ?? 0,
      textExcerpt: captured.textExcerpt,
      createdAt: new Date().toISOString(),
    };
    const htmlArtifact = captured.html
      ? await writeWorkspaceFigmaArtifact({
          workspaceId: params.workspaceId,
          stem: `${captured.title ?? "figma-design-capture"}-source`,
          extension: "html",
          content: `${captured.html}\n`,
        })
      : null;
    const artifact = await writeWorkspaceFigmaArtifact({
      workspaceId: params.workspaceId,
      stem: captured.title ?? "figma-design-capture",
      extension: "json",
      content: `${JSON.stringify(summary, null, 2)}\n`,
    });
    const payload = {
      source: "pmos-figma-rest-compat",
      transport: "rest_compat",
      compatibilityMode: true,
      captureId: effectiveCaptureId,
      status: "completed",
      outputMode,
      artifactPath: artifact.absolutePath,
      sourceArtifactPath: htmlArtifact?.absolutePath ?? null,
      summary,
      note:
        "PMOS compatibility mode completed a local capture bundle and design brief. It does not create a hosted Figma file.",
    };
    await ensureDir(path.dirname(workspaceFigmaCapturePath(params.workspaceId, effectiveCaptureId)));
    await fs.writeFile(
      workspaceFigmaCapturePath(params.workspaceId, effectiveCaptureId),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf-8",
    );
    return payload;
  }

  if (params.toolName === "figma.get_code_connect_map") {
    if (!target.fileKey) {
      throw new Error("FIGMA_FILE_CONTEXT_MISSING");
    }
    const maps = await readWorkspaceCodeConnectMaps(params.workspaceId);
    const filtered = maps.filter((entry) => {
      if (entry.fileKey !== target.fileKey) {
        return false;
      }
      if (!target.nodeId) {
        return true;
      }
      return entry.nodeId === target.nodeId;
    });
    return {
      source: "pmos-figma-rest-compat",
      transport: "rest_compat",
      fileKey: target.fileKey,
      nodeId: target.nodeId,
      mappings: filtered,
      totalMappings: filtered.length,
      byNodeId: filtered.reduce<Record<string, { codeConnectSrc: string; codeConnectName: string }>>(
        (acc, entry) => {
          acc[entry.nodeId] = {
            codeConnectSrc: entry.source,
            codeConnectName: entry.componentName,
          };
          return acc;
        },
        {},
      ),
    };
  }

  if (params.toolName === "figma.add_code_connect_map") {
    const componentName = stringOrNull(params.args.componentName);
    const source = stringOrNull(params.args.source);
    const label = stringOrNull(params.args.label) ?? "unknown";
    const nodeId = target.nodeId;
    if (!target.fileKey || !componentName || !source || !nodeId) {
      throw new Error("FIGMA_CODE_CONNECT_MAPPING_INVALID");
    }
    const maps = await readWorkspaceCodeConnectMaps(params.workspaceId);
    const nextEntry: StoredCodeConnectMap = {
      fileKey: target.fileKey,
      nodeId,
      componentName,
      source,
      label,
      updatedAt: new Date().toISOString(),
    };
    const deduped = maps.filter(
      (entry) =>
        !(
          entry.fileKey === nextEntry.fileKey &&
          entry.nodeId === nextEntry.nodeId &&
          entry.label === nextEntry.label
        ),
    );
    deduped.push(nextEntry);
    await writeWorkspaceCodeConnectMaps(params.workspaceId, deduped);
    return {
      source: "pmos-figma-rest-compat",
      transport: "rest_compat",
      saved: true,
      mapping: nextEntry,
    };
  }

  if (params.toolName === "figma.send_code_connect_mappings") {
    const incomingMappings = asArray(params.args.mappings).filter(isJsonObject);
    if (!incomingMappings.length) {
      throw new Error("FIGMA_CODE_CONNECT_MAPPING_INVALID");
    }
    const existing = await readWorkspaceCodeConnectMaps(params.workspaceId);
    const normalizedIncoming: StoredCodeConnectMap[] = incomingMappings
      .map((entry) => {
        const fileKey = parseFigmaFileKey(stringOrNull(entry.fileKey)) ?? target.fileKey;
        const nodeId = normalizeNodeId(entry.nodeId) ?? target.nodeId;
        const componentName = stringOrNull(entry.componentName);
        const source = stringOrNull(entry.source);
        const label = stringOrNull(entry.label) ?? "unknown";
        if (!fileKey || !nodeId || !componentName || !source) {
          return null;
        }
        return {
          fileKey,
          nodeId,
          componentName,
          source,
          label,
          updatedAt: new Date().toISOString(),
        } satisfies StoredCodeConnectMap;
      })
      .filter(Boolean) as StoredCodeConnectMap[];
    if (!normalizedIncoming.length) {
      throw new Error("FIGMA_CODE_CONNECT_MAPPING_INVALID");
    }
    const retained = existing.filter((saved) => {
      return !normalizedIncoming.some(
        (incoming) =>
          incoming.fileKey === saved.fileKey &&
          incoming.nodeId === saved.nodeId &&
          incoming.label === saved.label,
      );
    });
    const merged = [...retained, ...normalizedIncoming];
    await writeWorkspaceCodeConnectMaps(params.workspaceId, merged);
    return {
      source: "pmos-figma-rest-compat",
      transport: "rest_compat",
      saved: true,
      totalSaved: normalizedIncoming.length,
      mappings: normalizedIncoming,
    };
  }

  const token = requirePat(auth);

  if (!target.fileKey) {
    throw new Error("FIGMA_FILE_CONTEXT_MISSING");
  }

  switch (params.toolName) {
    case "figma.get_metadata": {
      const node = target.nodeId
        ? await fetchNode(token, target.fileKey, target.nodeId, 6)
        : asRecord((await fetchFile(token, target.fileKey, 4)).document);
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId: target.nodeId,
        selectedFileName: target.selectedFileName,
        metadataXml: buildMetadataXml(node),
        metadata: {
          node: {
            id: stringOrNull(node.id),
            name: stringOrNull(node.name),
            type: stringOrNull(node.type),
            ...getNodeBounds(node),
          },
          stats: collectNodeStats(node),
        },
      };
    }
    case "figma.get_screenshot": {
      const requestedNodeId = target.nodeId ?? "0:1";
      const format = stringOrNull(params.args.format) ?? "png";
      const node =
        !target.nodeId || requestedNodeId === "0:1"
          ? asRecord((await fetchFile(token, target.fileKey, 2)).document)
          : await fetchNode(token, target.fileKey, target.nodeId, 3);
      const screenshotCandidates = collectScreenshotCandidateNodeIds(node, requestedNodeId, 6);
      const attemptedNodeIds: string[] = [];
      const images: Record<string, string | null> = {};
      let resolvedNodeId = requestedNodeId;
      let imageUrl: string | null = null;
      let lastError: unknown = null;
      for (const candidateId of screenshotCandidates) {
        attemptedNodeIds.push(candidateId);
        try {
          const candidateImages = await fetchImages(token, target.fileKey, [candidateId], format);
          const candidateUrl = stringOrNull(candidateImages[candidateId]);
          images[candidateId] = candidateUrl;
          if (candidateUrl) {
            resolvedNodeId = candidateId;
            imageUrl = candidateUrl;
            break;
          }
        } catch (err) {
          lastError = err;
          images[candidateId] = null;
        }
      }
      if (!imageUrl && lastError && attemptedNodeIds.length <= 1) {
        throw lastError;
      }
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId: resolvedNodeId,
        requestedNodeId,
        format,
        imageUrl,
        images,
        fallbackUsed: resolvedNodeId !== requestedNodeId,
        fallbackCandidates: screenshotCandidates,
        attemptedNodeIds,
        note: imageUrl
          ? resolvedNodeId !== requestedNodeId
            ? `Figma did not return an image for ${requestedNodeId}; PMOS used fallback node ${resolvedNodeId}.`
            : null
          : "Figma did not return a screenshot for the requested node or the fallback candidates.",
      };
    }
    case "figma.get_comments": {
      const comments = filterCommentsForNode(
        await fetchComments(token, target.fileKey),
        target.nodeId,
      );
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId: target.nodeId,
        totalComments: comments.length,
        comments: summarizeComments(comments),
      };
    }
    case "figma.get_annotations": {
      const comments = filterCommentsForNode(
        await fetchComments(token, target.fileKey),
        target.nodeId,
      );
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId: target.nodeId,
        totalAnnotations: comments.length,
        annotations: summarizeComments(comments),
      };
    }
    case "figma.get_variable_defs": {
      const node = target.nodeId
        ? await fetchNode(token, target.fileKey, target.nodeId, 6)
        : asRecord((await fetchFile(token, target.fileKey, 4)).document);
      let payload: Record<string, unknown>;
      try {
        payload = await fetchLocalVariables(token, target.fileKey);
      } catch (err) {
        const requiredScope = parseRequiredScopeFromErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        if (requiredScope) {
          return {
            source: "pmos-figma-rest-compat",
            transport: "rest_compat",
            fileKey: target.fileKey,
            nodeId: target.nodeId,
            status: "scope_required",
            requiredScope,
            matchedCount: 0,
            boundVariableIds: [...new Set(collectBoundVariableIds(node))],
            definitions: {},
            variables: [],
            hasPersonalAccessToken: auth.hasPersonalAccessToken,
            note: `The current workspace Figma token is missing the ${requiredScope} scope, so variable definitions are unavailable for this file.`,
          };
        }
        throw err;
      }
      const variables = normalizeVariableList(payload);
      const boundIds = new Set(collectBoundVariableIds(node));
      const matchedVariables =
        boundIds.size > 0
          ? variables.filter((variable) => {
              const id = stringOrNull(variable.id) ?? stringOrNull(variable.variableId);
              return Boolean(id && boundIds.has(id));
            })
          : variables;
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId: target.nodeId,
        matchedCount: matchedVariables.length,
        boundVariableIds: [...boundIds],
        definitions: matchedVariables.reduce<Record<string, unknown>>((acc, variable) => {
          const name = stringOrNull(variable.name);
          if (!name) {
            return acc;
          }
          acc[name] =
            variable.resolvedValue ??
            variable.valuesByMode ??
            variable.defaultValue ??
            null;
          return acc;
        }, {}),
        variables: matchedVariables.slice(0, 200),
      };
    }
    case "figma.get_components": {
      const file = await fetchFile(token, target.fileKey, 2);
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        components: listMapItems(file.components),
        componentSets: listMapItems(file.componentSets),
      };
    }
    case "figma.get_styles": {
      const file = await fetchFile(token, target.fileKey, 2);
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        styles: listMapItems(file.styles),
      };
    }
    case "figma.get_code_connect_suggestions": {
      const node = target.nodeId
        ? await fetchNode(token, target.fileKey, target.nodeId, 4)
        : asRecord((await fetchFile(token, target.fileKey, 3)).document);
      const nodeId = target.nodeId ?? stringOrNull(node.id);
      const existingMappings = await readWorkspaceCodeConnectMaps(params.workspaceId);
      const label =
        stringOrNull(params.args.clientFrameworks) ??
        stringOrNull(params.args.clientLanguages) ??
        "unknown";
      const suggestions = buildCodeConnectSuggestions({
        nodeName: stringOrNull(node.name),
        fileKey: target.fileKey,
        nodeId,
        label,
        existingMappings,
      });
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId,
        suggestions,
      };
    }
    case "figma.create_design_system_rules": {
      const [file, variablesPayload] = await Promise.all([
        fetchFile(token, target.fileKey, 2),
        fetchLocalVariables(token, target.fileKey).catch(() => ({})),
      ]);
      const components = listMapItems(file.components);
      const componentSets = listMapItems(file.componentSets);
      const styles = listMapItems(file.styles);
      const variables = normalizeVariableList(asRecord(variablesPayload));
      const framework = stringOrNull(params.args.clientFrameworks);
      const language = stringOrNull(params.args.clientLanguages);
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        framework,
        language,
        summary: {
          components: components.length,
          componentSets: componentSets.length,
          styles: styles.length,
          variables: variables.length,
        },
        rules: buildDesignSystemRules({
          fileKey: target.fileKey,
          fileName: target.selectedFileName,
          framework,
          language,
          componentCount: components.length,
          componentSetCount: componentSets.length,
          styleCount: styles.length,
          variableCount: variables.length,
          topComponentNames: summarizeListNames(components),
          topStyleNames: summarizeListNames(styles),
          topVariableNames: variables
            .map((value) => stringOrNull(value.name) ?? stringOrNull(value.key))
            .filter(Boolean)
            .slice(0, 8) as string[],
        }),
      };
    }
    case "figma.get_figjam": {
      const node = target.nodeId
        ? await fetchNode(token, target.fileKey, target.nodeId, 6)
        : asRecord((await fetchFile(token, target.fileKey, 4)).document);
      const screenshotNodeId = target.nodeId ?? stringOrNull(node.id) ?? "0:1";
      const includeImages = params.args.includeImagesOfNodes === true;
      const images: Record<string, string | null> = includeImages
        ? await fetchImages(token, target.fileKey, [screenshotNodeId]).catch(
            () => ({} as Record<string, string | null>),
          )
        : {};
      const metadataXml = buildMetadataXml(node);
      const notes = collectTextNodes(node, 60);
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId: target.nodeId ?? stringOrNull(node.id),
        metadataXml,
        notes,
        noteCount: notes.length,
        imageUrl: stringOrNull(images[screenshotNodeId]),
        code: [
          `FigJam context for ${target.selectedFileName ?? target.fileKey}${target.nodeId ? ` node ${target.nodeId}` : ""}.`,
          `Visible text note count: ${notes.length}.`,
          notes.length ? `Sample notes: ${notes.slice(0, 10).join(" | ")}` : "Sample notes: none detected.",
          "Metadata XML:",
          metadataXml,
        ].join("\n"),
      };
    }
    case "figma.get_design_context": {
      const node = target.nodeId
        ? await fetchNode(token, target.fileKey, target.nodeId, 6)
        : asRecord((await fetchFile(token, target.fileKey, 4)).document);
      const [commentPayload, screenshotPayload, variableDefs] = await Promise.all([
        fetchComments(token, target.fileKey).catch(() => []),
        fetchImages(token, target.fileKey, [target.nodeId ?? stringOrNull(node.id) ?? "0:1"]).catch(() =>
          ({} as Record<string, string | null>)
        ),
        fetchLocalVariables(token, target.fileKey).catch(() => ({})),
      ]) as [Record<string, unknown>[], Record<string, string | null>, Record<string, unknown>];
      const normalizedComments = filterCommentsForNode(commentPayload, target.nodeId);
      const normalizedVariables = normalizeVariableList(asRecord(variableDefs));
      const boundIds = new Set(collectBoundVariableIds(node));
      const relevantVariables =
        boundIds.size > 0
          ? normalizedVariables.filter((variable) => {
              const id = stringOrNull(variable.id) ?? stringOrNull(variable.variableId);
              return Boolean(id && boundIds.has(id));
            })
          : normalizedVariables.slice(0, 50);
      const screenshotNodeId = target.nodeId ?? stringOrNull(node.id) ?? "0:1";
      const screenshotUrl = stringOrNull(screenshotPayload[screenshotNodeId]);
      const metadataXml = buildMetadataXml(node);
      const stats = collectNodeStats(node);
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId: target.nodeId ?? stringOrNull(node.id),
        code: buildDesignContextCode({
          fileKey: target.fileKey,
          nodeId: target.nodeId,
          fileName: target.selectedFileName,
          metadataXml,
          screenshotUrl,
          comments: summarizeComments(normalizedComments),
          variableDefs: relevantVariables,
          stats,
        }),
        assets: screenshotUrl ? { screenshot: screenshotUrl } : {},
        metadataXml,
        screenshotUrl,
        comments: summarizeComments(normalizedComments),
        variableDefs: relevantVariables,
        stats,
      };
    }
    default:
      throw new Error(`Unsupported Figma compatibility tool: ${params.toolName}`);
  }
}

export async function beginWorkspaceFigmaMcpOAuth(params: {
  workspaceId: string;
  redirectUrl: string;
}): Promise<FigmaMcpAuthStartResult> {
  void params.redirectUrl;
  const auth = await readWorkspaceFigmaAuth(params.workspaceId);
  if (auth.hasPersonalAccessToken) {
    return { ok: true, alreadyAuthorized: true, authorizationUrl: null };
  }
  return {
    ok: false,
    alreadyAuthorized: false,
    authorizationUrl: null,
    unsupported: true,
    reason:
      "Figma remote MCP OAuth is not supported for PMOS. Use the workspace Figma panel sync so PMOS can use the PAT-backed REST compatibility bridge.",
  };
}

export async function finishWorkspaceFigmaMcpOAuth(params: {
  workspaceId: string;
  code: string;
  state: string;
}): Promise<void> {
  void params.workspaceId;
  void params.code;
  void params.state;
  throw new Error(
    "Figma remote MCP OAuth is not supported for PMOS. Use the workspace Figma panel sync and the PAT-backed REST compatibility bridge instead.",
  );
}

export async function listWorkspaceFigmaMcpTools(workspaceId: string): Promise<unknown> {
  const auth = await readWorkspaceFigmaAuth(workspaceId);
  return {
    source: "pmos-figma-rest-compat",
    transport: "rest_compat",
    compatibilityMode: true,
    authRequired: !auth.hasPersonalAccessToken,
    mcpServerUrl: auth.mcpServerUrl,
    availableWithoutPersonalAccessToken: [...FIGMA_TOOLS_AVAILABLE_WITHOUT_PAT],
    tools: FIGMA_REST_COMPAT_TOOLS,
  };
}

export async function callWorkspaceFigmaMcpTool(params: {
  workspaceId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const normalizedToolName = String(params.toolName || "").trim().replace(/^(?:figma\.)+/i, "figma.");
  const toolName = normalizedToolName.startsWith("figma.")
    ? normalizedToolName
    : `figma.${normalizedToolName}`;
  return callCompatTool({
    workspaceId: params.workspaceId,
    toolName,
    args: params.args ?? {},
  });
}

export async function probeWorkspaceFigmaMcpStatus(workspaceId: string): Promise<FigmaMcpProbeStatus> {
  const auth = await readWorkspaceFigmaAuth(workspaceId);
  if (!auth.hasPersonalAccessToken) {
    return {
      url: auth.mcpServerUrl,
      configured: true,
      reachable: null,
      authOk: false,
      authRequired: true,
      transport: "rest_compat",
      source: auth.source,
      hasPersonalAccessToken: false,
      fallbackAvailable: false,
      error:
        "Workspace Figma PAT sync is required for the PMOS Figma MCP-compatible REST bridge.",
    };
  }
  return {
    url: auth.mcpServerUrl,
    configured: true,
    reachable: true,
    authOk: true,
    authRequired: false,
    transport: "rest_compat",
    source: auth.source,
    hasPersonalAccessToken: true,
    fallbackAvailable: true,
    error: null,
  };
}

export function resolveWorkspaceIdFromFigmaMcpState(state: string): string | null {
  const trimmed = state.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf(":");
  if (separator <= 0) return null;
  const workspaceId = trimmed.slice(0, separator).trim();
  return workspaceId || null;
}

export type FigmaMcpConnectUrlParams = {
  basePath: string;
};

export function buildFigmaMcpConnectPath(params: FigmaMcpConnectUrlParams): string {
  const basePath = params.basePath.trim().replace(/\/+$/, "");
  return `${basePath}/api/pmos/auth/figma-mcp/start`;
}

export const __test = {
  normalizeNodeId,
  parseNodeIdFromUrl,
  parseRequiredScopeFromErrorMessage,
  buildMetadataXml,
  resolveRequestedTarget,
  workspaceFigmaCodeConnectPath,
  workspaceFigmaArtifactsDir,
  workspaceFigmaCapturePath,
};
