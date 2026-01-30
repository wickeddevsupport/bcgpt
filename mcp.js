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
   In-memory caches & state
   (single-user is OK)
========================= */
const CACHE = new Map(); // key -> { ts, value }
const CACHE_TTL_MS = 60 * 1000;

function cacheGet(key, ttl = CACHE_TTL_MS) {
  const v = CACHE.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > ttl) { CACHE.delete(key); return null; }
  return v.value;
}
function cacheSet(key, value) {
  CACHE.set(key, { ts: Date.now(), value });
  return value;
}

// Search checkpoints so "continue" resumes
const SEARCH_STATE = new Map(); // key -> { projectIndex, results, scanned, ts }
const SEARCH_TTL_MS = 10 * 60 * 1000;

function searchStateGet(key) {
  const s = SEARCH_STATE.get(key);
  if (!s) return null;
  if (Date.now() - s.ts > SEARCH_TTL_MS) { SEARCH_STATE.delete(key); return null; }
  return s;
}
function searchStateSet(key, state) {
  state.ts = Date.now();
  SEARCH_STATE.set(key, state);
  return state;
}

/* =========================
   Simple concurrency limiter
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
   Basecamp helper utilities
========================= */
function todoText(t) {
  return (t?.content || t?.title || t?.name || "").trim();
}

function todoAssigneeNames(todo, peopleById) {
  if (Array.isArray(todo.assignees) && todo.assignees.length) {
    return todo.assignees.map(a => a?.name).filter(Boolean);
  }
  const ids = Array.isArray(todo.assignee_ids) ? todo.assignee_ids : [];
  return (ids || []).map(id => peopleById.get(String(id)) || String(id));
}

function findDockToolUrl(dock, names) {
  const want = Array.isArray(names) ? names : [names];
  const enabled = (dock || []).filter(d => d && d.enabled);
  for (const n of want) {
    const hit = enabled.find(d => d.name === n);
    if (hit?.url) return hit.url;
  }
  return null;
}

/* =========================
   Basecamp API wrappers
   IMPORTANT: always pass {accountId}
========================= */
async function listProjects(TOKEN, accountId, ua, { archived = false } = {}) {
  const qs = archived ? "?status=archived" : "";
  return await basecampFetch(TOKEN, `/${accountId}/projects.json${qs}`, { ua, accountId });
}

async function getProject(TOKEN, accountId, projectId, ua) {
  // projectId is bucket id in Basecamp 3
  return await basecampFetch(TOKEN, `/${accountId}/projects/${projectId}.json`, { ua, accountId });
}

async function projectByName(TOKEN, accountId, name, ua, opts = {}) {
  const projects = await listProjects(TOKEN, accountId, ua, opts);
  return resolveByName(projects, name, "project");
}

// Dock-aware todoset discovery
async function getTodosetUrl(TOKEN, accountId, projectId, ua) {
  const cacheKey = `dock:${accountId}:${projectId}`;
  const cached = cacheGet(cacheKey, 30 * 60 * 1000); // 30 min
  if (cached) return cached;

  const project = await getProject(TOKEN, accountId, projectId, ua);
  const dock = project?.dock || [];
  const url = findDockToolUrl(dock, ["todoset", "todos"]) || null;
  cacheSet(cacheKey, url);
  return url;
}

async function listTodoLists(TOKEN, accountId, projectId, ua) {
  const todosetUrl = await getTodosetUrl(TOKEN, accountId, projectId, ua);
  if (!todosetUrl) return []; // To-dos not enabled

  const todoset = await basecampFetch(TOKEN, todosetUrl, { ua, accountId });

  const listUrl =
    todoset?.todolists_url ||
    todoset?.lists_url ||
    todoset?.todolists?.url ||
    null;

  if (!listUrl) return [];
  return await basecampFetch(TOKEN, listUrl, { ua, accountId });
}

async function listTodosForList(TOKEN, accountId, projectId, list, ua) {
  if (list?.todos_url) {
    return await basecampFetch(TOKEN, list.todos_url, { ua, accountId });
  }
  return await basecampFetch(
    TOKEN,
    `/buckets/${projectId}/todolists/${list.id}/todos.json`,
    { ua, accountId }
  );
}

