import type { UiSettings } from "../storage.ts";

export type PmosFlowGraphNode = {
  id: string;
  type: "trigger" | "action";
  label: string;
  piece?: string;
};

export type PmosFlowGraphEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
};

export type PmosFlowGraphOp = {
  id: string;
  ts: number;
  kind: "add_node" | "add_edge" | "set_mapping";
  detail: string;
  node?: PmosFlowGraphNode;
  edge?: PmosFlowGraphEdge;
  mapping?: Record<string, unknown>;
};

type ToolInvokeOk = {
  ok: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
};

type ToolInvokeErr = {
  ok: false;
  error?: { type?: string; message?: string };
};

export type PmosFlowBuilderState = {
  connected: boolean;
  settings: UiSettings;
  basePath: string;
  sessionKey: string;
  pmosActivepiecesProjectId: string;
  apFlowCreateName: string;

  pmosFlowBuilderPrompt: string;
  pmosFlowBuilderGenerating: boolean;
  pmosFlowBuilderCommitting: boolean;
  pmosFlowBuilderError: string | null;
  pmosFlowBuilderFlowName: string;
  pmosFlowBuilderNodes: PmosFlowGraphNode[];
  pmosFlowBuilderEdges: PmosFlowGraphEdge[];
  pmosFlowBuilderOps: PmosFlowGraphOp[];
  pmosFlowBuilderOpIndex: number;
  pmosFlowBuilderLastCommittedFlowId: string | null;

  handlePmosApFlowsLoad: () => Promise<void>;
  handlePmosApFlowSelect: (flowId: string) => Promise<void>;
};

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeBasePath(basePath: string): string {
  const trimmed = (basePath ?? "").trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function resolveToolsInvokeUrl(state: { basePath: string }): string {
  const base = normalizeBasePath(state.basePath);
  return base ? `${base}/tools/invoke` : "/tools/invoke";
}

async function invokeTool<T = unknown>(
  state: Pick<PmosFlowBuilderState, "settings" | "basePath" | "sessionKey">,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  const token = state.settings.token?.trim() ?? "";
  if (!token) {
    throw new Error("PMOS access key missing. Go to Dashboard -> System -> paste key -> Connect.");
  }
  const res = await fetch(resolveToolsInvokeUrl(state), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      tool,
      args,
      sessionKey: state.sessionKey || "main",
    }),
  });
  const data = (await res.json().catch(() => null)) as ToolInvokeOk | ToolInvokeErr | null;
  if (!data) {
    throw new Error(`Tool invoke failed (${res.status}): empty response`);
  }
  if (!data.ok) {
    const message = data.error?.message ?? `Tool invoke failed (${res.status})`;
    throw new Error(message);
  }
  const details = (data.result as { details?: unknown } | null)?.details;
  return (details ?? data.result) as T;
}

function toTitleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function inferFlowName(prompt: string): string {
  const named = prompt.match(/flow\s+(?:named|called)\s+["']?([^"']+)["']?/i);
  if (named?.[1]?.trim()) {
    return named[1].trim();
  }
  const afterCreate = prompt.match(/create\s+(?:an?\s+)?flow\s+(?:for\s+)?(.+)/i);
  if (afterCreate?.[1]?.trim()) {
    const candidate = afterCreate[1].trim();
    const cleaned = candidate.replace(/[.?!]+$/, "").slice(0, 64).trim();
    return cleaned ? toTitleCase(cleaned) : "New Automation";
  }
  const words = prompt
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  return words ? toTitleCase(words) : "New Automation";
}

const ACTION_KEYWORDS: Array<{ re: RegExp; label: string; piece: string }> = [
  { re: /\bslack\b/i, label: "Post to Slack", piece: "@activepieces/piece-slack" },
  { re: /\bgmail|email\b/i, label: "Send Email", piece: "@activepieces/piece-gmail" },
  { re: /\bgoogle\s*sheets|sheets\b/i, label: "Write to Google Sheets", piece: "@activepieces/piece-google-sheets" },
  { re: /\bnotion\b/i, label: "Update Notion", piece: "@activepieces/piece-notion" },
  { re: /\bdiscord\b/i, label: "Send Discord message", piece: "@activepieces/piece-discord" },
  { re: /\btelegram\b/i, label: "Send Telegram message", piece: "@activepieces/piece-telegram" },
  { re: /\bairtable\b/i, label: "Update Airtable", piece: "@activepieces/piece-airtable" },
];

function detectActions(prompt: string): Array<{ label: string; piece: string }> {
  const found = ACTION_KEYWORDS.filter((entry) => entry.re.test(prompt)).map((entry) => ({
    label: entry.label,
    piece: entry.piece,
  }));
  if (found.length > 0) {
    return found.slice(0, 5);
  }
  return [{ label: "Send HTTP request", piece: "@activepieces/piece-http" }];
}

