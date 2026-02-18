import type { UiSettings } from "../storage.ts";
import type { PmosAuthUser } from "./pmos-auth.ts";

export type PmosCommandRisk = "low" | "high";
export type PmosCommandAction =
  | "refresh_connectors"
  | "list_flows"
  | "create_flow"
  | "trigger_flow"
  | "delete_flow";

export type PmosCommandPlanStep = {
  id: string;
  action: PmosCommandAction;
  title: string;
  detail?: string;
  risk: PmosCommandRisk;
  args: Record<string, unknown>;
  status: "planned" | "running" | "success" | "error" | "pending_approval";
  result?: string;
};

export type PmosCommandHistoryEntry = {
  id: string;
  ts: number;
  prompt: string;
  status: "planned" | "executed" | "needs_approval" | "failed";
  summary: string;
  steps: PmosCommandPlanStep[];
};

export type PmosCommandPendingApproval = {
  id: string;
  ts: number;
  prompt: string;
  step: PmosCommandPlanStep;
};

type HistoryStatus = PmosCommandHistoryEntry["status"];

type ToolInvokeOk = {
  ok: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
};

type ToolInvokeErr = {
  ok: false;
  error?: { type?: string; message?: string };
};

export type PmosCommandCenterState = {
  connected: boolean;
  settings: UiSettings;
  basePath: string;
  sessionKey: string;
  pmosOpsProjectId: string;
  pmosAuthUser?: PmosAuthUser | null;

  pmosCommandPrompt: string;
  pmosCommandPlanning: boolean;
  pmosCommandExecuting: boolean;
  pmosCommandError: string | null;
  pmosCommandPlan: PmosCommandPlanStep[];
  pmosCommandHistory: PmosCommandHistoryEntry[];
  pmosCommandPendingApprovals: PmosCommandPendingApproval[];

  handlePmosRefreshConnectors: () => Promise<void>;
  handlePmosApFlowsLoad: () => Promise<void>;
  handlePmosApRunsLoad: () => Promise<void>;
};

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function summarizeToolDetails(value: unknown): string {
  if (value === undefined || value === null) {
    return "ok";
  }
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 180)}...` : value;
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  } catch {
    return String(value);
  }
}

function prependHistory(
  state: Pick<PmosCommandCenterState, "pmosCommandHistory">,
  entry: {
    prompt: string;
    status: HistoryStatus;
    summary: string;
    steps: PmosCommandPlanStep[];
    id?: string;
    ts?: number;
  },
) {
  const normalized: PmosCommandHistoryEntry = {
    id: entry.id ?? nextId("cmd-history"),
    ts: entry.ts ?? Date.now(),
    prompt: entry.prompt,
    status: entry.status,
    summary: entry.summary,
    steps: entry.steps,
  };
  state.pmosCommandHistory = [normalized, ...state.pmosCommandHistory].slice(0, 120);
}

async function invokeTool<T = unknown>(
  state: Pick<PmosCommandCenterState, "settings" | "basePath" | "sessionKey" | "pmosAuthUser">,
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

function parsePrompt(promptRaw: string): PmosCommandPlanStep[] {
  const prompt = promptRaw.trim();
  const lower = prompt.toLowerCase();
  const steps: PmosCommandPlanStep[] = [];

  const addStep = (
    action: PmosCommandAction,
    title: string,
    args: Record<string, unknown>,
    risk: PmosCommandRisk,
    detail?: string,
  ) => {
    steps.push({
      id: nextId("cmd-step"),
      action,
      title,
      detail,
      risk,
      args,
      status: "planned",
    });
  };

  const createFlowMatch = prompt.match(/create\s+flow(?:\s+(?:named|called))?\s+(.+)/i);
  if (createFlowMatch && createFlowMatch[1]) {
    const displayName = createFlowMatch[1].trim().replace(/^["']|["']$/g, "");
    addStep(
      "create_flow",
      `Create flow: ${displayName || "Untitled"}`,
      { displayName: displayName || "Untitled Flow" },
      "low",
      "Creates a new n8n workflow.",
    );
  }

  const triggerFlowMatch = prompt.match(/trigger\s+flow\s+([a-zA-Z0-9_-]{8,})/i);
  if (triggerFlowMatch && triggerFlowMatch[1]) {
    addStep(
      "trigger_flow",
      `Trigger flow: ${triggerFlowMatch[1]}`,
      { flowId: triggerFlowMatch[1] },
      "low",
      "Triggers a workflow execution.",
    );
  }

  const deleteFlowMatch = prompt.match(/delete\s+flow\s+([a-zA-Z0-9_-]{8,})/i);
  if (deleteFlowMatch && deleteFlowMatch[1]) {
    addStep(
      "delete_flow",
      `Delete flow: ${deleteFlowMatch[1]}`,
      { flowId: deleteFlowMatch[1] },
      "high",
      "Destructive action; requires manual approval.",
    );
  }

  if (lower.includes("status") || lower.includes("health") || lower.includes("overview")) {
    addStep(
      "refresh_connectors",
      "Refresh connector + dashboard health",
      {},
      "low",
      "Runs connector checks and refreshes dashboard datasets.",
    );
    addStep("list_flows", "List latest flows", {}, "low");
  }

  if (steps.length === 0) {
    addStep(
      "refresh_connectors",
      "Refresh connector + dashboard health",
      {},
      "low",
      "No direct command detected, running health refresh.",
    );
    addStep("list_flows", "List latest flows", {}, "low");
  }

  return steps;
}

export async function planPmosCommand(state: PmosCommandCenterState) {
  const prompt = state.pmosCommandPrompt.trim();
  if (!prompt) {
    state.pmosCommandError = "Enter a command or objective first.";
    return;
  }
  state.pmosCommandPlanning = true;
  state.pmosCommandError = null;
  try {
    state.pmosCommandPlan = parsePrompt(prompt);
    prependHistory(state, {
      prompt,
      status: "planned",
      summary: `Planned ${state.pmosCommandPlan.length} step(s).`,
      steps: state.pmosCommandPlan.map((step) => ({ ...step })),
    });
  } catch (err) {
    state.pmosCommandError = String(err);
  } finally {
    state.pmosCommandPlanning = false;
  }
}

async function executePlanStep(
  state: PmosCommandCenterState,
  step: PmosCommandPlanStep,
): Promise<string> {
  switch (step.action) {
    case "refresh_connectors": {
      await Promise.all([
        state.handlePmosRefreshConnectors(),
        state.handlePmosApFlowsLoad(),
        state.handlePmosApRunsLoad(),
      ]);
      return "Connector checks and datasets refreshed.";
    }
    case "list_flows": {
      const details = await invokeTool(state, "ops_workflows_list", {});
      return `Loaded flows: ${summarizeToolDetails(details)}`;
    }
    case "create_flow": {
      const displayName =
        typeof step.args.displayName === "string" && step.args.displayName.trim()
          ? step.args.displayName.trim()
          : "Untitled Flow";
      const details = await invokeTool(state, "ops_workflow_create", {
        name: displayName,
      });
      await state.handlePmosApFlowsLoad();
      return `Flow created: ${summarizeToolDetails(details)}`;
    }
    case "trigger_flow": {
      const flowId =
        typeof step.args.flowId === "string" && step.args.flowId.trim() ? step.args.flowId.trim() : "";
      if (!flowId) {
        throw new Error("Flow ID required to trigger flow.");
      }
      const details = await invokeTool(state, "ops_workflow_execute", {
        workflowId: flowId,
        data: {},
      });
      await state.handlePmosApRunsLoad();
      return `Flow triggered: ${summarizeToolDetails(details)}`;
    }
    case "delete_flow": {
      const flowId =
        typeof step.args.flowId === "string" && step.args.flowId.trim() ? step.args.flowId.trim() : "";
      if (!flowId) {
        throw new Error("Flow ID required to delete flow.");
      }
      const details = await invokeTool(state, "ops_workflow_delete", { workflowId: flowId });
      await state.handlePmosApFlowsLoad();
      return `Flow deleted: ${summarizeToolDetails(details)}`;
    }
    default:
      throw new Error(`Unsupported action: ${step.action}`);
  }
}

export async function executePmosCommandPlan(state: PmosCommandCenterState) {
  if (!state.pmosCommandPlan.length) {
    state.pmosCommandError = "No plan available. Click Plan first.";
    return;
  }
  state.pmosCommandExecuting = true;
  state.pmosCommandError = null;
  try {
    const updated = [...state.pmosCommandPlan];
    for (let i = 0; i < updated.length; i++) {
      const step = updated[i]!;
      if (step.risk === "high") {
        step.status = "pending_approval";
        const approval: PmosCommandPendingApproval = {
          id: nextId("approval"),
          ts: Date.now(),
          prompt: state.pmosCommandPrompt.trim(),
          step: { ...step },
        };
        state.pmosCommandPendingApprovals = [approval, ...state.pmosCommandPendingApprovals].slice(0, 50);
        state.pmosCommandPlan = updated;
        prependHistory(state, {
          prompt: state.pmosCommandPrompt.trim(),
          status: "needs_approval",
          summary: `Paused for approval: ${step.title}`,
          steps: updated.map((entry) => ({ ...entry })),
        });
        return;
      }
      step.status = "running";
      state.pmosCommandPlan = [...updated];
      try {
        const result = await executePlanStep(state, step);
        step.status = "success";
        step.result = result;
      } catch (err) {
        step.status = "error";
        step.result = String(err);
        state.pmosCommandPlan = [...updated];
        prependHistory(state, {
          prompt: state.pmosCommandPrompt.trim(),
          status: "failed",
          summary: `Failed: ${step.title}`,
          steps: updated.map((entry) => ({ ...entry })),
        });
        throw err;
      }
      state.pmosCommandPlan = [...updated];
    }

    prependHistory(state, {
      prompt: state.pmosCommandPrompt.trim(),
      status: "executed",
      summary: "Plan executed successfully.",
      steps: updated.map((entry) => ({ ...entry })),
    });
  } catch (err) {
    state.pmosCommandError = String(err);
  } finally {
    state.pmosCommandExecuting = false;
  }
}

export async function approvePmosCommandStep(state: PmosCommandCenterState, approvalId: string) {
  const target = approvalId.trim();
  if (!target) {
    return;
  }
  const approval = state.pmosCommandPendingApprovals.find((entry) => entry.id === target);
  if (!approval) {
    state.pmosCommandError = `Approval item not found: ${target}`;
    return;
  }
  state.pmosCommandExecuting = true;
  state.pmosCommandError = null;
  try {
    const result = await executePlanStep(state, { ...approval.step, status: "running" });
    state.pmosCommandPendingApprovals = state.pmosCommandPendingApprovals.filter((entry) => entry.id !== target);
    prependHistory(state, {
      prompt: approval.prompt,
      status: "executed",
      summary: `Approved and executed: ${approval.step.title}`,
      steps: [
        {
          ...approval.step,
          status: "success",
          result,
        },
      ],
    });
    await state.handlePmosApFlowsLoad();
    await state.handlePmosApRunsLoad();
  } catch (err) {
    state.pmosCommandError = String(err);
  } finally {
    state.pmosCommandExecuting = false;
  }
}

export function clearPmosCommandHistory(
  state: Pick<PmosCommandCenterState, "pmosCommandHistory" | "pmosCommandPendingApprovals">,
) {
  state.pmosCommandHistory = [];
  state.pmosCommandPendingApprovals = [];
}