async function listTodosForProject(TOKEN, accountId, projectId, ua) {
  const lists = await listTodoLists(TOKEN, accountId, projectId, ua);
  if (!lists.length) return [];

  // Low concurrency to avoid 429
  const groups = await mapLimit(lists, 2, async (l) => {
    let todos = [];
    try {
      todos = await listTodosForList(TOKEN, accountId, projectId, l, ua);
    } catch {
      todos = [];
    }
    return { todolistId: l.id, todolist: l.name, todos };
  });

  return groups;
}

// Global scan with cache + safe concurrency
async function listAllTodos(
  TOKEN,
  accountId,
  ua,
  {
    includeCompleted = false,
    includeArchivedProjects = false,
    maxProjects = 40,   // safety default to avoid huge scans
    maxTodos = 800      // safety default
  } = {}
) {
  const cacheKey = `alltodos:${accountId}:${includeCompleted ? 1 : 0}:${includeArchivedProjects ? 1 : 0}:${maxProjects}:${maxTodos}`;
  const cached = cacheGet(cacheKey, 60 * 1000);
  if (cached) return cached;

  const projects = await listProjects(TOKEN, accountId, ua, { archived: !!includeArchivedProjects });
  const slice = projects.slice(0, Math.max(1, Math.min(projects.length, maxProjects)));

  let todosSeen = 0;

  const perProject = await mapLimit(slice, 1, async (p) => {
    if (todosSeen >= maxTodos) return [];
    const groups = await listTodosForProject(TOKEN, accountId, p.id, ua);
    if (!groups.length) return [];

    const rows = [];
    for (const g of groups) {
      for (const t of (g.todos || [])) {
        const completed = !!(t.completed || t.completed_at);
        if (!includeCompleted && completed) continue;

        rows.push({
          project: p.name,
          projectId: p.id,
          todolist: g.todolist,
          todolistId: g.todolistId,
          todoId: t.id,
          content: todoText(t),
          due_on: isoDate(t.due_on || t.due_at),
          completed,
          completed_at: t.completed_at || null,
          raw: t
        });

        todosSeen++;
        if (todosSeen >= maxTodos) break;
      }
      if (todosSeen >= maxTodos) break;
    }
    return rows;
  });

  return cacheSet(cacheKey, perProject.flat());
}

/* =========================
   Direct todo fetch by URL
========================= */
function parseTodoFromUrl(url) {
  const s = String(url || "");
  const m = s.match(/\/buckets\/(\d+)\/todos\/(\d+)/);
  if (!m) return null;
  return { bucket_id: Number(m[1]), todo_id: Number(m[2]) };
}

async function getTodoDirect(TOKEN, accountId, ua, args) {
  let bucketId = args.bucket_id ? Number(args.bucket_id) : null;
  let todoId = args.todo_id ? Number(args.todo_id) : null;

  if (args.url) {
    const parsed = parseTodoFromUrl(args.url);
    if (!parsed) {
      return { ok: false, code: "BAD_URL", error: "Could not parse bucket/todo from URL." };
    }
    bucketId = parsed.bucket_id;
    todoId = parsed.todo_id;
  }

  if (!bucketId || !todoId) {
    return { ok: false, code: "MISSING_PARAMS", error: "Provide url OR (bucket_id and todo_id)." };
  }

  const todo = await basecampFetch(
    TOKEN,
    `/buckets/${bucketId}/todos/${todoId}.json`,
    { ua, accountId }
  );

  return { ok: true, bucket_id: bucketId, todo_id: todoId, todo };
}

