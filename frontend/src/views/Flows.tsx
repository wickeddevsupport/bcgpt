import { useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Zap,
} from "lucide-react";

interface Workflow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
  createdAt: string;
  tags?: Array<{ name: string }>;
  nodes?: Array<{ type: string; name: string }>;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface PendingApproval {
  action: "deactivate" | "delete";
  workflowId: string;
  workflowName: string;
}

function getN8nBaseUrl(): string {
  return "/ops-ui";
}

function getN8nApiUrl(): string {
  return "/api/ops";
}

function parseWorkflowPayload(data: unknown): Workflow | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  const entry = (payload.data ?? payload) as Record<string, unknown>;
  if (!entry.id || !entry.name) return null;
  return {
    id: String(entry.id),
    name: String(entry.name),
    active: Boolean(entry.active),
    updatedAt: String(entry.updatedAt ?? new Date().toISOString()),
    createdAt: String(entry.createdAt ?? new Date().toISOString()),
    tags: Array.isArray(entry.tags) ? (entry.tags as Array<{ name: string }>) : [],
    nodes: Array.isArray(entry.nodes) ? (entry.nodes as Array<{ type: string; name: string }>) : [],
  };
}

export default function Flows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Use commands like: create workflow named Daily Report, rename to Weekly Report, activate, deactivate, delete workflow, add tag finance. Destructive actions require confirm.",
    },
  ]);

  useEffect(() => {
    void loadWorkflows();
  }, []);

  const selectedWorkflowName = useMemo(() => {
    if (!selectedWorkflow) return "new workflow";
    return workflows.find((w) => w.id === selectedWorkflow)?.name ?? selectedWorkflow;
  }, [selectedWorkflow, workflows]);

  const loadWorkflows = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${getN8nApiUrl()}/workflows`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Failed to load workflows: ${response.statusText}`);
      }
      const data = (await response.json()) as Record<string, unknown>;
      const list = (data.data ?? data.workflows ?? []) as unknown[];
      const normalized = Array.isArray(list)
        ? list
            .map((entry) => parseWorkflowPayload(entry))
            .filter((entry): entry is Workflow => Boolean(entry))
        : [];
      setWorkflows(normalized);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflow = async (workflowId: string): Promise<Record<string, unknown>> => {
    const response = await fetch(`${getN8nApiUrl()}/workflows/${workflowId}`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Failed to load workflow ${workflowId}: ${response.statusText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const payload = (data.data ?? data) as Record<string, unknown>;
    if (!payload || typeof payload !== "object") {
      throw new Error("Workflow payload was invalid");
    }
    return payload;
  };

  const updateWorkflow = async (
    workflowId: string,
    patch: (workflow: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    const current = await fetchWorkflow(workflowId);
    const next = patch(current);
    const response = await fetch(`${getN8nApiUrl()}/workflows/${workflowId}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!response.ok) {
      throw new Error(`Failed to update workflow: ${response.statusText}`);
    }
  };

  const createWorkflow = async (name: string): Promise<string> => {
    const response = await fetch(`${getN8nApiUrl()}/workflows`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        active: false,
        nodes: [],
        connections: {},
        settings: {},
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create workflow: ${response.statusText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const created = parseWorkflowPayload(data);
    if (!created?.id) {
      throw new Error("Workflow create response missing id");
    }
    return created.id;
  };

  const toggleWorkflow = async (workflowId: string, activate: boolean) => {
    const endpoint = activate
      ? `${getN8nApiUrl()}/workflows/${workflowId}/activate`
      : `${getN8nApiUrl()}/workflows/${workflowId}/deactivate`;
    const response = await fetch(endpoint, { method: "POST", credentials: "include" });
    if (!response.ok) {
      throw new Error(`Failed to toggle workflow: ${response.statusText}`);
    }
  };

  const deleteWorkflow = async (workflowId: string) => {
    const response = await fetch(`${getN8nApiUrl()}/workflows/${workflowId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Failed to delete workflow: ${response.statusText}`);
    }
  };

  const runChatCommand = async (command: string): Promise<string> => {
    const normalized = command.trim();
    const lower = normalized.toLowerCase();
    if (!normalized) {
      return "Enter a command first.";
    }

    if (lower === "cancel") {
      if (!pendingApproval) {
        return "No pending action to cancel.";
      }
      const canceled = pendingApproval.workflowName;
      setPendingApproval(null);
      return `Cancelled pending action for "${canceled}".`;
    }

    if (lower === "confirm") {
      if (!pendingApproval) {
        return "Nothing pending approval. Run deactivate or delete workflow first.";
      }
      const approved = pendingApproval;
      setPendingApproval(null);
      if (approved.action === "deactivate") {
        await toggleWorkflow(approved.workflowId, false);
        await loadWorkflows();
        return `Deactivated ${approved.workflowName}.`;
      }
      await deleteWorkflow(approved.workflowId);
      if (selectedWorkflow === approved.workflowId) {
        setSelectedWorkflow(null);
      }
      await loadWorkflows();
      return `Deleted workflow "${approved.workflowName}".`;
    }

    const createMatch = normalized.match(/^create workflow named (.+)$/i);
    if (createMatch) {
      const name = createMatch[1].trim();
      const createdId = await createWorkflow(name);
      setSelectedWorkflow(createdId);
      await loadWorkflows();
      return `Created workflow "${name}" and opened it in the builder.`;
    }

    if (!selectedWorkflow) {
      return "Select a workflow first, or use: create workflow named <name>.";
    }

    if (lower === "activate") {
      await toggleWorkflow(selectedWorkflow, true);
      await loadWorkflows();
      return `Activated ${selectedWorkflowName}.`;
    }
    if (lower === "deactivate") {
      setPendingApproval({
        action: "deactivate",
        workflowId: selectedWorkflow,
        workflowName: selectedWorkflowName,
      });
      return `Approve deactivation of "${selectedWorkflowName}"? Type confirm or cancel.`;
    }

    if (lower === "delete workflow") {
      setPendingApproval({
        action: "delete",
        workflowId: selectedWorkflow,
        workflowName: selectedWorkflowName,
      });
      return `Approve deletion of "${selectedWorkflowName}"? Type confirm or cancel.`;
    }

    const renameMatch = normalized.match(/^rename to (.+)$/i);
    if (renameMatch) {
      const nextName = renameMatch[1].trim();
      await updateWorkflow(selectedWorkflow, (workflow) => ({ ...workflow, name: nextName }));
      await loadWorkflows();
      return `Renamed workflow to "${nextName}".`;
    }

    const addTagMatch = normalized.match(/^add tag (.+)$/i);
    if (addTagMatch) {
      const tagName = addTagMatch[1].trim();
      await updateWorkflow(selectedWorkflow, (workflow) => {
        const existing = Array.isArray(workflow.tags) ? workflow.tags : [];
        const already = existing.some(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            "name" in (entry as Record<string, unknown>) &&
            String((entry as Record<string, unknown>).name).toLowerCase() === tagName.toLowerCase(),
        );
        return already ? workflow : { ...workflow, tags: [...existing, { name: tagName }] };
      });
      await loadWorkflows();
      return `Added tag "${tagName}" to ${selectedWorkflowName}.`;
    }

    return "Unknown command. Try: activate, deactivate, delete workflow, rename to <name>, add tag <tag>, create workflow named <name>, confirm, cancel.";
  };

  const submitChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput("");
    setChatBusy(true);
    setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);
    try {
      const result = await runChatCommand(text);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result,
        },
      ]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Command failed: ${String(err instanceof Error ? err.message : err)}`,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  const openBuilder = (workflowId?: string) => {
    setSelectedWorkflow(workflowId || null);
    setShowBuilder(true);
  };

  const getBuilderUrl = () => {
    const base = getN8nBaseUrl();
    if (selectedWorkflow) {
      return `${base}/workflow/${selectedWorkflow}`;
    }
    return `${base}/workflow/new`;
  };

  if (showBuilder) {
    return (
      <div className="h-full flex flex-col -m-6">
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowBuilder(false)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              {"<-"} Back to Workflows
            </button>
            <span className="text-gray-600">|</span>
            <span className="font-medium">
              {selectedWorkflow ? `Edit: ${selectedWorkflowName}` : "Create New Workflow"}
            </span>
          </div>
          <span className="text-sm text-gray-400">Embedded n8n editor</span>
        </div>

        <div className="flex-1 min-h-0 flex">
          <iframe
            src={getBuilderUrl()}
            className="flex-1 w-full bg-gray-900"
            title="OpenClaw Workflow Editor"
            allow="clipboard-read; clipboard-write"
          />

          <aside className="w-[360px] border-l border-gray-700 bg-gray-900/95 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-orange-400" />
              <h3 className="font-semibold">Flow Chat</h3>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`p-3 rounded-lg text-sm ${
                    message.role === "user"
                      ? "bg-orange-600/20 border border-orange-500/30 ml-4"
                      : "bg-gray-800 border border-gray-700 mr-4"
                  }`}
                >
                  <p className="text-xs text-gray-400 mb-1">
                    {message.role === "user" ? "You" : "Assistant"}
                  </p>
                  <p className="whitespace-pre-wrap">{message.text}</p>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-gray-700">
              <div className="flex items-center gap-2">
                <input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitChat();
                    }
                  }}
                  placeholder="Type command..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
                <button
                  onClick={() => void submitChat()}
                  disabled={chatBusy}
                  className="p-2 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-50"
                  title="Send"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-6 h-6 text-yellow-400" />
            Workflows
          </h1>
          <p className="text-gray-400 mt-1">Automate your work with n8n-powered workflows</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void loadWorkflows()}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => openBuilder()}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-orange-500 rounded-lg hover:from-orange-500 hover:to-orange-400 transition-all shadow-lg"
          >
            <Plus className="w-5 h-5" />
            New Workflow
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { title: "Basecamp Sync", desc: "Sync tasks and todos across projects", icon: "B" },
          { title: "Slack Alerts", desc: "Get notified on task updates", icon: "S" },
          { title: "Daily Report", desc: "Auto-generate daily status reports", icon: "R" },
        ].map((template) => (
          <button
            key={template.title}
            onClick={() => openBuilder()}
            className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl hover:border-orange-500/50 hover:bg-gray-800 transition-all text-left group"
          >
            <div className="text-xl mb-2 font-bold text-orange-400">{template.icon}</div>
            <h3 className="font-medium group-hover:text-orange-400 transition-colors">{template.title}</h3>
            <p className="text-sm text-gray-400 mt-1">{template.desc}</p>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold">Your Workflows</h2>
          <span className="text-sm text-gray-400">{workflows.length} workflows</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading workflows...
          </div>
        ) : workflows.length === 0 ? (
          <div className="p-8 text-center">
            <Zap className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 mb-4">No workflows yet</p>
            <button onClick={() => openBuilder()} className="text-orange-400 hover:text-orange-300">
              Create your first workflow {"->"}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className="px-4 py-3 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      workflow.active ? "bg-green-400" : "bg-gray-500"
                    }`}
                  />
                  <div>
                    <p className="font-medium">{workflow.name}</p>
                    <p className="text-sm text-gray-400">
                      {workflow.tags?.map((t) => t.name).join(", ") || "No tags"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    Updated {new Date(workflow.updatedAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        await toggleWorkflow(workflow.id, !workflow.active);
                        await loadWorkflows();
                      } catch (err) {
                        setError(String(err instanceof Error ? err.message : err));
                      }
                    }}
                    className={`p-1.5 rounded transition-colors ${
                      workflow.active
                        ? "text-green-400 hover:bg-green-900/30"
                        : "text-gray-500 hover:bg-gray-600"
                    }`}
                    title={workflow.active ? "Deactivate" : "Activate"}
                  >
                    {workflow.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => openBuilder(workflow.id)}
                    className="p-2 rounded hover:bg-gray-600 transition-colors"
                    title="Edit workflow"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 text-center">
        <span className="text-sm text-gray-500">
          Built-in automation engine powered by n8n
        </span>
      </div>
    </div>
  );
}
