import crypto from "crypto";
import { basecampFetch } from "./basecamp.js";
import { resolveByName, resolveBestEffort } from "./resolvers.js";

/* =========================
   JSON-RPC helpers
========================= */
function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function fail(id, error) { return { jsonrpc: "2.0", id, error }; }

function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}

function noProps() {
  return { type: "object", properties: {}, additionalProperties: false };
}

function isoDate(d) {
  if (!d) return null;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = new Date(s);
  if (!isNaN(t)) return t.toISOString().slice(0, 10);
  return null;
}

/* =========================
   Cache (in-memory)
========================= */
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

/* =========================
   Concurrency limiter
========================= */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/* =========================
   Basecamp helpers
========================= */
function todoText(t) {
  return (t?.content || t?.title || t?.name || "").trim();
}

function todoAssigneeNames(todo, peopleById) {
  // Basecamp often returns assignees embedded
  if (Array.isArray(todo.assignees) && todo.assignees.length) {
    return todo.assignees.map(a => a?.name).filter(Boolean);
  }
  const list = Array.isArray(todo.assignee_ids) ? todo.assignee_ids : [];
  return (list || []).map(id => peopleById.get(String(id)) || String(id));
}

async function listProjects(TOKEN, accountId, ua, { archived = false } = {}) {
  // Basecamp expects .json
  const qs = archived ? "?status=archived" : "";
  return await basecampFetch(TOKEN, `/${accountId}/projects.json${qs}`, { ua, accountId });
}

async function projectByName(TOKEN, accountId, name, ua, opts = {}) {
  const projects = await listProjects(TOKEN, accountId, ua, opts);
  return resolveByName(projects, name, "project");
}

async function getProject(TOKEN, accountId, projectId, ua) {
  // Must include .json
  return await basecampFetch(TOKEN, `/${accountId}/projects/${projectId}.json`, { ua, accountId });
}

async function getDock(TOKEN, accountId, projectId, ua) {
  const p = await getProject(TOKEN, accountId, projectId, ua);
  return p?.dock || [];
}

function dockFind(dock, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) {
    const hit = (dock || []).find(d => d.name === n && d.enabled);
    if (hit) return hit;
  }
  return null;
}

async function listTodoLists(TOKEN, projectId, ua) {
  return await basecampFetch(TOKEN, `/buckets/${projectId}/todolists.json`, { ua });
}

async function listTodosForList(TOKEN, projectId, list, ua) {
  // Prefer todos_url if present
  if (list?.todos_url) {
    return await basecampFetch(TOKEN, list.todos_url, { ua });
  }
  return await basecampFetch(TOKEN, `/buckets/${projectId}/todolists/${list.id}/todos.json`, { ua });
}

async function listTodosForProject(TOKEN, projectId, ua) {
  const lists = await listTodoLists(TOKEN, projectId, ua);
  const groups = await mapLimit(lists, 4, async (l) => {
    const todos = await listTodosForList(TOKEN, projectId, l, ua);
    return { todolistId: l.id, todolist: l.name, todos };
  });
  return groups;
}

/**
 * Global scan: open todos across all projects
 * - Uses concurrency to reduce timeouts
 */
