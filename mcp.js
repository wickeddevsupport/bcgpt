// mcp.js
import crypto from "crypto";
import { basecampFetch, basecampFetchAll } from "./basecamp.js";
import { resolveByName, resolveBestEffort } from "./resolvers.js";

// ---------- JSON-RPC helpers ----------
function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function fail(id, error) { return { jsonrpc: "2.0", id, error }; }

// ---------- Tool schema helpers ----------
function tool(name, description, inputSchema) { return { name, description, inputSchema }; }
function noProps() { return { type: "object", properties: {
      confirm_debug: { type: "boolean", const: true },}, additionalProperties: false }; }

// ---------- Tiny in-memory cache ----------
const CACHE = new Map(); // key -> { ts, value }
const CACHE_TTL_MS = 60 * 1000;

function cacheGet(key) {
  const v = CACHE.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return v.value;
}
function cacheSet(key, value) {
  CACHE.set(key, { ts: Date.now(), value });
  return value;
}

// ---------- Concurrency limiter ----------
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- Date helpers ----------
function isoDate(d) {
  if (!d) return null;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = new Date(s);
  if (!Number.isNaN(t.getTime())) return t.toISOString().slice(0, 10);
  return null;
}

function todoText(t) {
  return (t?.content || t?.title || t?.name || "").trim();
}

// ---------- Basecamp wrappers (use ctx if provided) ----------
function api(ctx, pathOrUrl, opts = {}) {
  if (typeof ctx?.basecampFetch === "function") return ctx.basecampFetch(pathOrUrl, opts);
  return basecampFetch(ctx.TOKEN, pathOrUrl, { ...opts, accountId: ctx.accountId, ua: ctx.ua });
}

function apiAll(ctx, pathOrUrl, opts = {}) {
  if (typeof ctx?.basecampFetchAll === "function") return ctx.basecampFetchAll(pathOrUrl, opts);
  return basecampFetchAll(ctx.TOKEN, pathOrUrl, { ...opts, accountId: ctx.accountId, ua: ctx.ua });
}

// ---------- Projects ----------
async function listProjects(ctx, { archived = false } = {}) {
  const qs = archived ? "?status=archived" : "";
  // Fetch all pages, but return a compact shape to avoid tool output limits.
  const projects = await apiAll(ctx, `/projects.json${qs}`);

  return (projects || []).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    // useful but small
    created_at: p.created_at,
    updated_at: p.updated_at,
    app_url: p.app_url,
    url: p.url,
  }));
}

async function projectByName(ctx, name, { archived = false } = {}) {
  const projects = await listProjects(ctx, { archived });
  return resolveByName(projects, name, "project");
}

// ---------- Dock helpers ----------
function dockFind(dock, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) {
    const hit = (dock || []).find((d) => d?.name === n && d?.enabled !== false);
    if (hit) return hit;
  }
  return null;
}

async function getProject(ctx, projectId) {
  // account-scoped
  return api(ctx, `/projects/${projectId}.json`);
}

async function getDock(ctx, projectId) {
  const p = await getProject(ctx, projectId);
  return p?.dock || [];
}

// ---------- Todos (stable paths first) ----------
async function listTodoLists(ctx, projectId) {
  // ✅ Primary Basecamp 3 endpoint
  try {
    return apiAll(ctx, `/buckets/${projectId}/todolists.json`);
  } catch (e) {
    // ✅ Fallback: try to derive a todoset url/id from dock (some accounts differ)
    try {
      const dock = await getDock(ctx, projectId);
      const todosDock = dockFind(dock, ["todoset", "todos", "todo_set"]);
      if (todosDock?.url) {
        // todosDock.url usually ends in .json; derive lists
        const base = String(todosDock.url).replace(/\.json$/i, "");
        return apiAll(ctx, `${base}/todolists.json`);
      }
      if (todosDock?.id) {
        return apiAll(ctx, `/buckets/${projectId}/todosets/${todosDock.id}/todolists.json`);
      }
    } catch {
      // ignore and throw original below
    }
    throw e;
  }
}

async function listTodosForList(ctx, projectId, todolist) {
  if (todolist?.todos_url) return apiAll(ctx, todolist.todos_url);
  return apiAll(ctx, `/buckets/${projectId}/todolists/${todolist.id}/todos.json`);
}

async function listTodosForProject(ctx, projectId) {
  const lists = await listTodoLists(ctx, projectId);
  const groups = await mapLimit(lists || [], 2, async (l) => {
    const todos = await listTodosForList(ctx, projectId, l);
    return { todolistId: l.id, todolist: l.name, todos };
  });
  return groups;
}

