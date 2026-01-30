// mcp.js
import crypto from "crypto";
import { basecampFetch, basecampFetchAll } from "./basecamp.js";
import { resolveByName, resolveBestEffort } from "./resolvers.js";

// ---------- JSON-RPC helpers ----------
function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function fail(id, error) {
  return { jsonrpc: "2.0", id, error };
}

// ---------- Tool schema helpers ----------
function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}
function noProps() {
  return { type: "object", properties: {}, additionalProperties: false };
}

// ---------- Tiny in-memory cache ----------
const CACHE = new Map(); // key -> { ts, value }
const CACHE_TTL_MS = 60 * 1000;

function cacheGet(key) {
  const v = CACHE.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
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

// ---------- Basecamp wrapper (uses ctx if provided) ----------
function api(ctx, pathOrUrl, opts = {}) {
  // ctx can provide a pre-wired fetch (your backend does this)
  if (typeof ctx?.basecampFetch === "function") return ctx.basecampFetch(pathOrUrl, opts);
  // fallback (needs accountId passed in opts)
  return basecampFetch(ctx.TOKEN, pathOrUrl, { ...opts, accountId: ctx.accountId, ua: ctx.ua });
}

function apiAll(ctx, pathOrUrl, opts = {}) {
  if (typeof ctx?.basecampFetchAll === "function") return ctx.basecampFetchAll(pathOrUrl, opts);
  return basecampFetchAll(ctx.TOKEN, pathOrUrl, { ...opts, accountId: ctx.accountId, ua: ctx.ua });
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
  // Basecamp project id == bucket id
  // NOTE: project endpoints are account-scoped; basecampFetch normalizes using accountId.
  return api(ctx, `/projects/${projectId}.json`);
}

async function getDock(ctx, projectId) {
  const p = await getProject(ctx, projectId);
  return p?.dock || [];
}

async function listProjects(ctx, { archived = false } = {}) {
  // Active projects are default; archived can be requested via status=archived
  const qs = archived ? "?status=archived" : "";
  return apiAll(ctx, `/projects.json${qs}`);
}

async function projectByName(ctx, name, { archived = false } = {}) {
  const projects = await listProjects(ctx, { archived });
  return resolveByName(projects, name, "project");
}

// ---------- To-do set aware helpers ----------
async function getTodosetInfo(ctx, projectId) {
  const dock = await getDock(ctx, projectId);

  // Basecamp 4 docs: project has exactly one todoset, find via dock payload.
  const todoset = dockFind(dock, ["todoset", "todo_set", "todos"]);
  if (!todoset) return { dock, todoset: null };

  // Some docks include a `url`, some only `id`. Support both.
  return { dock, todoset };
}

function stripJson(urlOrPath) {
  if (!urlOrPath) return urlOrPath;
  return String(urlOrPath).replace(/\.json$/i, "");
}

async function listTodoLists(ctx, projectId) {
  const { todoset } = await getTodosetInfo(ctx, projectId);

  // Prefer todoset-based path (Basecamp 4)
  if (todoset?.url) {
    const base = stripJson(todoset.url); // .../todosets/<id>
    try {
      return apiAll(ctx, `${base}/todolists.json`);
    } catch (e) {
      // fallback below
    }
  }
  if (todoset?.id) {
    try {
      return apiAll(ctx, `/buckets/${projectId}/todosets/${todoset.id}/todolists.json`);
    } catch (e) {
      // fallback below
    }
  }

  // Legacy fallback (older Basecamp 3-style)
  return apiAll(ctx, `/buckets/${projectId}/todolists.json`);
}

async function listTodosForList(ctx, projectId, todolist) {
  // Prefer todos_url if present
  if (todolist?.todos_url) {
    return apiAll(ctx, todolist.todos_url);
  }
  // Legacy
  return apiAll(ctx, `/buckets/${projectId}/todolists/${todolist.id}/todos.json`);
}

async function listTodosForProject(ctx, projectId) {
  const lists = await listTodoLists(ctx, projectId);
  const groups = await mapLimit(lists || [], 3, async (l) => {
    const todos = await listTodosForList(ctx, projectId, l);
    return { todolistId: l.id, todolist: l.name, todos };
  });
  return groups;
}

async function listAllOpenTodos(ctx, { archivedProjects = false, maxProjects = 300 } = {}) {
  // Cached because many tools ask repeatedly
  const cacheKey = `openTodos:${ctx.accountId}:${archivedProjects}:${maxProjects}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const projects = await listProjects(ctx, { archived: archivedProjects });
  const use = (projects || []).slice(0, maxProjects);

  // Very important for rate limits: low concurrency
  const perProject = await mapLimit(use, 2, async (p) => {
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
            raw: t,
          });
        }
      }
      return rows;
    } catch (e) {
      // If a project tool is disabled / permissions / deleted → skip
      return [];
    }
  });

  const all = perProject.flat();
  return cacheSet(cacheKey, all);
}

// ---------- Card Tables helpers (dock-aware + fallback) ----------
async function listCardTables(ctx, projectId) {
  // Try direct index endpoint first
  try {
    return apiAll(ctx, `/buckets/${projectId}/card_tables.json`);
  } catch {
    // fallback: try via dock hints (some accounts/tools name it differently)
    const dock = await getDock(ctx, projectId);
    const card = dockFind(dock, ["card_table", "card_tables", "kanban_board", "kanban"]);
    if (card?.url) {
      // if dock points to a specific card table, return it
      const obj = await api(ctx, card.url);
      return Array.isArray(obj) ? obj : [obj];
    }
    return [];
  }
}

async function listCardTableColumns(ctx, projectId, cardTableId) {
  // Official docs list "card table columns" endpoints; this is the common pattern:
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
  // Common update endpoint pattern for cards:
  const body = {};
  if (column_id) body.column_id = column_id;
  if (position != null) body.position = position;
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`, { method: "PUT", body });
}

