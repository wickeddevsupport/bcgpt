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

function toXmlAttr(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  const directCollections = asArray(payload.meta?.variables);
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
      "Return the current workspace Figma connector identity and selected-file context from PMOS.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

async function callCompatTool(params: {
  workspaceId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const auth = await readWorkspaceFigmaAuth(params.workspaceId);
  const token = requirePat(auth);
  const workspaceTarget = await readWorkspaceFigmaTarget(params.workspaceId);
  const target = resolveRequestedTarget(params.args, workspaceTarget);

  if (params.toolName === "figma.whoami") {
    return {
      source: "pmos-figma-rest-compat",
      transport: "rest_compat",
      workspaceId: params.workspaceId,
      selectedFileName: workspaceTarget.selectedFileName,
      selectedFileUrl: workspaceTarget.selectedFileUrl,
      selectedFileId: workspaceTarget.selectedFileId,
      fileKey: workspaceTarget.fileKey,
      nodeId: workspaceTarget.nodeId,
      hasPersonalAccessToken: auth.hasPersonalAccessToken,
      sourceLabel: auth.source,
    };
  }

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
      const nodeId = target.nodeId ?? "0:1";
      const format = stringOrNull(params.args.format) ?? "png";
      const images = await fetchImages(token, target.fileKey, [nodeId], format);
      return {
        source: "pmos-figma-rest-compat",
        transport: "rest_compat",
        fileKey: target.fileKey,
        nodeId,
        format,
        imageUrl: images[nodeId] ?? null,
        images,
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
    case "figma.get_variable_defs": {
      const node = target.nodeId
        ? await fetchNode(token, target.fileKey, target.nodeId, 6)
        : asRecord((await fetchFile(token, target.fileKey, 4)).document);
      const payload = await fetchLocalVariables(token, target.fileKey);
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
    case "figma.get_design_context": {
      const node = target.nodeId
        ? await fetchNode(token, target.fileKey, target.nodeId, 6)
        : asRecord((await fetchFile(token, target.fileKey, 4)).document);
      const [commentPayload, screenshotPayload, variableDefs] = await Promise.all([
        fetchComments(token, target.fileKey).catch(() => []),
        fetchImages(token, target.fileKey, [target.nodeId ?? stringOrNull(node.id) ?? "0:1"]).catch(
          () => ({}),
        ),
        fetchLocalVariables(token, target.fileKey).catch(() => ({})),
      ]);
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
  if (!auth.hasPersonalAccessToken) {
    throw new Error("FIGMA_PAT_REQUIRED");
  }
  return {
    source: "pmos-figma-rest-compat",
    transport: "rest_compat",
    compatibilityMode: true,
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
  buildMetadataXml,
  resolveRequestedTarget,
};
