import crypto from "crypto";
import { basecampFetch, basecampFetchAll } from "./basecamp.js";
import { resolveByName, resolveBestEffort } from "./resolvers.js";

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

function todoText(t) {
  return (t?.content || t?.title || t?.name || "").trim();
}

function dockFind(dock, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) {
    const hit = (dock || []).find((d) => String(d?.name || "").toLowerCase() === String(n).toLowerCase() && d.enabled);
    if (hit) return hit;
  }
  return null;
}

async function listProjects(TOKEN, accountId, ua, { archived = false } = {}) {
  const qs = archived ? "?status=archived" : "";
  return await basecampFetchAll(TOKEN, `/projects.json${qs}`, { ua, accountId });
}

async function getProject(TOKEN, accountId, projectId, ua) {
  return await basecampFetch(TOKEN, `/projects/${projectId}.json`, { ua, accountId });
}

async function getDock(TOKEN, accountId, projectId, ua) {
  const p = await getProject(TOKEN, accountId, projectId, ua);
  return p?.dock || [];
}

async function projectByName(TOKEN, accountId, name, ua, opts = {}) {
  const projects = await listProjects(TOKEN, accountId, ua, opts);
  return resolveByName(projects, name, "project");
}

async function listTodoLists(TOKEN, accountId, projectId, ua) {
  return await basecampFetchAll(TOKEN, `/buckets/${projectId}/todolists.json`, { ua, accountId });
}

async function listTodosForList(TOKEN, accountId, projectId, todolist, ua) {
  // Prefer URL from API object if present (more future-proof)
  if (todolist?.todos_url) {
    return await basecampFetchAll(TOKEN, todolist.todos_url, { ua, accountId });
  }
  return await basecampFetchAll(TOKEN, `/buckets/${projectId}/todolists/${todolist.id}/todos.json`, { ua, accountId });
}

async function listTodosForProject(TOKEN, accountId, projectId, ua) {
  const lists = await listTodoLists(TOKEN, accountId, projectId, ua);
  const groups = [];
  for (const l of lists) {
    const todos = await listTodosForList(TOKEN, accountId, projectId, l, ua);
    groups.push({ todolistId: l.id, todolist: l.name, todos });
  }
  return groups;
}

// ---- Chunked scan utilities (prevents instant 429) ----

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

/**
 * Scan open todos across projects in chunks.
 * Returns: { rows, cursor, done }
 */
async function scanOpenTodosChunked(TOKEN, accountId, ua, {
  cursor = 0,
  project_chunk = 3,
  max_todos_per_project = 300
} = {}) {
  const projects = await listProjects(TOKEN, accountId, ua);
  const start = Math.max(0, Number(cursor || 0));
  const end = Math.min(projects.length, start + Math.max(1, Number(project_chunk || 3)));

  const rows = [];

  for (let i = start; i < end; i++) {
    const p = projects[i];

    const lists = await listTodoLists(TOKEN, accountId, p.id, ua);

    let collected = 0;
    for (const l of lists) {
      if (collected >= max_todos_per_project) break;

      const todos = await listTodosForList(TOKEN, accountId, p.id, l, ua);
      for (const t of (todos || [])) {
        const completed = !!(t.completed || t.completed_at);
        if (completed) continue;

        rows.push({
          project: p.name,
          projectId: p.id,
          todolist: l.name,
          todolistId: l.id,
          todoId: t.id,
          content: todoText(t),
          due_on: isoDate(t.due_on || t.due_at),
        });

        collected += 1;
        if (collected >= max_todos_per_project) break;
      }
    }
  }

  const nextCursor = end;
  return { rows, cursor: nextCursor, done: nextCursor >= projects.length, projects_total: projects.length };
}

/**
 * MCP handler: initialize, tools/list, tools/call
 */
