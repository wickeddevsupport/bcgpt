import fs from "node:fs/promises";
import path from "node:path";
import { listKeys, type AIProvider } from "./byok-store.js";
import { loadEffectiveWorkspaceConfig, readWorkspaceConfig } from "./workspace-config.js";
import { readWorkspaceConnectors, type WorkspaceConnectors } from "./workspace-connectors.js";
import { CONFIG_DIR, ensureDir } from "../utils.js";

type JsonObject = Record<string, unknown>;

export type WorkspaceAiCredential = {
  id: string;
  name: string;
  type: string;
};

type BcgptWorkspaceData = {
  accounts?: Array<{ id: string; name: string; product?: string }>;
  projects?: Array<{ id: string; name: string; accountId: string }>;
  error?: string;
};

type WorkspaceAiContextInput = {
  workspaceId: string;
  generatedAt: string;
  workspaceConfig: JsonObject;
  effectiveConfig: JsonObject;
  connectors: WorkspaceConnectors | null;
  byokKeys: Array<{
    provider: AIProvider;
    label: string;
    defaultModel?: string;
    validated?: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  credentials: WorkspaceAiCredential[];
  bcgptData?: BcgptWorkspaceData | null;
};

export type RefreshWorkspaceAiContextOptions = {
  credentials?: WorkspaceAiCredential[];
  includeLiveCredentials?: boolean;
};

const WORKSPACE_AI_CONTEXT_FILENAME = "AI_CONTEXT.md";
const DEFAULT_PROMPT_CONTEXT_MAX_CHARS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getPath(source: unknown, pathParts: string[]): unknown {
  let current: unknown = source;
  for (const part of pathParts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasConfiguredLeaf(value: unknown, depth = 0): boolean {
  if (depth > 6) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasConfiguredLeaf(entry, depth + 1));
  }
  if (isRecord(value)) {
    return Object.values(value).some((entry) => hasConfiguredLeaf(entry, depth + 1));
  }
  return false;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function normalizeModelRef(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const slashIndex = raw.indexOf("/");
  if (slashIndex <= 0 || slashIndex === raw.length - 1) {
    return null;
  }
  const provider = raw.slice(0, slashIndex).trim().toLowerCase();
  const modelId = raw.slice(slashIndex + 1).trim().replace(/^\/+/, "");
  if (!provider || !modelId) {
    return null;
  }
  return `${provider}/${modelId}`;
}

function collectProviderKeysWithApiKey(effectiveConfig: JsonObject): string[] {
  const providers = getPath(effectiveConfig, ["models", "providers"]);
  if (!isRecord(providers)) {
    return [];
  }
  const out: string[] = [];
  for (const [providerKey, entry] of Object.entries(providers)) {
    if (!isRecord(entry)) {
      continue;
    }
    const apiKey = asNonEmptyString(entry.apiKey);
    if (apiKey) {
      out.push(providerKey.trim().toLowerCase());
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function collectAllowedModelRefs(effectiveConfig: JsonObject): string[] {
  const out = new Set<string>();
  const addRef = (value: unknown) => {
    const ref = normalizeModelRef(value);
    if (ref) {
      out.add(ref);
    }
  };

  addRef(getPath(effectiveConfig, ["agents", "defaults", "model", "primary"]));

  const fallbacks = getPath(effectiveConfig, ["agents", "defaults", "model", "fallbacks"]);
  if (Array.isArray(fallbacks)) {
    for (const entry of fallbacks) {
      addRef(entry);
    }
  }

  const models = getPath(effectiveConfig, ["agents", "defaults", "models"]);
  if (isRecord(models)) {
    for (const key of Object.keys(models)) {
      addRef(key);
    }
  }

  const agents = getPath(effectiveConfig, ["agents", "list"]);
  if (Array.isArray(agents)) {
    for (const entry of agents) {
      if (!isRecord(entry)) {
        continue;
      }
      const model = entry.model;
      if (typeof model === "string") {
        addRef(model);
      } else if (isRecord(model)) {
        addRef(model.primary);
        if (Array.isArray(model.fallbacks)) {
          for (const fallback of model.fallbacks) {
            addRef(fallback);
          }
        }
      }
    }
  }

  return [...out].sort((a, b) => a.localeCompare(b));
}

type AgentSummary = {
  id: string;
  name: string;
  modelRef: string | null;
  workspace: string | null;
  workspaceScoped: boolean;
  isDefault: boolean;
};

function resolveAgentModelRef(entry: Record<string, unknown>): string | null {
  const model = entry.model;
  if (typeof model === "string") {
    return normalizeModelRef(model);
  }
  if (isRecord(model)) {
    return normalizeModelRef(model.primary);
  }
  return null;
}

function resolveAgentName(entry: Record<string, unknown>, fallbackId: string): string {
  const name = asNonEmptyString(entry.name);
  if (name) {
    return name;
  }
  const identity = isRecord(entry.identity) ? entry.identity : null;
  const identityName = identity ? asNonEmptyString(identity.name) : null;
  if (identityName) {
    return identityName;
  }
  return fallbackId;
}

function collectAgentSummaries(effectiveConfig: JsonObject, workspaceId: string): AgentSummary[] {
  const list = getPath(effectiveConfig, ["agents", "list"]);
  if (!Array.isArray(list)) {
    return [];
  }

  const workspaceAgents: AgentSummary[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = asNonEmptyString(entry.id);
    if (!id) {
      continue;
    }
    const entryWorkspace = asNonEmptyString(entry.workspaceId);
    if (entryWorkspace && entryWorkspace !== workspaceId) {
      continue;
    }
    workspaceAgents.push({
      id,
      name: resolveAgentName(entry, id),
      modelRef: resolveAgentModelRef(entry),
      workspace: asNonEmptyString(entry.workspace),
      workspaceScoped: Boolean(entryWorkspace),
      isDefault: entry.default === true,
    });
  }

  if (!workspaceAgents.length) {
    return [];
  }

  if (!workspaceAgents.some((entry) => entry.isDefault)) {
    workspaceAgents[0]!.isDefault = true;
  }
  return workspaceAgents;
}

function describeConnectorSection(connectors: WorkspaceConnectors | null): string {
  const raw = isRecord(connectors) ? connectors : {};

  const ops = isRecord(raw.ops) ? raw.ops : {};
  const opsUrl = asNonEmptyString(ops.url);
  const opsApiKeySet = Boolean(asNonEmptyString(ops.apiKey));
  const opsProjectId = asNonEmptyString(ops.projectId);
  const opsUser = isRecord(ops.user) ? ops.user : {};
  const opsUserEmail = asNonEmptyString(opsUser.email);
  const opsUserPasswordSet = Boolean(asNonEmptyString(opsUser.password));

  const bcgpt = isRecord(raw.bcgpt) ? raw.bcgpt : {};
  const bcgptUrl = asNonEmptyString(bcgpt.url);
  const bcgptApiKeySet = Boolean(asNonEmptyString(bcgpt.apiKey));
  const figma = isRecord(raw.figma) ? raw.figma : {};
  const figmaUrl = asNonEmptyString(figma.url);
  const figmaIdentity = isRecord(figma.identity) ? figma.identity : {};
  const figmaAuth = isRecord(figma.auth) ? figma.auth : {};
  const figmaConnected = figmaIdentity.connected === true;
  const figmaHandle = asNonEmptyString(figmaIdentity.handle);
  const figmaEmail = asNonEmptyString(figmaIdentity.email);
  const figmaActiveConnectionName = asNonEmptyString(figmaIdentity.activeConnectionName);
  const figmaActiveConnectionId = asNonEmptyString(figmaIdentity.activeConnectionId);
  const figmaActiveTeamId = asNonEmptyString(figmaIdentity.activeTeamId);
  const figmaSelectedFileUrl = asNonEmptyString(figmaIdentity.selectedFileUrl);
  const figmaSelectedFileId = asNonEmptyString(figmaIdentity.selectedFileId);
  const figmaSelectedFileName = asNonEmptyString(figmaIdentity.selectedFileName);
  const figmaPatTokenSynced = Boolean(asNonEmptyString(figmaAuth.personalAccessToken));
  const figmaPatPresent =
    figmaAuth.hasPersonalAccessToken === true || figmaIdentity.hasPersonalAccessToken === true;
  const figmaPatBridgeStatus = figmaPatTokenSynced
    ? "raw token synced into PMOS"
    : figmaPatPresent
      ? "validated in FM, but raw token not passed into PMOS"
      : "not available";
  const figmaMcpServerUrl = asNonEmptyString(figmaAuth.mcpServerUrl);
  const fmMcpReady = Boolean(asNonEmptyString(figmaAuth.fmMcpUrl) && asNonEmptyString(figmaAuth.fmMcpApiToken));
  const figmaSelectedFileSummary =
    figmaSelectedFileName && figmaSelectedFileUrl
      ? `${figmaSelectedFileName} (${figmaSelectedFileUrl})`
      : figmaSelectedFileName ?? figmaSelectedFileUrl;
  // Shared key: global BCGPT_API_KEY env var available (server-wide connection)
  const bcgptSharedKeyAvailable = !bcgptApiKeySet && Boolean(process.env.BCGPT_API_KEY?.trim());

  const extraConnectorKeys = Object.keys(raw)
    .filter((key) => key !== "ops" && key !== "bcgpt" && key !== "figma" && key !== "activepieces")
    .sort((a, b) => a.localeCompare(b));

  const extraLines = extraConnectorKeys.map((key) => {
    const entry = raw[key];
    return `- ${key}: configured=${yesNo(hasConfiguredLeaf(entry))}`;
  });

  return [
    "## Connector Status",
    `- ops configured: ${yesNo(Boolean(opsUrl || opsApiKeySet || opsProjectId || opsUserEmail || opsUserPasswordSet))}`,
    `- ops url: ${opsUrl ?? "(not set)"}`,
    `- ops apiKey present: ${yesNo(opsApiKeySet)}`,
    `- ops projectId: ${opsProjectId ?? "(not set)"}`,
    `- ops user email: ${opsUserEmail ?? "(not set)"}`,
    `- ops user password present: ${yesNo(opsUserPasswordSet)}`,
    `- basecamp connector configured: ${yesNo(Boolean(bcgptUrl || bcgptApiKeySet || bcgptSharedKeyAvailable))}`,
    `- basecamp url: ${bcgptUrl ?? process.env.BCGPT_URL?.trim() ?? "https://bcgpt.wickedlab.io"}`,
    `- basecamp apiKey present: ${bcgptApiKeySet ? "yes" : bcgptSharedKeyAvailable ? "yes (shared server key)" : "no"}`,
    `- figma connector configured: ${yesNo(Boolean(figmaUrl || figmaConnected || figmaHandle || figmaEmail))}`,
    `- figma url: ${figmaUrl ?? "https://fm.wickedlab.io"}`,
    `- figma connected user: ${figmaHandle ?? figmaEmail ?? "(not synced)"}`,
    `- figma active connection: ${figmaActiveConnectionName ?? "(not synced)"}`,
    `- figma active connection id: ${figmaActiveConnectionId ?? "(not synced)"}`,
    `- figma active team id: ${figmaActiveTeamId ?? "(not synced)"}`,
    `- figma selected file: ${figmaSelectedFileSummary ?? "(not synced)"}`,
    `- figma selected file id: ${figmaSelectedFileId ?? "(not synced)"}`,
    `- figma selected file url: ${figmaSelectedFileUrl ?? "(not synced)"}`,
    `- figma personal access token present: ${yesNo(figmaPatPresent)}`,
    `- figma PAT handoff to PMOS: ${figmaPatBridgeStatus}`,
    `- figma MCP server URL: ${figmaMcpServerUrl ?? "https://mcp.figma.com/mcp"}`,
    `- figma panel sync bridge ready: ${yesNo(fmMcpReady)}`,
    ...(figmaConnected
      ? [
          "",
          "### Figma AI Capabilities",
          "- Use `figma_get_context` first to confirm the active file, connection, and team when workspace-selected context matters.",
          "- If the user pastes a Figma file URL, anchor to that exact file, do not fall back to the selected panel file, and prefer live MCP discovery first: call `figma_mcp_list_tools`, then `figma_mcp_call` with the exact capability needed for comments, annotations, screenshots, structure, variables, or node context.",
          "- Workspace chat exposes only official Figma MCP plus PAT-backed fallback. The embedded Figma panel is for syncing selected-file context and PAT handoff, not a separate AI tool system.",
          "- Use `figma_mcp_*` only for official Figma document/design operations: `get_design_context`, `get_metadata`, `get_screenshot`, `get_variable_defs`, comments, annotations, components, styles, variables, auto-layout, node inspection, and deeper file understanding.",
          "- True Figma annotations come from the PMOS Figma plugin bridge, not the comments API. If `get_annotations` says a plugin bridge sync is required, do not silently substitute file comments.",
          "- If the task is comments, annotations, review feedback, pinned notes, or exact node/file context, do not default to `figma_pat_audit_file`; discover and use the relevant MCP capability first.",
          "- If official Figma MCP returns auth required, 405, or unavailable, then use `figma_pat_audit_file` to run a PAT-backed REST audit on the target file as fallback.",
          "- Do not use `web_fetch` for private Figma API calls in workspace chat; it cannot send the workspace PAT. Use `figma_mcp_list_tools`, `figma_mcp_call`, and `figma_pat_audit_file` instead.",
          "  If FM reports a PAT but PMOS does not have the raw token yet, explain that the PAT exists upstream but is not being passed through connector sync.",
          "  If MCP auth or a Figma Personal Access Token is truly missing, tell the user to complete Figma auth in the Figma panel/Integrations before retrying.",
          "- Use `web_search` for Figma design-system best practices, component naming conventions, or token standards.",
          "- DO NOT suggest Chrome extensions, browser extensions, or manual copy-paste of Figma data.",
          "- DO NOT ask the user to 'attach a Figma tab' — this platform has a built-in Figma panel for sync and context.",
          "- For design audits: analyze structure, naming consistency, spacing systems, color tokens, typography.",
          "- For component audits: check auto-layout usage, detached instances, missing local styles.",
          ...(fmMcpReady
            ? ["- The panel sync bridge is ready. When the user opens a file in the Figma panel and clicks 'Sync Now', the selected file context updates here."]
            : ["- The panel sync bridge is not ready yet. Ask the user to open the Figma panel and click 'Sync Context' or 'Sync Now' to refresh selected-file context."]),
        ]
      : []),
    extraLines.length > 0 ? "### Additional connectors" : "",
    ...extraLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function describeBcgptSection(input: {
  connectors: WorkspaceConnectors | null;
  bcgptData: BcgptWorkspaceData | null;
}): string {
  const raw = isRecord(input.connectors) ? input.connectors : {};
  const bcgpt = isRecord(raw.bcgpt) ? raw.bcgpt : {};
  const bcgptUrl = asNonEmptyString(bcgpt.url);
  const bcgptApiKey = asNonEmptyString(bcgpt.apiKey);

  // A connection exists if either the workspace or global key is available,
  // OR if bcgptData was successfully fetched (meaning the global key worked).
  const hasConnection = Boolean(bcgptApiKey) || Boolean(input.bcgptData);
  if (!hasConnection) {
    return [
      "## Basecamp Integration (bcgpt MCP Server)",
      "- status: NOT CONFIGURED — no Basecamp API key set for this workspace",
      "- To connect: go to Integrations → Basecamp → enter your bcgpt API key",
    ].join("\n");
  }

  const serverUrl = bcgptUrl ?? "https://bcgpt.wickedlab.io";
  const isSharedConnection = !bcgptApiKey && hasConnection;

  const lines: string[] = [
    "## Basecamp Integration (bcgpt MCP Server)",
    isSharedConnection
      ? `- status: CONNECTED (shared) — using server-wide Basecamp connection`
      : `- status: CONNECTED — Basecamp API key is set for this workspace`,
    `- server: ${serverUrl}`,
    "- protocol: MCP (Model Context Protocol) — Basecamp tools available",
    "",
    "### Available Basecamp Tool Categories",
    "- **Projects**: list_projects, get_project, search_projects",
    "- **Todos**: get_todoset, list_todolists, get_todolist, list_todos, create_todo, update_todo, complete_todo, get_todo",
    "- **Messages**: get_message_board, list_messages, create_message, get_message, update_message",
    "- **Documents**: get_vault, list_documents, create_document, get_document, update_document",
    "- **Card Tables (Kanban)**: list_card_tables, get_card_table, list_card_table_columns, create_card, update_card, move_card",
    "- **Schedules**: get_schedule, list_schedule_entries, create_schedule_entry, get_schedule_entry",
    "- **Campfire (Chat)**: get_campfire, list_campfire_lines, create_campfire_line",
    "- **People**: list_people, get_person, search_people",
    "- **Reports**: list_recordings, get_recording, report_todos_assigned",
    "- **Webhooks**: list_webhooks, create_webhook, destroy_webhook",
    "- **Raw API**: basecamp_raw — make any GET request to the Basecamp API",
  ];

  // Include live Basecamp account/project data if available
  const data = input.bcgptData;
  if (data) {
    if (data.accounts && data.accounts.length > 0) {
      lines.push("");
      lines.push("### Connected Basecamp Accounts");
      for (const acct of data.accounts.slice(0, 5)) {
        lines.push(`- ${acct.name} (id: ${acct.id}, type: ${acct.product ?? "basecamp"})`);
      }
    }
    if (data.projects && data.projects.length > 0) {
      lines.push("");
      lines.push("### Recent Projects (most recently active first)");
      for (const proj of data.projects.slice(0, 10)) {
        lines.push(`- ${proj.name} (id: ${proj.id}, account: ${proj.accountId})`);
      }
    }
    if (data.error) {
      lines.push("");
      lines.push(`- Note: live data partially unavailable — ${data.error}`);
    }
  } else {
    lines.push("");
    lines.push("- Live project data: not yet loaded (will populate on next context refresh)");
  }

  lines.push("");
  lines.push("### Basecamp Entry Points");
  lines.push("- **Use `bcgpt_list_projects` for exact project lists or project picking** before deeper follow-up questions.");
  lines.push("- **Use `bcgpt_mcp_call` for deterministic named MCP tools** such as todo lists, project todos, messages, people, schedules, card tables, and documents.");
  lines.push("- **Use `bcgpt_list_tools` when the right named MCP tool is unclear** and you need to inspect the live tool catalog first.");
  lines.push("- **Use `bcgpt_smart_action` for scoped Basecamp analysis** — summaries, audits, fuzzy searches, pasted Basecamp URLs, and broader follow-up questions when the exact tool is not obvious.");
  lines.push("- If the user pastes a Basecamp URL, pass the exact URL through `bcgpt_smart_action.query` and inspect that linked resource instead of ignoring the URL.");
  lines.push("- Good direct-tool examples:");
  lines.push('  - "show my todo lists in Project X" -> `bcgpt_mcp_call` with `list_todolists`');
  lines.push('  - "how many open todos are in Project X?" -> `bcgpt_mcp_call` with `list_todos_for_project`');
  lines.push('  - "show the schedule for Project X" -> `bcgpt_mcp_call` with `list_schedule_entries`');
  lines.push('  - "who is on this project?" -> `bcgpt_mcp_call` with `list_people`');
  lines.push("- Use create-specific tools for mutations like todos, messages, campfire lines, and cards.");
  lines.push("");
  lines.push("### How to Use Basecamp Tools");
  lines.push(`- These tools are available through the bcgpt MCP server at ${serverUrl}`);
  lines.push("- When the user asks about Basecamp (projects, todos, messages, etc.), use the exact tool that matches the request when possible.");
  lines.push("- Always use tool results as the authoritative source — do not guess Basecamp data");
  lines.push("- If asked 'what projects do I have', call `bcgpt_list_projects` first, then summarize the list.");
  lines.push("- If asked for exact todo lists, project todos, people, messages, schedules, or card tables, prefer `bcgpt_mcp_call` over `bcgpt_smart_action`.");
  lines.push("- Do not call Basecamp tools for greetings, fresh-session acknowledgements, or other non-Basecamp chatter.");
  lines.push("- The API key is already configured — you do NOT need to ask the user for credentials");

  return lines.join("\n");
}

function describeModelSection(input: {
  effectiveConfig: JsonObject;
  byokKeys: WorkspaceAiContextInput["byokKeys"];
}): string {
  const primary = normalizeModelRef(
    getPath(input.effectiveConfig, ["agents", "defaults", "model", "primary"]),
  );

  const fallbackRefsRaw = getPath(input.effectiveConfig, ["agents", "defaults", "model", "fallbacks"]);
  const fallbackRefs = Array.isArray(fallbackRefsRaw)
    ? fallbackRefsRaw
        .map((entry) => normalizeModelRef(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];

  const allowedRefs = collectAllowedModelRefs(input.effectiveConfig);
  const providersWithConfigKey = collectProviderKeysWithApiKey(input.effectiveConfig);
  const byokProviders = input.byokKeys
    .map((entry) => entry.provider)
    .sort((a, b) => a.localeCompare(b));

  return [
    "## Model Configuration",
    `- primary model: ${primary ?? "(not set)"}`,
    `- fallback models: ${fallbackRefs.length ? fallbackRefs.join(", ") : "(none)"}`,
    `- allowed/saved model refs: ${allowedRefs.length ? allowedRefs.join(", ") : "(none)"}`,
    `- providers with apiKey in effective config: ${providersWithConfigKey.length ? providersWithConfigKey.join(", ") : "(none)"}`,
    `- providers with BYOK key in workspace: ${byokProviders.length ? byokProviders.join(", ") : "(none)"}`,
  ].join("\n");
}

function describeByokSection(keys: WorkspaceAiContextInput["byokKeys"]): string {
  if (!keys.length) {
    return ["## BYOK Keys", "- none"].join("\n");
  }
  const lines = keys
    .slice()
    .sort((a, b) => a.provider.localeCompare(b.provider))
    .map((entry) => {
      const defaultModel = entry.defaultModel?.trim() ? entry.defaultModel.trim() : "(none)";
      return `- ${entry.provider}: validated=${yesNo(entry.validated === true)}, defaultModel=${defaultModel}, label=${entry.label}`;
    });
  return ["## BYOK Keys", ...lines].join("\n");
}

function describeAgentSection(input: {
  effectiveConfig: JsonObject;
  workspaceId: string;
}): string {
  const agents = collectAgentSummaries(input.effectiveConfig, input.workspaceId);
  if (!agents.length) {
    return ["## Agent Assignments", "- no workspace agents configured"].join("\n");
  }

  const lines = agents.map((agent) => {
    const workspaceDisplay = agent.workspace ?? "(default workspace)";
    return `- ${agent.id} (${agent.name}): model=${agent.modelRef ?? "(inherits default)"}, workspace=${workspaceDisplay}, workspaceScoped=${yesNo(agent.workspaceScoped)}, default=${yesNo(agent.isDefault)}`;
  });
  return ["## Agent Assignments", ...lines].join("\n");
}

function describeCredentialSection(credentials: WorkspaceAiCredential[]): string {
  if (!credentials.length) {
    return ["## Connected Apps", "- no connected apps discovered for this workspace"].join("\n");
  }

  const sorted = credentials
    .slice()
    .sort((a, b) => `${a.type}/${a.name}`.localeCompare(`${b.type}/${b.name}`));
  const top = sorted.slice(0, 40);
  const lines = top.map((cred) => `- ${cred.name} (type=${cred.type}, id=${cred.id})`);
  if (sorted.length > top.length) {
    lines.push(`- ... plus ${sorted.length - top.length} more`);
  }
  lines.push("- Treat this list as the current workspace app inventory.");
  lines.push("- Do not ask the user to reconnect an app already listed here unless a live action explicitly fails.");
  return ["## Connected Apps", ...lines].join("\n");
}

function describeWorkspaceConfigSection(input: {
  workspaceConfig: JsonObject;
  effectiveConfig: JsonObject;
}): string {
  const workspaceTopLevelKeys = Object.keys(input.workspaceConfig).sort((a, b) => a.localeCompare(b));
  const effectiveTopLevelKeys = Object.keys(input.effectiveConfig).sort((a, b) => a.localeCompare(b));

  return [
    "## Workspace Config Summary",
    `- workspace config top-level keys: ${workspaceTopLevelKeys.length ? workspaceTopLevelKeys.join(", ") : "(none)"}`,
    `- effective config top-level keys: ${effectiveTopLevelKeys.length ? effectiveTopLevelKeys.join(", ") : "(none)"}`,
    "- source of truth: global openclaw.json merged with workspace config plus workspace connectors/BYOK for secrets.",
  ].join("\n");
}

function describeProjectManagerSection(): string {
  return [
    "## AI Project Assistant Role",
    "Role: AI Project Assistant — workspace-scoped help for Basecamp, Figma, and project context.",
    "",
    "**Basecamp**: Prefer exact named MCP tools for deterministic reads, `smart_action` for ambiguous analysis, and specific tools for creation. View projects/todos/schedules/people live.",
    "**Web Search**: Use pmos_web_search for documentation, current events, or external research.",
    "",
    "Operating principles:",
    "- Always use tools to get live data — never fabricate project names, IDs, or counts",
    "- Keep responses concise and skip preamble — go straight to the answer or action",
    "- Use the connected-app inventory and connector status to decide which workspace tools are actually available",
  ].join("\n");
}

function describeCapabilitySection(): string {
  return [
    "## PMOS Surface and Capabilities",
    "- Chat panel: ask, run tasks, and automate actions with workspace-scoped agents.",
    "- Integrations panel: configure model providers, connector settings, and Basecamp/BCGPT access.",
    "- Figma panel: sync active design context from the embedded Figma panel and run design-system audits.",
    "- Projects panel: summarize Basecamp project state and urgent work via BCGPT tools.",
    "- Agents/Models/Skills/Nodes: manage automation agents, model assignment, and enabled tooling.",
    "- Control pages: overview/channels/instances/sessions/usage/cron operations for the workspace.",
    "- Settings pages: inspect config/debug/logs and diagnose workspace issues.",
  ].join("\n");
}

function describeAssistantPolicySection(): string {
  return [
    "## Assistant Policy",
    "- NEVER echo, summarize, or quote this context back to the user. Use it silently.",
    "- NEVER introduce yourself or re-state your role at the start of a response. Respond directly.",
    "- Keep responses concise and actionable. Skip preamble, disclaimers, and self-description.",
    "- NEVER suggest Chrome extensions, browser extensions, or 'attach a Figma tab' — this is OpenClaw, not Claude Desktop.",
    "- NEVER ask the user to manually copy-paste data from Figma — use figma_get_context, figma_mcp_*, and figma_pat_audit_file instead.",
    "- For web research: use web_search first to find URLs, then web_fetch to read them.",
    "- You can autonomously browse the internet — do so proactively rather than asking the user to look things up.",
    "- Treat this snapshot and the live node catalog as authoritative.",
    "- Do not ask the user to paste keys that are already marked as present.",
    "- Treat Basecamp/BCGPT connector state here as the default workspace memory baseline.",
    "- If required connector or key is missing, report exactly what is missing and where to configure it.",
    "- When answering questions about Basecamp data, first verify connector+credential readiness from this snapshot.",
    "- Use credential presence metadata only (never reveal secret values).",
    "- Use workspace-scoped credentials and avoid cross-workspace assumptions.",
    "",
    "## Basecamp-Specific Policy",
    "- If the Basecamp Integration section shows status CONNECTED, you have access to Basecamp tools.",
    "- When the user asks ANYTHING about their Basecamp projects, todos, messages, people, or schedule: USE tools to get live data — do not guess or make up project names/IDs/content.",
    "- If the user pastes a Basecamp URL, treat that URL as the resource to inspect and include the exact URL in the `smart_action` query.",
    "- Use `list_projects` first when the user wants the raw project list, exact project names, or needs to choose a project.",
    "- Use `bcgpt_mcp_call` for exact named tools like `list_todolists`, `list_todos_for_project`, `list_messages`, `list_people`, `list_schedule_entries`, and `list_card_tables`.",
    "- Use `bcgpt_list_tools` once when the right named tool is unclear, then switch to `bcgpt_mcp_call`.",
    "- Use `smart_action` with a natural language query for Basecamp summaries, searches, project audits, pasted Basecamp URLs, and follow-up questions where the exact tool is not obvious.",
    "  - 'what projects do I have?' → list_projects()",
    "  - 'show me todo lists for Project X' → bcgpt_mcp_call({ tool: 'list_todolists', arguments: { project: 'Project X' } })",
    "  - 'show me my todos' → bcgpt_mcp_call({ tool: 'list_assigned_to_me' })",
    "  - 'summarize project X' → smart_action({ query: 'summarize project X', project: 'X' })",
    "  - 'show the schedule' → bcgpt_mcp_call({ tool: 'list_schedule_entries', arguments: { project: 'X' } })",
    "  - 'what's in campfire?' → smart_action({ query: 'show campfire', project: 'X' })",
    "- For CREATE operations, use specific tools: create_todo, create_message, create_campfire_line.",
    "- You are the user's Basecamp assistant: you know their workspace and can act on their behalf when asked.",
    "- Never reveal the raw API key value. Reference the bcgpt server URL when explaining connectivity.",
    "- Never call Basecamp tools for greetings or startup-only responses.",
    "- If a Basecamp operation fails, report the error clearly and suggest checking the Basecamp connector configuration.",
  ].join("\n");
}

/**
 * Try to fetch live Basecamp account + project data from the bcgpt MCP server.
 * Best-effort — returns null on any error so callers always get a context even if bcgpt is down.
 */
async function fetchBcgptWorkspaceData(
  bcgptUrl: string,
  apiKey: string,
): Promise<BcgptWorkspaceData | null> {
  try {
    // Use the bcgpt REST endpoint to get accounts and projects.
    // Calls /api/basecamp/accounts which returns the user's Basecamp accounts.
    const base = bcgptUrl.replace(/\/+$/, "");

    // Fetch accounts
    const accountsRes = await fetch(`${base}/api/basecamp/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
    });

    if (!accountsRes.ok) {
      return { error: `accounts endpoint returned ${accountsRes.status}` };
    }

    const accountsJson = (await accountsRes.json()) as unknown;
    const rawAccounts = Array.isArray(accountsJson)
      ? accountsJson
      : Array.isArray((accountsJson as { accounts?: unknown[] }).accounts)
        ? (accountsJson as { accounts: unknown[] }).accounts
        : [];

    const accounts: BcgptWorkspaceData["accounts"] = rawAccounts
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === "object"))
      .map((a) => ({
        id: String(a.id ?? ""),
        name: String(a.name ?? ""),
        product: typeof a.product === "string" ? a.product : undefined,
      }))
      .filter((a) => a.id && a.name);

    // Fetch projects from first account
    let projects: BcgptWorkspaceData["projects"] = [];
    if (accounts.length > 0) {
      try {
        const projRes = await fetch(`${base}/api/basecamp/projects`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(6000),
        });
        if (projRes.ok) {
          const projJson = (await projRes.json()) as unknown;
          const rawProjects = Array.isArray(projJson)
            ? projJson
            : Array.isArray((projJson as { projects?: unknown[] }).projects)
              ? (projJson as { projects: unknown[] }).projects
              : [];
          projects = rawProjects
            .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"))
            .map((p) => ({
              id: String(p.id ?? ""),
              name: String(p.name ?? ""),
              accountId: String(p.account_id ?? p.accountId ?? accounts[0]?.id ?? ""),
            }))
            .filter((p) => p.id && p.name);
        }
      } catch {
        // projects fetch failed, still return accounts
      }
    }

    return { accounts, projects };
  } catch {
    return null;
  }
}

export function buildWorkspaceAiContextMarkdown(input: WorkspaceAiContextInput): string {
  return [
    "# PMOS Workspace AI Context",
    `Generated at: ${input.generatedAt}`,
    `Workspace ID: ${input.workspaceId}`,
    "",
    describeWorkspaceConfigSection({
      workspaceConfig: input.workspaceConfig,
      effectiveConfig: input.effectiveConfig,
    }),
    "",
    describeConnectorSection(input.connectors),
    "",
    describeBcgptSection({
      connectors: input.connectors,
      bcgptData: input.bcgptData ?? null,
    }),
    "",
    describeModelSection({
      effectiveConfig: input.effectiveConfig,
      byokKeys: input.byokKeys,
    }),
    "",
    describeByokSection(input.byokKeys),
    "",
    describeAgentSection({
      effectiveConfig: input.effectiveConfig,
      workspaceId: input.workspaceId,
    }),
    "",
    describeCredentialSection(input.credentials),
    "",
    describeProjectManagerSection(),
    "",
    describeCapabilitySection(),
    "",
    describeAssistantPolicySection(),
  ].join("\n");
}

export function workspaceAiContextPath(workspaceId: string): string {
  const safe = String(workspaceId).trim() || "default";
  return path.join(CONFIG_DIR, "workspaces", safe, WORKSPACE_AI_CONTEXT_FILENAME);
}

export async function readWorkspaceAiContext(workspaceId: string): Promise<string | null> {
  const p = workspaceAiContextPath(workspaceId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export async function refreshWorkspaceAiContext(
  workspaceId: string,
  opts: RefreshWorkspaceAiContextOptions = {},
): Promise<{ workspaceId: string; path: string; markdown: string; generatedAt: string }> {
  const wsId = String(workspaceId).trim() || "default";
  const [workspaceConfigRaw, effectiveConfigRaw, connectors, byokKeys] = await Promise.all([
    readWorkspaceConfig(wsId),
    loadEffectiveWorkspaceConfig(wsId),
    readWorkspaceConnectors(wsId),
    listKeys(wsId),
  ]);

  let credentials = Array.isArray(opts.credentials) ? opts.credentials : [];
  if (credentials.length === 0 && opts.includeLiveCredentials) {
    try {
      const { fetchWorkspaceCredentials } = await import("./credential-sync.js");
      credentials = await fetchWorkspaceCredentials(wsId);
    } catch {
      credentials = [];
    }
  }

  // Best-effort: fetch live Basecamp account/project data from the bcgpt connector.
  // Falls back to the global BCGPT_API_KEY env var so workspace users on a shared
  // bcgpt setup see live project data even without a workspace-scoped key.
  let bcgptData: BcgptWorkspaceData | null = null;
  if (opts.includeLiveCredentials) {
    const bcgptConnector = isRecord(connectors?.bcgpt) ? connectors.bcgpt : null;
    const workspaceBcgptApiKey = asNonEmptyString(bcgptConnector?.apiKey as unknown);
    const workspaceBcgptUrl = asNonEmptyString(bcgptConnector?.url as unknown);
    // Resolve effective key/URL: workspace-scoped first, then global shared fallback
    const effectiveBcgptApiKey = workspaceBcgptApiKey ?? (process.env.BCGPT_API_KEY?.trim() || null);
    const effectiveBcgptUrl = workspaceBcgptUrl ?? (process.env.BCGPT_URL?.trim() || null) ?? "https://bcgpt.wickedlab.io";
    if (effectiveBcgptApiKey) {
      bcgptData = await fetchBcgptWorkspaceData(effectiveBcgptUrl, effectiveBcgptApiKey).catch(() => null);
    }
  }

  const workspaceConfig = isRecord(workspaceConfigRaw) ? workspaceConfigRaw : {};
  const effectiveConfig = isRecord(effectiveConfigRaw) ? effectiveConfigRaw : {};
  const generatedAt = new Date().toISOString();
  const markdown = buildWorkspaceAiContextMarkdown({
    workspaceId: wsId,
    generatedAt,
    workspaceConfig,
    effectiveConfig,
    connectors,
    byokKeys,
    credentials,
    bcgptData,
  });

  const p = workspaceAiContextPath(wsId);
  await ensureDir(path.dirname(p));
  const raw = markdown.trimEnd().concat("\n");
  await fs.writeFile(p, raw, "utf-8");

  return {
    workspaceId: wsId,
    path: p,
    markdown,
    generatedAt,
  };
}

export async function getWorkspaceAiContextForPrompt(
  workspaceId: string,
  opts: RefreshWorkspaceAiContextOptions & {
    ensureFresh?: boolean;
    maxChars?: number;
  } = {},
): Promise<string> {
  const wsId = String(workspaceId).trim() || "default";
  let markdown = "";

  if (opts.ensureFresh) {
    try {
      const refreshed = await refreshWorkspaceAiContext(wsId, {
        credentials: opts.credentials,
        includeLiveCredentials: opts.includeLiveCredentials,
      });
      markdown = refreshed.markdown;
    } catch {
      markdown = "";
    }
  }

  if (!markdown) {
    markdown = (await readWorkspaceAiContext(wsId)) ?? "";
  }
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }

  const maxChars = Number.isFinite(opts.maxChars)
    ? Math.max(500, Math.floor(opts.maxChars as number))
    : DEFAULT_PROMPT_CONTEXT_MAX_CHARS;
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars).trimEnd()}\n\n[workspace ai context truncated]`;
}