function buildGraphOps(promptRaw: string): {
  flowName: string;
  nodes: PmosFlowGraphNode[];
  edges: PmosFlowGraphEdge[];
  ops: PmosFlowGraphOp[];
} {
  const prompt = promptRaw.trim();
  const flowName = inferFlowName(prompt);
  const triggerLabel = /\b(schedule|daily|hourly|cron|every day)\b/i.test(prompt)
    ? "Schedule Trigger"
    : "Webhook Trigger";
  const triggerNode: PmosFlowGraphNode = {
    id: "node-trigger",
    type: "trigger",
    label: triggerLabel,
    piece: triggerLabel === "Schedule Trigger" ? "@activepieces/piece-schedule" : "@activepieces/piece-webhook",
  };

  const actionDefs = detectActions(prompt);
  const actionNodes: PmosFlowGraphNode[] = actionDefs.map((def, index) => ({
    id: `node-action-${index + 1}`,
    type: "action",
    label: def.label,
    piece: def.piece,
  }));

  const nodes = [triggerNode, ...actionNodes];
  const edges: PmosFlowGraphEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const edge: PmosFlowGraphEdge = {
      id: `edge-${i + 1}`,
      from: nodes[i]!.id,
      to: nodes[i + 1]!.id,
      label: "then",
    };
    edges.push(edge);
  }

  const ops: PmosFlowGraphOp[] = [];
  nodes.forEach((node) => {
    ops.push({
      id: nextId("flow-op"),
      ts: Date.now(),
      kind: "add_node",
      detail: `Add ${node.type}: ${node.label}`,
      node,
    });
    ops.push({
      id: nextId("flow-op"),
      ts: Date.now(),
      kind: "set_mapping",
      detail: `Configure ${node.label}`,
      mapping: {
        nodeId: node.id,
        piece: node.piece ?? null,
      },
    });
  });
  edges.forEach((edge) => {
    ops.push({
      id: nextId("flow-op"),
      ts: Date.now(),
      kind: "add_edge",
      detail: `Connect ${edge.from} -> ${edge.to}`,
      edge,
    });
  });

  return { flowName, nodes, edges, ops };
}

export function resetPmosFlowBuilder(state: PmosFlowBuilderState) {
  state.pmosFlowBuilderError = null;
  state.pmosFlowBuilderFlowName = "";
  state.pmosFlowBuilderNodes = [];
  state.pmosFlowBuilderEdges = [];
  state.pmosFlowBuilderOps = [];
  state.pmosFlowBuilderOpIndex = 0;
}

export async function generatePmosFlowBuilderPlan(state: PmosFlowBuilderState) {
  const prompt = state.pmosFlowBuilderPrompt.trim();
  if (!prompt) {
    state.pmosFlowBuilderError = "Describe what you want to automate first.";
    return;
  }
  state.pmosFlowBuilderGenerating = true;
  state.pmosFlowBuilderError = null;
  state.pmosFlowBuilderFlowName = "";
  state.pmosFlowBuilderNodes = [];
  state.pmosFlowBuilderEdges = [];
  state.pmosFlowBuilderOps = [];
  state.pmosFlowBuilderOpIndex = 0;
  try {
    const plan = buildGraphOps(prompt);
    state.pmosFlowBuilderFlowName = plan.flowName;
    state.pmosFlowBuilderNodes = [];
    state.pmosFlowBuilderEdges = [];
    state.pmosFlowBuilderOps = [];

    for (const op of plan.ops) {
      await wait(120);
      state.pmosFlowBuilderOps = [op, ...state.pmosFlowBuilderOps];
      state.pmosFlowBuilderOpIndex += 1;
      if (op.kind === "add_node" && op.node) {
        state.pmosFlowBuilderNodes = [...state.pmosFlowBuilderNodes, op.node];
      } else if (op.kind === "add_edge" && op.edge) {
        state.pmosFlowBuilderEdges = [...state.pmosFlowBuilderEdges, op.edge];
      }
    }
  } catch (err) {
    state.pmosFlowBuilderError = String(err);
  } finally {
    state.pmosFlowBuilderGenerating = false;
  }
}

export async function commitPmosFlowBuilderPlan(state: PmosFlowBuilderState) {
  const projectId = state.pmosActivepiecesProjectId.trim();
  if (!projectId) {
    state.pmosFlowBuilderError =
      "Activepieces Project ID is required. Set it in Integrations -> Activepieces -> Project ID.";
    return;
  }
  const flowName = state.pmosFlowBuilderFlowName.trim() || state.apFlowCreateName.trim() || "New Automation";
  state.pmosFlowBuilderCommitting = true;
  state.pmosFlowBuilderError = null;
  try {
    const created = await invokeTool<Record<string, unknown>>(state, "flow_flow_create", {
      projectId,
      displayName: flowName,
    });
    const flowId = typeof created?.id === "string" ? created.id.trim() : "";
    if (!flowId) {
      throw new Error("Flow creation did not return an id.");
    }
    state.pmosFlowBuilderLastCommittedFlowId = flowId;
    await state.handlePmosApFlowsLoad();
    await state.handlePmosApFlowSelect(flowId);
  } catch (err) {
    state.pmosFlowBuilderError = String(err);
  } finally {
    state.pmosFlowBuilderCommitting = false;
  }
}
