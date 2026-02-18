import type { UiSettings } from "../storage.ts";
import type { PmosAuthUser } from "./pmos-auth.ts";

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
  pmosOpsProjectId: string;
  apFlowCreateName: string;
  pmosAuthUser?: PmosAuthUser | null;

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
  state: Pick<PmosFlowBuilderState, "settings" | "basePath" | "sessionKey" | "pmosAuthUser">,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  const token = state.settings.token?.trim() ?? "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Prefer bearer token when present (remote gateway/operator mode), otherwise rely on PMOS session cookie.
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const wsId = state.pmosAuthUser?.workspaceId;
  const isSuper = state.pmosAuthUser?.role === "super_admin";
  const toolArgs =
    wsId && !isSuper && !("workspaceId" in args) ? { ...args, workspaceId: wsId } : args;

  const res = await fetch(resolveToolsInvokeUrl(state), {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      tool,
      args: toolArgs,
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
  { re: /\bslack\b/i, label: "Post to Slack", piece: "n8n-nodes-base.slack" },
  { re: /\bgmail|email\b/i, label: "Send Email", piece: "n8n-nodes-base.gmail" },
  { re: /\bgoogle\s*sheets|sheets\b/i, label: "Write to Google Sheets", piece: "n8n-nodes-base.googleSheets" },
  { re: /\bnotion\b/i, label: "Update Notion", piece: "n8n-nodes-base.notion" },
  { re: /\bdiscord\b/i, label: "Send Discord message", piece: "n8n-nodes-base.discord" },
  { re: /\btelegram\b/i, label: "Send Telegram message", piece: "n8n-nodes-base.telegram" },
  { re: /\bairtable\b/i, label: "Update Airtable", piece: "n8n-nodes-base.airtable" },
];

function detectActions(prompt: string): Array<{ label: string; piece: string }> {
  const found = ACTION_KEYWORDS.filter((entry) => entry.re.test(prompt)).map((entry) => ({
    label: entry.label,
    piece: entry.piece,
  }));
  if (found.length > 0) {
    return found.slice(0, 5);
  }
  return [{ label: "Send HTTP request", piece: "n8n-nodes-base.httpRequest" }];
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
    piece: triggerLabel === "Schedule Trigger" ? "n8n-nodes-base.scheduleTrigger" : "n8n-nodes-base.webhook",
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
  const flowName = state.pmosFlowBuilderFlowName.trim() || state.apFlowCreateName.trim() || "New Automation";
  state.pmosFlowBuilderCommitting = true;
  state.pmosFlowBuilderError = null;
  try {
    const n8nNodes = state.pmosFlowBuilderNodes.map((node, index) => ({
      id: node.id,
      name: node.label,
      type:
        node.type === "trigger"
          ? node.piece ?? "n8n-nodes-base.webhook"
          : "n8n-nodes-base.set",
      typeVersion: 1,
      position: [280 + index * 260, 320],
      parameters:
        node.type === "trigger"
          ? {}
          : {
              keepOnlySet: false,
              values: {
                string: [
                  {
                    name: "step",
                    value: node.label,
                  },
                ],
              },
            },
    }));

    const n8nConnections: Record<string, unknown> = {};
    for (const edge of state.pmosFlowBuilderEdges) {
      const fromNode = n8nNodes.find((node) => node.id === edge.from);
      const toNode = n8nNodes.find((node) => node.id === edge.to);
      if (!fromNode || !toNode) {
        continue;
      }
      n8nConnections[fromNode.name] = {
        main: [
          [
            {
              node: toNode.name,
              type: "main",
              index: 0,
            },
          ],
        ],
      };
    }

    const created = await invokeTool<Record<string, unknown>>(state, "ops_workflow_create", {
      name: flowName,
      nodes: n8nNodes,
      connections: n8nConnections,
      settings: {},
    });
    const payload =
      created && typeof created === "object" && !Array.isArray(created)
        ? ((created as { data?: unknown }).data ?? created)
        : created;
    const flowId = typeof (payload as { id?: unknown })?.id === "string"
      ? ((payload as { id: string }).id).trim()
      : "";
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