async function listAllOpenTodos(TOKEN, accountId, ua) {
  const cacheKey = `openTodos:${accountId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const projects = await listProjects(TOKEN, accountId, ua, { archived: false });

  const perProject = await mapLimit(projects, 3, async (p) => {
    const groups = await listTodosForProject(TOKEN, p.id, ua);
    const rows = [];
    for (const g of groups) {
      for (const t of (g.todos || [])) {
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
          raw: t
        });
      }
    }
    return rows;
  });

  const flat = perProject.flat();
  return cacheSet(cacheKey, flat);
}

/* =========================
   Tool Implementations
========================= */
async function t_startbcgpt(ctx) {
  return await ctx.startStatus();
}

async function t_whoami(ctx) {
  // return what we can
  return {
    accountId: ctx.accountId || null,
    accounts: ctx.authAccounts || [],
    message: ctx.accountId ? "Connected." : "Connected, but no accountId resolved."
  };
}

async function t_list_accounts(ctx) {
  return ctx.authAccounts || [];
}

async function t_list_projects(args, ctx) {
  return await listProjects(ctx.TOKEN, ctx.accountId, ctx.ua, { archived: !!args.archived });
}

async function t_get_project_by_name(args, ctx) {
  return await projectByName(ctx.TOKEN, ctx.accountId, args.name, ctx.ua);
}

async function t_get_project_dock(args, ctx) {
  return await getDock(ctx.TOKEN, ctx.accountId, Number(args.project_id), ctx.ua);
}

async function t_list_todos_for_project(args, ctx) {
  const project = await projectByName(ctx.TOKEN, ctx.accountId, args.project, ctx.ua);
  const groups = await listTodosForProject(ctx.TOKEN, project.id, ctx.ua);
  return { project: { id: project.id, name: project.name }, groups };
}

async function t_create_task_naturally(args, ctx) {
  const project = await projectByName(ctx.TOKEN, ctx.accountId, args.project, ctx.ua);
  const lists = await listTodoLists(ctx.TOKEN, project.id, ctx.ua);
  if (!lists.length) throw Object.assign(new Error("No todolists found"), { code: "NO_TODOLISTS" });

  let target = lists[0];
  if (args.todolist) {
    const m = resolveByName(lists.map(l => ({ id: l.id, name: l.name })), args.todolist, "todolist");
    target = lists.find(l => l.id === m.id) || lists[0];
  }

  const body = { content: args.task };
  if (args.description) body.description = args.description;
  if (args.due_on) body.due_on = args.due_on;

  const todo = await basecampFetch(
    ctx.TOKEN,
    `/buckets/${project.id}/todolists/${target.id}/todos.json`,
    { method: "POST", body, ua: ctx.ua }
  );

  return {
    message: "Task created",
    project: { id: project.id, name: project.name },
    todolist: { id: target.id, name: target.name },
    todo
  };
}

async function t_update_task_naturally(args, ctx) {
  const project = await projectByName(ctx.TOKEN, ctx.accountId, args.project, ctx.ua);
  const groups = await listTodosForProject(ctx.TOKEN, project.id, ctx.ua);
  const all = groups.flatMap(g => (g.todos || []).map(t => ({ id: t.id, name: todoText(t), raw: t })));

  const match = resolveBestEffort(all, args.task) || resolveByName(all, args.task, "todo");

  const patch = {};
  if (args.new_task) patch.content = args.new_task;
  if (args.due_on) patch.due_on = args.due_on;

  const updated = await basecampFetch(
    ctx.TOKEN,
    `/buckets/${project.id}/todos/${match.id}.json`,
    { method: "PUT", body: patch, ua: ctx.ua }
  );

  return { message: "Task updated", project: { id: project.id, name: project.name }, todo: updated };
}

async function t_complete_task_by_name(args, ctx) {
  const project = await projectByName(ctx.TOKEN, ctx.accountId, args.project, ctx.ua);
  const groups = await listTodosForProject(ctx.TOKEN, project.id, ctx.ua);
  const all = groups.flatMap(g => (g.todos || []).map(t => ({ id: t.id, name: todoText(t) })));

  const match = resolveBestEffort(all, args.task) || resolveByName(all, args.task, "todo");

  await basecampFetch(ctx.TOKEN, `/buckets/${project.id}/todos/${match.id}/completion.json`, {
    method: "POST",
    ua: ctx.ua
  });

  return { message: "Task completed", project: { id: project.id, name: project.name }, todoId: match.id, task: match.name };
}

async function t_daily_report(args, ctx) {
  const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
  const rows = await listAllOpenTodos(ctx.TOKEN, ctx.accountId, ctx.ua);

  const dueToday = rows.filter(r => r.due_on === date);
  const overdue = rows.filter(r => r.due_on && r.due_on < date);

  const perProject = {};
  for (const r of rows) {
    perProject[r.project] ||= { project: r.project, projectId: r.projectId, openTodos: 0, dueToday: 0, overdue: 0 };
    perProject[r.project].openTodos += 1;
    if (r.due_on === date) perProject[r.project].dueToday += 1;
    if (r.due_on && r.due_on < date) perProject[r.project].overdue += 1;
  }

  const perProjectArr = Object.values(perProject).sort(
    (a, b) =>
      (b.overdue - a.overdue) ||
      (b.dueToday - a.dueToday) ||
      (a.project || "").localeCompare(b.project || "")
  );

  return {
    date,
    totals: {
      projects: new Set(rows.map(r => r.projectId)).size,
      openTodos: rows.length,
      dueToday: dueToday.length,
      overdue: overdue.length
    },
    perProject: perProjectArr,
    dueToday,
    overdue
  };
}

async function t_list_todos_due(args, ctx) {
  const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
  const includeOverdue = !!args.include_overdue;

  const rows = await listAllOpenTodos(ctx.TOKEN, ctx.accountId, ctx.ua);
  const todos = rows
    .filter(r => r.due_on === date || (includeOverdue && r.due_on && r.due_on < date))
    .map(r => ({ ...r, overdue: r.due_on && r.due_on < date }));

  todos.sort(
    (a, b) =>
      (a.overdue === b.overdue ? 0 : (a.overdue ? -1 : 1)) ||
      (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") ||
      (a.project || "").localeCompare(b.project || "")
  );

  return { date, count: todos.length, todos };
}

async function t_summarize_overdue_tasks(_args, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await listAllOpenTodos(ctx.TOKEN, ctx.accountId, ctx.ua);
  const overdue = rows.filter(r => r.due_on && r.due_on < today);

  overdue.sort(
    (a, b) =>
      (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") ||
      (a.project || "").localeCompare(b.project || "")
  );

  return { today, count: overdue.length, overdue };
}

async function t_search_todos(args, ctx) {
  const q = String(args.query || "").toLowerCase().trim();
  const rows = await listAllOpenTodos(ctx.TOKEN, ctx.accountId, ctx.ua);
  const hits = rows.filter(r => r.content.toLowerCase().includes(q));

  hits.sort(
    (a, b) =>
      (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") ||
      (a.project || "").localeCompare(b.project || "")
  );

  return { query: args.query, count: hits.length, todos: hits };
}

async function t_assignment_report(args, ctx) {
  const project = await projectByName(ctx.TOKEN, ctx.accountId, args.project, ctx.ua);

  const cacheKey = `assign:${ctx.accountId}:${project.id}:${args.max_todos || 200}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { cached: true, ...cached };

  const maxTodos = Math.max(25, Math.min(1000, Number(args.max_todos || 200)));
  const includeUnassigned = args.include_unassigned !== false;

  // Best-effort people map
  let people = [];
  try {
    people = await basecampFetch(ctx.TOKEN, `/buckets/${project.id}/people.json`, { ua: ctx.ua });
  } catch {
    people = [];
  }
  const peopleById = new Map((people || []).map(p => [String(p.id), p.name || p.email_address || String(p.id)]));

  const lists = await listTodoLists(ctx.TOKEN, project.id, ctx.ua);

  let scanned = 0;
  const perList = await mapLimit(lists, 4, async (l) => {
    if (scanned >= maxTodos) return { list: l, todos: [] };

    const todos = await listTodosForList(ctx.TOKEN, project.id, l, ctx.ua);
    const open = (todos || []).filter(t => !t.completed && !t.completed_at);

    const budget = Math.max(0, maxTodos - scanned);
    const slice = open.slice(0, budget);
    scanned += slice.length;

    return { list: l, todos: slice };
  });

  const assignments = new Map();
  const unassigned = [];

  for (const item of perList) {
    const listName = item.list?.name || item.list?.title || "Todo list";
    for (const t of (item.todos || [])) {
      const task = todoText(t);
      const due = isoDate(t.due_on || t.due_at);
      const names = todoAssigneeNames(t, peopleById);

      if (names.length) {
        for (const n of names) {
          if (!assignments.has(n)) assignments.set(n, []);
          assignments.get(n).push({ task, due_on: due, todolist: listName });
        }
      } else if (includeUnassigned) {
        unassigned.push({ task, due_on: due, todolist: listName });
      }
    }
  }

  const out = {};
  for (const [name, arr] of assignments.entries()) {
    arr.sort(
      (a, b) =>
        (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") ||
        a.task.localeCompare(b.task)
    );
    out[name] = arr;
  }

  const payload = {
    project: { id: project.id, name: project.name },
    scanned_todos: scanned,
    assignees: Object.keys(out).length,
    assignments: out,
    unassigned: includeUnassigned ? unassigned : undefined,
    note: scanned >= maxTodos ? `Scanned first ${maxTodos} open todos to avoid timeouts. Increase max_todos if needed.` : undefined
  };

  return cacheSet(cacheKey, payload);
}

/**
 * Raw call tool — full coverage
 * IMPORTANT: Basecamp wants .json for most resources.
 * We also provide basecamp_raw alias to match your Actions call.
 */
async function t_basecamp_request(args, ctx) {
  let p = String(args.path || "").trim();
  if (!p) throw Object.assign(new Error("Missing path"), { code: "BAD_REQUEST" });

  // convenience: "/projects" -> "/projects.json"
  if (p === "/projects") p = "/projects.json";

  const method = String(args.method || "GET").toUpperCase();
  const data = await basecampFetch(ctx.TOKEN, p, { method, body: args.body, ua: ctx.ua, accountId: ctx.accountId });
  return { ok: true, request: { method, path: p }, data };
}

/* =========================
   MCP entry point
========================= */
export async function handleMCP(reqBody, ctx) {
  const { id, method, params } = reqBody || {};
  const { TOKEN, accountId, ua, startStatus, authAccounts } = ctx;

  const safeCtx = { TOKEN, accountId, ua, startStatus, authAccounts };

  try {
    if (method === "initialize") {
      return ok(id, { name: "bcgpt", version: "3.1", sessionId: crypto.randomUUID() });
    }

    if (method === "tools/list") {
      return ok(id, {
        tools: [
          tool("startbcgpt", "Show connection status + re-auth and logout links.", noProps()),
          tool("whoami", "Return current Basecamp account id and available accounts.", noProps()),

          tool("list_accounts", "List Basecamp accounts available to the authenticated user.", noProps()),
          tool("list_projects", "List projects (optionally include archived).", {
            type: "object",
            properties: { archived: { type: "boolean" } },
            additionalProperties: false
          }),
          tool("get_project_by_name", "Resolve a project by name (fuzzy).", {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false
          }),
          tool("get_project_dock", "Get a project's dock tools.", {
            type: "object",
            properties: { project_id: { type: "integer" } },
            required: ["project_id"],
            additionalProperties: false
          }),

          tool("daily_report", "Across all projects: due today + overdue + per-project counts.", {
            type: "object",
            properties: { date: { type: "string", description: "YYYY-MM-DD (default today)" } },
            additionalProperties: false
          }),
          tool("list_todos_due", "Across all projects: open todos due on date; optionally include overdue.", {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD (default today)" },
              include_overdue: { type: "boolean" }
            },
            additionalProperties: false
          }),
          tool("summarize_overdue_tasks", "Across all projects: overdue open todos.", noProps()),
          tool("search_todos", "Across all projects: search open todos by keyword.", {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false
          }),

          tool("assignment_report", "For a project: group open todos by assignee.", {
            type: "object",
            properties: {
              project: { type: "string" },
              max_todos: { type: "integer", description: "Default 200" },
              include_unassigned: { type: "boolean", description: "Default true" }
            },
            required: ["project"],
            additionalProperties: false
          }),

          tool("list_todos_for_project", "List todolists + todos for a project by name.", {
            type: "object",
            properties: { project: { type: "string" } },
            required: ["project"],
            additionalProperties: false
          }),
          tool("create_task_naturally", "Create a todo in a project.", {
            type: "object",
            properties: {
              project: { type: "string" },
              todolist: { type: "string" },
              task: { type: "string" },
              description: { type: "string" },
              due_on: { type: "string", description: "YYYY-MM-DD" }
            },
            required: ["project", "task"],
            additionalProperties: false
          }),
          tool("update_task_naturally", "Update a todo in a project by fuzzy-matching task name.", {
            type: "object",
            properties: {
              project: { type: "string" },
              task: { type: "string" },
              new_task: { type: "string" },
              due_on: { type: "string", description: "YYYY-MM-DD" }
            },
            required: ["project", "task"],
            additionalProperties: false
          }),
          tool("complete_task_by_name", "Complete a todo in a project by fuzzy-matching task name.", {
            type: "object",
            properties: { project: { type: "string" }, task: { type: "string" } },
            required: ["project", "task"],
            additionalProperties: false
          }),

          tool("basecamp_request", "Raw Basecamp API call (full coverage).", {
            type: "object",
            properties: { path: { type: "string" }, method: { type: "string" }, body: { type: "object" } },
            required: ["path"],
            additionalProperties: false
          }),
          // ✅ alias so your Actions call "basecamp_raw" works
          tool("basecamp_raw", "Alias of basecamp_request.", {
            type: "object",
            properties: { path: { type: "string" }, method: { type: "string" }, body: { type: "object" } },
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

    // startbcgpt must always work
    if (name === "startbcgpt") return ok(id, await t_startbcgpt(safeCtx));
    if (name === "whoami") return ok(id, await t_whoami(safeCtx));

    // auth guard
    if (!TOKEN?.access_token) {
      return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
    }
    if (!accountId) {
      return fail(id, { code: "NO_ACCOUNT", message: "Connected, but no Basecamp accountId resolved." });
    }

    // tool dispatch
    const tools = {
      list_accounts: () => t_list_accounts(safeCtx),
      list_projects: () => t_list_projects(args, safeCtx),
      get_project_by_name: () => t_get_project_by_name(args, safeCtx),
      get_project_dock: () => t_get_project_dock(args, safeCtx),

      list_todos_for_project: () => t_list_todos_for_project(args, safeCtx),
      create_task_naturally: () => t_create_task_naturally(args, safeCtx),
      update_task_naturally: () => t_update_task_naturally(args, safeCtx),
      complete_task_by_name: () => t_complete_task_by_name(args, safeCtx),

      daily_report: () => t_daily_report(args, safeCtx),
      list_todos_due: () => t_list_todos_due(args, safeCtx),
      summarize_overdue_tasks: () => t_summarize_overdue_tasks(args, safeCtx),
      search_todos: () => t_search_todos(args, safeCtx),
      assignment_report: () => t_assignment_report(args, safeCtx),

      basecamp_request: () => t_basecamp_request(args, safeCtx),
      basecamp_raw: () => t_basecamp_request(args, safeCtx) // alias
    };

    const fn = tools[name];
    if (!fn) return fail(id, { code: "UNKNOWN_TOOL", message: "Unknown tool name" });

    const result = await fn();
    return ok(id, result);
  } catch (e) {
    // keep your resolver errors
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
      return fail(id, {
        code: "BASECAMP_API_ERROR",
        message: `Basecamp API error (${e.status})`,
        url: e.url || null,
        data: e.data || null
      });
    }
    return fail(id, { code: "INTERNAL_ERROR", message: e?.message || "Unknown error" });
  }
}