async function listAllOpenTodos(ctx, { archivedProjects = false, maxProjects = 500 } = {}) {
  const cacheKey = `openTodos:${ctx.accountId}:${archivedProjects}:${maxProjects}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const projects = await listProjects(ctx, { archived: archivedProjects });
  const use = (projects || []).slice(0, maxProjects);

  // Conservative concurrency to reduce 429
  const perProject = await mapLimit(use, 1, async (p) => {
    try {
      const groups = await listTodosForProject(ctx, p.id);
      const rows = [];
      for (const g of groups) {
        for (const t of g.todos || []) {
          const completed = !!(t.completed || t.completed_at);
          if (completed) continue;
          rows.push({
            project: p.name,
            projectId: p.id,
            todolist: g.todolist,
            todolistId: g.todolistId,
            todoId: t.id,
            content: todoText(t),
            due_on: isoDate(t.due_on || t.due_at),
            url: t.app_url || t.url || null,
          });
        }
      }
      return rows;
    } catch {
      return [];
    }
  });

  return cacheSet(cacheKey, perProject.flat());
}

// ---------- Assignment report (schema expects this) ----------
async function assignmentReport(ctx, projectName, { maxTodos = 250 } = {}) {
  const p = await projectByName(ctx, projectName);
  const groups = await listTodosForProject(ctx, p.id);

  const open = [];
  for (const g of groups) {
    for (const t of g.todos || []) {
      if (t.completed || t.completed_at) continue;
      open.push({
        project: p.name,
        projectId: p.id,
        todolist: g.todolist,
        todoId: t.id,
        content: todoText(t),
        due_on: isoDate(t.due_on || t.due_at),
      });
      if (open.length >= maxTodos) break;
    }
    if (open.length >= maxTodos) break;
  }

  // Basecamp todo assignee fields vary. We'll try common shapes.
  const by = new Map(); // key -> { assignee, assignee_id, tasks: [] }

  for (const item of open) {
    const t = item.raw || {};
    let assignee = null;
    let assignee_id = null;

    // most common embedded form
    if (Array.isArray(t.assignees) && t.assignees.length) {
      assignee = t.assignees[0]?.name || null;
      assignee_id = t.assignees[0]?.id || null;
    } else if (Array.isArray(t.assignee_ids) && t.assignee_ids.length) {
      assignee_id = t.assignee_ids[0];
      assignee = String(assignee_id);
    } else if (t.assignee_id) {
      assignee_id = t.assignee_id;
      assignee = String(assignee_id);
    }

    const key = assignee_id != null ? `id:${assignee_id}` : `name:${assignee || "unassigned"}`;
    if (!by.has(key)) by.set(key, { assignee, assignee_id, tasks: [] });
    by.get(key).tasks.push({
      project: item.project,
      projectId: item.projectId,
      todolist: item.todolist,
      todoId: item.todoId,
      content: item.content,
      due_on: item.due_on,
      overdue: false,
    });
  }

  const by_assignee = Array.from(by.values())
    .map((x) => ({
      assignee: x.assignee,
      assignee_id: x.assignee_id,
      count: x.tasks.length,
      tasks: x.tasks.sort((a, b) => (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99")),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    project: p.name,
    total_open: open.length,
    capped: open.length >= maxTodos,
    by_assignee,
  };
}

// ---------- Card Tables ----------
async function listCardTables(ctx, projectId) {
  try {
    return apiAll(ctx, `/buckets/${projectId}/card_tables.json`);
  } catch {
    const dock = await getDock(ctx, projectId);
    const card = dockFind(dock, ["card_table", "card_tables", "kanban", "kanban_board"]);
    if (card?.url) {
      const obj = await api(ctx, card.url);
      return Array.isArray(obj) ? obj : [obj];
    }
    return [];
  }
}

async function listCardTableColumns(ctx, projectId, cardTableId) {
  return apiAll(ctx, `/buckets/${projectId}/card_tables/${cardTableId}/columns.json`);
}

async function listCardTableCards(ctx, projectId, cardTableId) {
  return apiAll(ctx, `/buckets/${projectId}/card_tables/${cardTableId}/cards.json`);
}

async function createCard(ctx, projectId, cardTableId, { title, content, column_id, due_on } = {}) {
  const body = { title };
  if (content) body.content = content;
  if (column_id) body.column_id = column_id;
  if (due_on) body.due_on = due_on;
  return api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}/cards.json`, { method: "POST", body });
}