/* =========================
   Chunked search (checkpointed)
========================= */
async function searchTodosChunked(args, ctx) {
  const q = String(args.query || "").toLowerCase().trim();
  if (!q) return { ok: false, code: "BAD_REQUEST", error: "Missing query" };

  const batchSize = Math.max(3, Math.min(25, Number(args.batch_size || 10)));
  const cont = !!args.continue;

  const key = `q:${q}`;
  let state = searchStateGet(key);

  if (!cont || !state) {
    state = {
      projectIndex: 0,
      results: [],
      scanned: { projects: 0, lists: 0, todos: 0 }
    };
  }

  const projects = await listProjects(ctx.TOKEN, ctx.accountId, ctx.ua, { archived: false });
  const start = state.projectIndex;
  const end = Math.min(projects.length, start + batchSize);
  const batch = projects.slice(start, end);

  for (const p of batch) {
    const groups = await listTodosForProject(ctx.TOKEN, ctx.accountId, p.id, ctx.ua);
    state.scanned.projects += 1;

    for (const g of groups) {
      state.scanned.lists += 1;
      for (const t of (g.todos || [])) {
        state.scanned.todos += 1;

        const text = todoText(t).toLowerCase();
        const desc = String(t?.description || "").toLowerCase();

        if (text.includes(q) || desc.includes(q)) {
          state.results.push({
            project: p.name,
            projectId: p.id,
            todolist: g.todolist,
            todoId: t.id,
            content: todoText(t),
            due_on: isoDate(t.due_on || t.due_at),
            url: `https://3.basecamp.com/${ctx.accountId}/buckets/${p.id}/todos/${t.id}`
          });
        }
      }
    }
  }

  state.projectIndex = end;
  searchStateSet(key, state);

  const done = end >= projects.length;

  return {
    ok: true,
    query: args.query,
    batch: { start, end, batch_size: batchSize },
    progress: { scanned: state.scanned, totalProjects: projects.length },
    total_matches: state.results.length,
    results: state.results.slice(0, 50),
    done,
    next_hint: done
      ? "Done scanning all active projects."
      : `Say "continue" to scan the next ${batchSize} projects.`
  };
}