// ---------- Hill Charts helpers (dock-aware + fallback) ----------
async function getHillChartFromDock(ctx, projectId) {
  const dock = await getDock(ctx, projectId);
  const hill = dockFind(dock, ["hill_chart", "hill_charts"]);
  if (!hill) return null;

  if (hill.url) return api(ctx, hill.url);
  if (hill.id) {
    // common pattern
    return api(ctx, `/buckets/${projectId}/hill_charts/${hill.id}.json`);
  }
  return null;
}

// ---------- MCP handler ----------
export async function handleMCP(reqBody, ctx) {
  const { id, method, params } = reqBody || {};
  const { TOKEN, accountId, ua, startStatus, authAccounts } = ctx || {};

  try {
    if (method === "initialize") {
      return ok(id, { name: "bcgpt", version: "3.0", sessionId: crypto.randomUUID() });
    }

    if (method === "tools/list") {
      return ok(id, {
        tools: [
          tool("startbcgpt", "Show connection status, current user (name/email), plus re-auth and logout links.", noProps()),
          tool("whoami", "Return account id + user identity from authorization.json cache.", noProps()),

          tool("list_accounts", "List Basecamp accounts available to the authenticated user.", noProps()),
          tool("list_projects", "List projects in the current account (supports archived).", {
            type: "object",
            properties: { archived: { type: "boolean" } },
            additionalProperties: false,
          }),
          tool("find_project", "Resolve a project by name (fuzzy).", {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          }),

          // Todos
          tool("daily_report", "Across projects: totals + per-project breakdown + due today + overdue (open only).", {
            type: "object",
            properties: { date: { type: "string", description: "YYYY-MM-DD (defaults today)" } },
            additionalProperties: false,
          }),
          tool("list_todos_due", "Across projects: list open todos due on date; optionally include overdue.", {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD (defaults today)" },
              include_overdue: { type: "boolean" },
            },
            additionalProperties: false,
          }),
          tool("search_todos", "Across projects: search open todos by keyword (rate-limit safe scanning).", {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          }),
          tool("list_todos_for_project", "List todolists + todos for a project by name.", {
            type: "object",
            properties: { project: { type: "string" } },
            required: ["project"],
            additionalProperties: false,
          }),
          tool("create_todo", "Create a to-do in a project; optionally specify todolist and due date.", {
            type: "object",
            properties: {
              project: { type: "string" },
              todolist: { type: "string" },
              content: { type: "string" },
              description: { type: "string" },
              due_on: { type: "string" },
            },
            required: ["project", "content"],
            additionalProperties: false,
          }),
          tool("complete_task_by_name", "Complete a todo in a project by fuzzy-matching its content.", {
            type: "object",
            properties: { project: { type: "string" }, task: { type: "string" } },
            required: ["project", "task"],
            additionalProperties: false,
          }),

          // Card tables
          tool("list_card_tables", "List card tables (kanban boards) for a project.", {
            type: "object",
            properties: { project: { type: "string" } },
            required: ["project"],
            additionalProperties: false,
          }),
          tool("list_card_table_columns", "List columns for a card table.", {
            type: "object",
            properties: { project: { type: "string" }, card_table_id: { type: "integer" } },
            required: ["project", "card_table_id"],
            additionalProperties: false,
          }),
          tool("list_card_table_cards", "List cards for a card table.", {
            type: "object",
            properties: { project: { type: "string" }, card_table_id: { type: "integer" } },
            required: ["project", "card_table_id"],
            additionalProperties: false,
          }),
          tool("create_card", "Create a card in a card table.", {
            type: "object",
            properties: {
              project: { type: "string" },
              card_table_id: { type: "integer" },
              title: { type: "string" },
              content: { type: "string" },
              column_id: { type: "integer" },
              due_on: { type: "string" },
            },
            required: ["project", "card_table_id", "title"],
            additionalProperties: false,
          }),
          tool("move_card", "Move/update a card (column/position).", {
            type: "object",
            properties: {
              project: { type: "string" },
              card_id: { type: "integer" },
              column_id: { type: "integer" },
              position: { type: "integer" },
            },
            required: ["project", "card_id"],
            additionalProperties: false,
          }),

          // Hill charts
          tool("get_hill_chart", "Fetch the hill chart for a project (if enabled).", {
            type: "object",
            properties: { project: { type: "string" } },
            required: ["project"],
            additionalProperties: false,
          }),

          // Raw escape hatch (keeps you future-proof)
          tool("basecamp_request", "Raw Basecamp API call. Provide full URL or a /path (account prefix is auto-added).", {
            type: "object",
            properties: {
              path: { type: "string" },
              method: { type: "string" },
              body: { type: "object" },
            },
            required: ["path"],
            additionalProperties: false,
          }),
          tool("basecamp_raw", "Raw Basecamp API call (alias of basecamp_request for backward compatibility). Provide full URL or a /path.", {
            type: "object",
            properties: {
              path: { type: "string" },
              method: { type: "string" },
              body: { type: "object" }
            },
            required: ["path"],
            additionalProperties: false
          }),

        ],
      });
    }

    if (method !== "tools/call") {
      return fail(id, { code: "UNKNOWN_METHOD", message: "Unknown MCP method" });
    }

    const { name, arguments: args = {} } = params || {};
    if (!name) return fail(id, { code: "BAD_REQUEST", message: "Missing tool name" });

    // Entry point: MUST always return auth link if not connected
    if (name === "startbcgpt") {
      return ok(id, await startStatus());
    }

    // whoami
    if (name === "whoami") {
      if (!TOKEN?.access_token) {
        return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
      }
      // authAccounts is passed in ctx by your backend from authorization.json
      return ok(id, {
        accountId,
        user: null,
        accounts: authAccounts || [],
      });
    }

    // Everything below requires auth
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
        perProject[r.project] ||= { project: r.project, projectId: r.projectId, open: 0, dueToday: 0, overdue: 0 };
        perProject[r.project].open += 1;
        if (r.due_on === date) perProject[r.project].dueToday += 1;
        if (r.due_on && r.due_on < date) perProject[r.project].overdue += 1;
      }

      const perProjectArr = Object.values(perProject).sort(
        (a, b) => (b.overdue - a.overdue) || (b.dueToday - a.dueToday) || (a.project || "").localeCompare(b.project || "")
      );

      return ok(id, {
        date,
        totals: { projects: new Set(rows.map((r) => r.projectId)).size, dueToday: dueToday.length, overdue: overdue.length },
        perProject: perProjectArr,
        dueToday,
        overdue,
      });
    }

    if (name === "list_todos_due") {
      const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
      const includeOverdue = !!args.include_overdue;

      const rows = await listAllOpenTodos(ctx);
      const todos = rows
        .filter((r) => r.due_on === date || (includeOverdue && r.due_on && r.due_on < date))
        .map((r) => ({ ...r, overdue: r.due_on && r.due_on < date }));

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

      // Cache per query to avoid repeated scans
      const cacheKey = `search:${ctx.accountId}:${q}`;
      const cached = cacheGet(cacheKey);
      if (cached) return ok(id, { cached: true, ...cached });

      const rows = await listAllOpenTodos(ctx);
      const hits = rows.filter((r) => (r.content || "").toLowerCase().includes(q));

      hits.sort(
        (a, b) =>
          (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") ||
          (a.project || "").localeCompare(b.project || "")
      );

      return ok(id, cacheSet(cacheKey, { query: args.query, count: hits.length, todos: hits }));
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

      const body = { content: args.content };
      if (args.description) body.description = args.description;
      if (args.due_on) body.due_on = args.due_on;

      // To-dos are created on the todolist's todos endpoint.
      let created;
      if (target.todos_url) {
        created = await api(ctx, target.todos_url, { method: "POST", body });
      } else {
        created = await api(ctx, `/buckets/${p.id}/todolists/${target.id}/todos.json`, { method: "POST", body });
      }

      return ok(id, { message: "Todo created", project: { id: p.id, name: p.name }, todolist: { id: target.id, name: target.name }, todo: created });
    }

    if (name === "complete_task_by_name") {
      const p = await projectByName(ctx, args.project);
      const groups = await listTodosForProject(ctx, p.id);
      const all = groups.flatMap((g) => (g.todos || []).map((t) => ({ id: t.id, name: todoText(t) })));

      const match = resolveBestEffort(all, args.task) || resolveByName(all, args.task, "todo");

      await api(ctx, `/buckets/${p.id}/todos/${match.id}/completion.json`, { method: "POST" });
      return ok(id, { message: "Task completed", project: { id: p.id, name: p.name }, todoId: match.id, task: match.name });
    }

    // ---- Card tables tools ----
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
        due_on: args.due_on,
      });
      return ok(id, { message: "Card created", project: { id: p.id, name: p.name }, card });
    }

    if (name === "move_card") {
      const p = await projectByName(ctx, args.project);
      const card = await moveCard(ctx, p.id, Number(args.card_id), { column_id: args.column_id, position: args.position });
      return ok(id, { message: "Card updated", project: { id: p.id, name: p.name }, card });
    }

    // ---- Hill charts ----
    if (name === "get_hill_chart") {
      const p = await projectByName(ctx, args.project);
      const hill = await getHillChartFromDock(ctx, p.id);
      if (!hill) return fail(id, { code: "TOOL_NOT_ENABLED", message: "Hill chart not enabled for this project (or not accessible)." });
      return ok(id, { project: { id: p.id, name: p.name }, hill_chart: hill });
    }

    // ---- Raw fallback ----
    if (name === "basecamp_request" || name === "basecamp_raw") {
      const data = await api(ctx, args.path, { method: args.method || "GET", body: args.body });
      return ok(id, data);
    }

    

    return fail(id, { code: "UNKNOWN_TOOL", message: "Unknown tool name" });
  } catch (e) {
    // Resolver structured errors
    if (e?.code === "AMBIGUOUS_MATCH") {
      return fail(id, { code: "AMBIGUOUS_MATCH", message: `Ambiguous ${e.label}. Please choose one.`, options: e.options });
    }
    if (e?.code === "NO_MATCH") {
      return fail(id, { code: "NO_MATCH", message: `No ${e.label} matched your input.` });
    }

    // Auth / API errors
    if (e?.code === "NOT_AUTHENTICATED") {
      return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
    }
    if (e?.code === "BASECAMP_API_ERROR") {
      return fail(id, { code: "BASECAMP_API_ERROR", message: `Basecamp API error (${e.status})`, url: e.url, data: e.data });
    }

    return fail(id, { code: "INTERNAL_ERROR", message: e?.message || String(e) });
  }
}