async function moveCard(ctx, projectId, cardId, { column_id, position } = {}) {
  const body = {};
  if (column_id) body.column_id = column_id;
  if (position != null) body.position = position;
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`, { method: "PUT", body });
}

// ---------- Hill Charts ----------
async function getHillChartFromDock(ctx, projectId) {
  const dock = await getDock(ctx, projectId);
  const hill = dockFind(dock, ["hill_chart", "hill_charts"]);
  if (!hill) return null;
  if (hill.url) return api(ctx, hill.url);
  if (hill.id) return api(ctx, `/buckets/${projectId}/hill_charts/${hill.id}.json`);
  return null;
}

// ---------- MCP handler ----------
export async function handleMCP(reqBody, ctx) {
  const { id, method, params } = reqBody || {};
  const { TOKEN, accountId, startStatus, authAccounts } = ctx || {};

  try {
    if (method === "initialize") {
      return ok(id, { name: "bcgpt", version: "3.1", sessionId: crypto.randomUUID() });
    }

    if (method === "tools/list") {
      return ok(id, {
        tools: [
          tool("startbcgpt", "Show connection status, current user (name/email), plus re-auth and logout links.", noProps()),
          tool("whoami", "Return account id + authorized accounts list.", noProps()),

          tool("list_accounts", "List Basecamp accounts available to the authenticated user.", noProps()),
          tool("list_projects", "List projects (supports archived).", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, archived: { type: "boolean" } },
            additionalProperties: false
          }),
          tool("find_project", "Resolve a project by name (fuzzy).", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, name: { type: "string" } },
            required: ["name"],
            additionalProperties: false
          }),

          tool("daily_report", "Across projects: totals + per-project breakdown + due today + overdue (open only).", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, date: { type: "string", description: "YYYY-MM-DD (defaults today)" } },
            additionalProperties: false
          }),
          tool("list_todos_due", "Across projects: list open todos due on date; optionally include overdue.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true },
              date: { type: "string", description: "YYYY-MM-DD (defaults today)" },
              include_overdue: { type: "boolean" }
            },
            additionalProperties: false
          }),
          tool("search_todos", "Search open todos across all projects by keyword.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, query: { type: "string" } },
            required: ["query"],
            additionalProperties: false
          }),
          tool("assignment_report", "Group open todos by assignee within a project (optimized).", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, project: { type: "string" }, max_todos: { type: "integer" } },
            required: ["project"],
            additionalProperties: false
          }),

          tool("list_todos_for_project", "List todolists + todos for a project by name.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, project: { type: "string" } },
            required: ["project"],
            additionalProperties: false
          }),

          // Schema uses "task". We'll accept task OR content for backward compatibility.
          tool("create_todo", "Create a to-do in a project; optionally specify todolist and due date.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true },
              project: { type: "string" },
              todolist: { type: "string", nullable: true },
              task: { type: "string" },
              content: { type: "string", nullable: true },
              description: { type: "string", nullable: true },
              due_on: { type: "string", nullable: true }
            },
            required: ["project", "task"],
            additionalProperties: false
          }),

          tool("complete_task_by_name", "Complete a todo in a project by fuzzy-matching its content.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, project: { type: "string" }, task: { type: "string" } },
            required: ["project", "task"],
            additionalProperties: false
          }),

          // Card tables
          tool("list_card_tables", "List card tables (kanban boards) for a project.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, project: { type: "string" } },
            required: ["project"],
            additionalProperties: false
          }),
          tool("list_card_table_columns", "List columns for a card table.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, project: { type: "string" }, card_table_id: { type: "integer" } },
            required: ["project", "card_table_id"],
            additionalProperties: false
          }),
          tool("list_card_table_cards", "List cards for a card table.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, project: { type: "string" }, card_table_id: { type: "integer" } },
            required: ["project", "card_table_id"],
            additionalProperties: false
          }),
          tool("create_card", "Create a card in a card table.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true },
              project: { type: "string" },
              card_table_id: { type: "integer" },
              title: { type: "string" },
              content: { type: "string", nullable: true },
              column_id: { type: "integer", nullable: true },
              due_on: { type: "string", nullable: true }
            },
            required: ["project", "card_table_id", "title"],
            additionalProperties: false
          }),
          tool("move_card", "Move/update a card (column/position).", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true },
              project: { type: "string" },
              card_id: { type: "integer" },
              column_id: { type: "integer", nullable: true },
              position: { type: "integer", nullable: true }
            },
            required: ["project", "card_id"],
            additionalProperties: false
          }),

          // Hill charts
          tool("get_hill_chart", "Fetch the hill chart for a project (if enabled).", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, project: { type: "string" } },
            required: ["project"],
            additionalProperties: false
          }),

          // Raw escape hatch
          tool("basecamp_request", "Raw Basecamp API call. Provide full URL or a /path.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, path: { type: "string" }, method: { type: "string" }, body: { type: "object" } },
            required: ["path"],
            additionalProperties: false
          }),
          tool("debug_basecamp_raw",
  "DEBUG ONLY. Returns raw Basecamp API responses. Never use for user-facing queries.", "Alias of basecamp_request for backward compatibility.", {
            type: "object",
            properties: {
      confirm_debug: { type: "boolean", const: true }, path: { type: "string" }, method: { type: "string" }, body: { type: "object" } },
            required: ["path"],
            additionalProperties: false
          })
        ]
      });
    }

    if (method !== "tools/call") {
      return fail(id, { code: "UNKNOWN_METHOD", message: "Unknown MCP method" });
    }

    const { name, arguments: args = {} } = params || {};
    if (!name) return fail(id, { code: "BAD_REQUEST", message: "Missing tool name" });

    // startbcgpt always returns auth link info (even when disconnected)
    if (name === "startbcgpt") return ok(id, await startStatus());

    // whoami
    if (name === "whoami") {
      if (!TOKEN?.access_token) {
        return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
      }
      return ok(id, { accountId, user: null, accounts: authAccounts || [] });
    }

    // Everything else requires auth
    if (!TOKEN?.access_token) {
      return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
    }

    if (name === "list_accounts") return ok(id, authAccounts || []);

    if (name === "list_projects") {
      const projects = await listProjects(ctx, { archived: !!args.archived });
      return ok(id, projects);
    }

    if (name === "find_project") {
      const p = await projectByName(ctx, args.name);
      return ok(id, p);
    }

    if (name === "list_todos_for_project") {
      const p = await projectByName(ctx, args.project);
      const groups = await listTodosForProject(ctx, p.id);
      return ok(id, { project: { id: p.id, name: p.name }, groups });
    }

    if (name === "daily_report") {
      const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
      const rows = await listAllOpenTodos(ctx);

      const dueToday = rows.filter((r) => r.due_on === date);
      const overdue = rows.filter((r) => r.due_on && r.due_on < date);

      const perProject = {};
      for (const r of rows) {
        perProject[r.project] ||= { project: r.project, projectId: r.projectId, openTodos: 0, dueToday: 0, overdue: 0 };
        perProject[r.project].openTodos += 1;
        if (r.due_on === date) perProject[r.project].dueToday += 1;
        if (r.due_on && r.due_on < date) perProject[r.project].overdue += 1;
      }

      const perProjectArr = Object.values(perProject).sort(
        (a, b) => (b.overdue - a.overdue) || (b.dueToday - a.dueToday) || (a.project || "").localeCompare(b.project || "")
      );

      return ok(id, {
        date,
        totals: {
          projects: new Set(rows.map((r) => r.projectId)).size,
          dueToday: dueToday.length,
          overdue: overdue.length
        },
        perProject: perProjectArr,
        dueToday,
        overdue
      });
    }

    if (name === "list_todos_due") {
      const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
      const includeOverdue = !!args.include_overdue;

      const rows = await listAllOpenTodos(ctx);
      const todos = rows
        .filter((r) => r.due_on === date || (includeOverdue && r.due_on && r.due_on < date))
        .map((r) => ({ ...r, overdue: !!(r.due_on && r.due_on < date) }));

      todos.sort(
        (a, b) =>
          (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1) ||
          (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") ||
          (a.project || "").localeCompare(b.project || "")
      );

      return ok(id, { date, count: todos.length, todos });
    }

    if (name === "search_todos") {
      const q = String(args.query || "").trim().toLowerCase();
      if (!q) return ok(id, { query: "", count: 0, todos: [] });

      const cacheKey = `search:${ctx.accountId}:${q}`;
      const cached = cacheGet(cacheKey);
      if (cached) return ok(id, { cached: true, ...cached });

      // Uses cached openTodos list (60s TTL) to avoid rescanning under throttling
      const rows = await listAllOpenTodos(ctx);
      const hits = rows.filter((r) => (r.content || "").toLowerCase().includes(q));

      hits.sort(
        (a, b) =>
          (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") ||
          (a.project || "").localeCompare(b.project || "")
      );

      return ok(id, cacheSet(cacheKey, { query: args.query, count: hits.length, todos: hits }));
    }

    if (name === "assignment_report") {
      const maxTodos = Number(args.max_todos || 250);
      const result = await assignmentReport(ctx, args.project, { maxTodos });
      return ok(id, result);
    }

    if (name === "create_todo") {
      const p = await projectByName(ctx, args.project);

      const lists = await listTodoLists(ctx, p.id);
      if (!lists?.length) return fail(id, { code: "NO_TODOLISTS", message: "No to-do lists found in that project." });

      let target = lists[0];
      if (args.todolist) {
        const m = resolveByName(lists.map((l) => ({ id: l.id, name: l.name })), args.todolist, "todolist");
        target = lists.find((l) => l.id === m.id) || lists[0];
      }

      const taskText = String(args.task || args.content || "").trim();
      if (!taskText) return fail(id, { code: "BAD_REQUEST", message: "Missing task/content." });

      const body = { content: taskText };
      if (args.description) body.description = args.description;
      if (args.due_on) body.due_on = args.due_on;

      let created;
      if (target.todos_url) {
        created = await api(ctx, target.todos_url, { method: "POST", body });
      } else {
        created = await api(ctx, `/buckets/${p.id}/todolists/${target.id}/todos.json`, { method: "POST", body });
      }

      return ok(id, {
        message: "Todo created",
        project: { id: p.id, name: p.name },
        todolist: { id: target.id, name: target.name },
        todo: created
      });
    }

    if (name === "complete_task_by_name") {
      const p = await projectByName(ctx, args.project);
      const groups = await listTodosForProject(ctx, p.id);
      const all = groups.flatMap((g) => (g.todos || []).map((t) => ({ id: t.id, name: todoText(t) })));

      const match = resolveBestEffort(all, args.task) || resolveByName(all, args.task, "todo");
      await api(ctx, `/buckets/${p.id}/todos/${match.id}/completion.json`, { method: "POST" });

      return ok(id, { message: "Task completed", project: { id: p.id, name: p.name }, todoId: match.id, task: match.name });
    }

    // Card tables
    if (name === "list_card_tables") {
      const p = await projectByName(ctx, args.project);
      const tables = await listCardTables(ctx, p.id);
      return ok(id, { project: { id: p.id, name: p.name }, card_tables: tables });
    }

    if (name === "list_card_table_columns") {
      const p = await projectByName(ctx, args.project);
      const cols = await listCardTableColumns(ctx, p.id, Number(args.card_table_id));
      return ok(id, { project: { id: p.id, name: p.name }, columns: cols });
    }

    if (name === "list_card_table_cards") {
      const p = await projectByName(ctx, args.project);
      const cards = await listCardTableCards(ctx, p.id, Number(args.card_table_id));
      return ok(id, { project: { id: p.id, name: p.name }, cards });
    }

    if (name === "create_card") {
      const p = await projectByName(ctx, args.project);
      const card = await createCard(ctx, p.id, Number(args.card_table_id), {
        title: args.title,
        content: args.content,
        column_id: args.column_id,
        due_on: args.due_on
      });
      return ok(id, { message: "Card created", project: { id: p.id, name: p.name }, card });
    }

    if (name === "move_card") {
      const p = await projectByName(ctx, args.project);
      const card = await moveCard(ctx, p.id, Number(args.card_id), { column_id: args.column_id, position: args.position });
      return ok(id, { message: "Card updated", project: { id: p.id, name: p.name }, card });
    }

    // Hill charts
    if (name === "get_hill_chart") {
      const p = await projectByName(ctx, args.project);
      const hill = await getHillChartFromDock(ctx, p.id);
      if (!hill) return fail(id, { code: "TOOL_NOT_ENABLED", message: "Hill chart not enabled for this project (or not accessible)." });
      return ok(id, { project: { id: p.id, name: p.name }, hill_chart: hill });
    }

    // Raw
    if (name === "basecamp_request" || name === "basecamp_raw") {
      const data = await api(ctx, args.path, { method: args.method || "GET", body: args.body });
      return ok(id, data);
    }

    return fail(id, { code: "UNKNOWN_TOOL", message: "Unknown tool name" });
  } catch (e) {
    if (e?.code === "AMBIGUOUS_MATCH") {
      return fail(id, { code: "AMBIGUOUS_MATCH", message: `Ambiguous ${e.label}. Please choose one.`, options: e.options });
    }
    if (e?.code === "NO_MATCH") {
      return fail(id, { code: "NO_MATCH", message: `No ${e.label} matched your input.` });
    }
    if (e?.code === "NOT_AUTHENTICATED") {
      return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
    }
    if (e?.code === "BASECAMP_API_ERROR") {
      return fail(id, { code: "BASECAMP_API_ERROR", message: `Basecamp API error (${e.status})`, url: e.url, data: e.data });
    }
    return fail(id, { code: "INTERNAL_ERROR", message: e?.message || String(e) });
  }
}