/* =========================
   MCP handler
========================= */
export async function handleMCP(reqBody, ctx) {
  const { id, method, params } = reqBody || {};
  const { TOKEN, accountId, ua, startStatus, authAccounts } = ctx;

  try {
    if (method === "initialize") {
      return ok(id, { name: "bcgpt", version: "4.0", sessionId: crypto.randomUUID() });
    }

    if (method === "tools/list") {
      return ok(id, {
        tools: [
          tool("startbcgpt", "Show connection status + re-auth link.", noProps()),
          tool("whoami", "Return account id and available accounts.", noProps()),

          tool("list_projects", "List projects (optionally include archived).", {
            type: "object",
            properties: {
              archived: { type: "boolean", description: "Include archived projects (default false)" }
            },
            additionalProperties: false
          }),

          tool("get_todo", "Fetch a to-do directly by Basecamp URL or by bucket_id + todo_id.", {
            type: "object",
            properties: {
              url: { type: "string" },
              bucket_id: { type: "integer" },
              todo_id: { type: "integer" }
            },
            additionalProperties: false
          }),

          tool("search_todos_chunked", "Search todos across projects in batches to avoid rate limits. Use continue=true to resume.", {
            type: "object",
            properties: {
              query: { type: "string" },
              batch_size: { type: "integer", description: "Projects per batch (default 10, max 25)" },
              continue: { type: "boolean", description: "Resume the previous scan for this query" }
            },
            required: ["query"],
            additionalProperties: false
          }),

          tool("search_todos", "Quick search with safe scan limits (caps projects/todos).", {
            type: "object",
            properties: {
              query: { type: "string" },
              include_completed: { type: "boolean" },
              include_archived_projects: { type: "boolean" }
            },
            required: ["query"],
            additionalProperties: false
          }),

          tool("daily_report", "Due today + overdue counts across a safe scan set.", {
            type: "object",
            properties: { date: { type: "string" } },
            additionalProperties: false
          }),

          tool("list_todos_due", "List todos due on date; include_overdue pulls overdue too.", {
            type: "object",
            properties: {
              date: { type: "string" },
              include_overdue: { type: "boolean" }
            },
            additionalProperties: false
          }),

          tool("list_todos_for_project", "List todolists + todos for a project (by name).", {
            type: "object",
            properties: { project: { type: "string" } },
            required: ["project"],
            additionalProperties: false
          }),

          tool("create_task_naturally", "Create a todo in a project; optional todolist and due date.", {
            type: "object",
            properties: {
              project: { type: "string" },
              todolist: { type: "string" },
              task: { type: "string" },
              description: { type: "string" },
              due_on: { type: "string" }
            },
            required: ["project", "task"],
            additionalProperties: false
          }),

          tool("update_task_naturally", "Update a todo in a project by fuzzy task name.", {
            type: "object",
            properties: {
              project: { type: "string" },
              task: { type: "string" },
              new_task: { type: "string" },
              due_on: { type: "string" }
            },
            required: ["project", "task"],
            additionalProperties: false
          }),

          tool("complete_task_by_name", "Complete a todo in a project by fuzzy task name.", {
            type: "object",
            properties: { project: { type: "string" }, task: { type: "string" } },
            required: ["project", "task"],
            additionalProperties: false
          }),

          tool("basecamp_request", "Raw Basecamp API call. Provide /path or full https URL.", {
            type: "object",
            properties: {
              path: { type: "string" },
              method: { type: "string" },
              body: { type: "object" }
            },
            required: ["path"],
            additionalProperties: false
          }),
          tool("basecamp_raw", "Alias of basecamp_request.", {
            type: "object",
            properties: {
              path: { type: "string" },
              method: { type: "string" },
              body: { type: "object" }
            },
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

    // Must work without auth
    if (name === "startbcgpt") return ok(id, await startStatus());
    if (name === "whoami") {
      return ok(id, { connected: !!TOKEN?.access_token, accountId: accountId || null, accounts: authAccounts || [] });
    }

    // Everything else requires auth
    if (!TOKEN?.access_token) {
      return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
    }
    if (!accountId) {
      return fail(id, { code: "NO_ACCOUNT_ID", message: "Connected but accountId missing. Check BASECAMP_DEFAULT_ACCOUNT_ID." });
    }

    // Route
    if (name === "list_projects") {
      const projects = await listProjects(TOKEN, accountId, ua, { archived: !!args.archived });
      return ok(id, projects);
    }

    if (name === "get_todo") {
      return ok(id, await getTodoDirect(TOKEN, accountId, ua, args));
    }

    if (name === "search_todos_chunked") {
      return ok(id, await searchTodosChunked(args, { TOKEN, accountId, ua }));
    }

    if (name === "search_todos") {
      const q = String(args.query || "").toLowerCase().trim();
      const rows = await listAllTodos(TOKEN, accountId, ua, {
        includeCompleted: !!args.include_completed,
        includeArchivedProjects: !!args.include_archived_projects,
        maxProjects: 25,
        maxTodos: 500
      });
      const hits = rows.filter(r => (r.content || "").toLowerCase().includes(q));
      hits.sort((a, b) => (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") || (a.project || "").localeCompare(b.project || ""));
      return ok(id, { query: args.query, count: hits.length, todos: hits.slice(0, 50), note: "Safe scan limits applied. Use search_todos_chunked for deeper scanning." });
    }

    if (name === "list_todos_for_project") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, accountId, project.id, ua);
      return ok(id, { project: { id: project.id, name: project.name }, groups });
    }

    if (name === "create_task_naturally") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const lists = await listTodoLists(TOKEN, accountId, project.id, ua);
      if (!lists.length) return fail(id, { code: "NO_TODOLISTS", message: "No todolists found (To-dos might not be enabled for this project)." });

      let target = lists[0];
      if (args.todolist) {
        const m = resolveByName(lists.map(l => ({ id: l.id, name: l.name })), args.todolist, "todolist");
        target = lists.find(l => l.id === m.id) || lists[0];
      }

      const body = { content: args.task };
      if (args.description) body.description = args.description;
      if (args.due_on) body.due_on = args.due_on;

      const todo = await basecampFetch(
        TOKEN,
        `/buckets/${project.id}/todolists/${target.id}/todos.json`,
        { method: "POST", body, ua, accountId }
      );

      return ok(id, { message: "Task created", project: { id: project.id, name: project.name }, todolist: { id: target.id, name: target.name }, todo });
    }

    if (name === "update_task_naturally") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, accountId, project.id, ua);
      const all = groups.flatMap(g => (g.todos || []).map(t => ({ id: t.id, name: todoText(t), raw: t })));

      const match = resolveBestEffort(all, args.task) || resolveByName(all, args.task, "todo");

      const patch = {};
      if (args.new_task) patch.content = args.new_task;
      if (args.due_on) patch.due_on = args.due_on;

      const updated = await basecampFetch(
        TOKEN,
        `/buckets/${project.id}/todos/${match.id}.json`,
        { method: "PUT", body: patch, ua, accountId }
      );

      return ok(id, { message: "Task updated", project: { id: project.id, name: project.name }, todo: updated });
    }

    if (name === "complete_task_by_name") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, accountId, project.id, ua);
      const all = groups.flatMap(g => (g.todos || []).map(t => ({ id: t.id, name: todoText(t) })));

      const match = resolveBestEffort(all, args.task) || resolveByName(all, args.task, "todo");

      await basecampFetch(
        TOKEN,
        `/buckets/${project.id}/todos/${match.id}/completion.json`,
        { method: "POST", ua, accountId }
      );

      return ok(id, { message: "Task completed", project: { id: project.id, name: project.name }, todoId: match.id, task: match.name });
    }

    if (name === "daily_report") {
      const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
      const rows = await listAllTodos(TOKEN, accountId, ua, { includeCompleted: false, includeArchivedProjects: false, maxProjects: 30, maxTodos: 800 });

      const dueToday = rows.filter(r => r.due_on === date);
      const overdue = rows.filter(r => r.due_on && r.due_on < date);

      const perProject = {};
      for (const r of rows) {
        perProject[r.project] ||= { project: r.project, projectId: r.projectId, openTodos: 0, dueToday: 0, overdue: 0 };
        perProject[r.project].openTodos += 1;
        if (r.due_on === date) perProject[r.project].dueToday += 1;
        if (r.due_on && r.due_on < date) perProject[r.project].overdue += 1;
      }

      const perProjectArr = Object.values(perProject).sort((a, b) => (b.overdue - a.overdue) || (b.dueToday - a.dueToday) || (a.project || "").localeCompare(b.project || ""));

      return ok(id, {
        date,
        totals: {
          projectsWithTodos: perProjectArr.length,
          openTodos: rows.length,
          dueToday: dueToday.length,
          overdue: overdue.length
        },
        perProject: perProjectArr,
        dueToday: dueToday.slice(0, 50),
        overdue: overdue.slice(0, 50),
        note: "Report uses safe scan limits. Use search_todos_chunked for deeper scanning."
      });
    }

    if (name === "list_todos_due") {
      const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
      const includeOverdue = !!args.include_overdue;

      const rows = await listAllTodos(TOKEN, accountId, ua, { includeCompleted: false, includeArchivedProjects: false, maxProjects: 30, maxTodos: 900 });

      const todos = rows
        .filter(r => r.due_on === date || (includeOverdue && r.due_on && r.due_on < date))
        .map(r => ({ ...r, overdue: r.due_on && r.due_on < date }));

      todos.sort((a, b) =>
        (a.overdue === b.overdue ? 0 : (a.overdue ? -1 : 1)) ||
        (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") ||
        (a.project || "").localeCompare(b.project || "") ||
        (a.content || "").localeCompare(b.content || "")
      );

      return ok(id, { date, count: todos.length, todos: todos.slice(0, 100), note: "Safe scan limits applied." });
    }

    if (name === "basecamp_request" || name === "basecamp_raw") {
      let p = String(args.path || "").trim();
      if (!p) return fail(id, { code: "BAD_REQUEST", message: "Missing path" });

      // Normalize common mistakes
      if (p === "/projects") p = "/projects.json";

      const data = await basecampFetch(TOKEN, p, {
        method: (args.method || "GET").toUpperCase(),
        body: args.body,
        ua,
        accountId
      });

      return ok(id, { ok: true, request: { path: p, method: (args.method || "GET").toUpperCase() }, data });
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
      return fail(id, { code: "BASECAMP_API_ERROR", message: `Basecamp API error (${e.status})`, url: e.url || null, data: e.data || null });
    }
    return fail(id, { code: "INTERNAL_ERROR", message: e?.message || "Unknown error" });
  }
}