export async function handleMCP(reqBody, ctx) {
  const { id, method, params } = reqBody || {};
  const { TOKEN, accountId, ua, startStatus, authAccounts } = ctx;

  try {
    if (method === "initialize") {
      return ok(id, { name: "bcgpt", version: "3.0", sessionId: crypto.randomUUID() });
    }

    if (method === "tools/list") {
      return ok(id, {
        tools: [
          tool("startbcgpt", "Show connection status, current user (name/email), plus re-auth and logout links.", noProps()),
          tool("whoami", "Return the authenticated user's basic info and available accounts.", noProps()),

          tool("list_accounts", "List Basecamp accounts available to the authenticated user.", noProps()),
          tool("list_projects", "List ALL projects in the current account (handles pagination).", {
            type: "object",
            properties: { archived: { type: "boolean", description: "Include archived projects (default false)" } },
            additionalProperties: false
          }),

          tool("daily_report", "Chunked scan across projects: due today + overdue + per-project totals. Returns partial results with next_cursor if needed.", {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD (default: today)" },
              cursor: { type: "integer", description: "Resume cursor for chunked scanning (default 0)" },
              project_chunk: { type: "integer", description: "How many projects to scan per call (default 3)" }
            },
            additionalProperties: false
          }),

          tool("list_todos_due", "Chunked scan across projects: list open todos due on date; optionally include overdue. Returns partial results with next_cursor if needed.", {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD (default: today)" },
              include_overdue: { type: "boolean", description: "Include overdue items too (default false)" },
              cursor: { type: "integer", description: "Resume cursor for chunked scanning (default 0)" },
              project_chunk: { type: "integer", description: "How many projects to scan per call (default 3)" }
            },
            additionalProperties: false
          }),

          tool("search_todos", "Chunked scan across projects: search open todos by keyword. Returns partial results with next_cursor if needed.", {
            type: "object",
            properties: {
              query: { type: "string" },
              cursor: { type: "integer", description: "Resume cursor for chunked scanning (default 0)" },
              project_chunk: { type: "integer", description: "How many projects to scan per call (default 3)" }
            },
            required: ["query"],
            additionalProperties: false
          }),

          tool("list_todos_for_project", "List todolists + todos for a project by name (paginated).", {
            type: "object",
            properties: { project: { type: "string" } },
            required: ["project"],
            additionalProperties: false
          }),

          tool("create_task_naturally", "Create a todo in a project; optionally specify todolist and due date.", {
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

          tool("update_task_naturally", "Update a todo in a project by fuzzy-matching existing task name.", {
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

          tool("basecamp_request", "Raw Basecamp API call (full coverage). Provide full https URL or a /path.", {
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

    // Entry point
    if (name === "startbcgpt") {
      return ok(id, await startStatus());
    }

    if (name === "whoami") {
      if (!TOKEN?.access_token) return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt." });
      return ok(id, {
        accountId,
        accounts: authAccounts || [],
      });
    }

    // Require auth for everything else
    if (!TOKEN?.access_token) {
      return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
    }

    if (name === "list_accounts") {
      return ok(id, authAccounts || []);
    }

    if (name === "list_projects") {
      const projects = await listProjects(TOKEN, accountId, ua, { archived: !!args.archived });
      return ok(id, projects);
    }

    if (name === "list_todos_for_project") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, accountId, project.id, ua);
      return ok(id, { project: { id: project.id, name: project.name }, groups });
    }

    if (name === "create_task_naturally") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const lists = await listTodoLists(TOKEN, accountId, project.id, ua);
      if (!lists.length) return fail(id, { code: "NO_TODOLISTS", message: "No todolists found in project" });

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

      const chunk = await scanOpenTodosChunked(TOKEN, accountId, ua, {
        cursor: args.cursor || 0,
        project_chunk: args.project_chunk || 3,
      });

      const dueToday = chunk.rows.filter(r => r.due_on === date);
      const overdue = chunk.rows.filter(r => r.due_on && r.due_on < date);

      // Per-project totals (for just this chunk)
      const perProject = {};
      for (const r of chunk.rows) {
        perProject[r.project] ||= { project: r.project, projectId: r.projectId, openTodos: 0, dueToday: 0, overdue: 0 };
        perProject[r.project].openTodos += 1;
        if (r.due_on === date) perProject[r.project].dueToday += 1;
        if (r.due_on && r.due_on < date) perProject[r.project].overdue += 1;
      }

      return ok(id, {
        ok: true,
        date,
        partial: !chunk.done,
        next_cursor: chunk.done ? null : chunk.cursor,
        projects_total: chunk.projects_total,
        scanned_projects_up_to: chunk.cursor,
        totals_chunk: {
          dueToday: dueToday.length,
          overdue: overdue.length,
          openTodos: chunk.rows.length
        },
        perProject: Object.values(perProject),
        dueToday,
        overdue
      });
    }

    if (name === "list_todos_due") {
      const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
      const includeOverdue = !!args.include_overdue;

      const chunk = await scanOpenTodosChunked(TOKEN, accountId, ua, {
        cursor: args.cursor || 0,
        project_chunk: args.project_chunk || 3,
      });

      const todos = chunk.rows
        .filter(r => r.due_on === date || (includeOverdue && r.due_on && r.due_on < date))
        .map(r => ({ ...r, overdue: r.due_on && r.due_on < date }));

      return ok(id, {
        ok: true,
        date,
        partial: !chunk.done,
        next_cursor: chunk.done ? null : chunk.cursor,
        count_chunk: todos.length,
        todos
      });
    }

    if (name === "search_todos") {
      const q = String(args.query || "").toLowerCase().trim();
      const chunk = await scanOpenTodosChunked(TOKEN, accountId, ua, {
        cursor: args.cursor || 0,
        project_chunk: args.project_chunk || 3,
      });

      const hits = chunk.rows.filter(r => (r.content || "").toLowerCase().includes(q));
      return ok(id, {
        ok: true,
        query: args.query,
        partial: !chunk.done,
        next_cursor: chunk.done ? null : chunk.cursor,
        count_chunk: hits.length,
        todos: hits
      });
    }

    if (name === "basecamp_request") {
      const data = await basecampFetch(TOKEN, args.path, { method: args.method || "GET", body: args.body, ua, accountId });
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
    return fail(id, { code: "INTERNAL_ERROR", message: e?.message || "Unknown error" });
  }
}
