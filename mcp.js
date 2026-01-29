import crypto from "crypto";
import { basecampFetch } from "./basecamp.js";
import { resolveByName, resolveBestEffort } from "./resolvers.js";

function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function fail(id, error) { return { jsonrpc: "2.0", id, error }; }

function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}

function noProps() { return { type:"object", properties:{}, additionalProperties:false }; }

function isoDate(d) {
  if (!d) return null;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const t = new Date(s);
  if (!isNaN(t)) return t.toISOString().slice(0,10);
  
// In-memory cache to keep reports fast if the user asks repeatedly
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

// Simple concurrency limiter
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

function todoAssigneeNames(todo, peopleById) {
  // Basecamp often returns assignees as embedded objects
  if (Array.isArray(todo.assignees) && todo.assignees.length) {
    return todo.assignees.map(a => a?.name).filter(Boolean);
  }
  const ids = todo.assignee_ids || todo.assignees_ids || todo.assignee_id ? [todo.assignee_id] : [];
  const list = Array.isArray(todo.assignee_ids) ? todo.assignee_ids : ids;
  return (list || []).map(id => peopleById.get(String(id)) || String(id));
}
return null;
}

async function listProjects(TOKEN, accountId, ua, { archived=false } = {}) {
  const qs = archived ? "?status=archived" : "";
  return await basecampFetch(TOKEN, `/${accountId}/projects.json${qs}`, { ua });
}

async function projectByName(TOKEN, accountId, name, ua, opts={}) {
  const projects = await listProjects(TOKEN, accountId, ua, opts);
  // resolvers.js expects items with {id, name}
  return resolveByName(projects, name, "project");
}

async function getProject(TOKEN, accountId, projectId, ua) {
  return await basecampFetch(TOKEN, `/${accountId}/projects/${projectId}.json`, { ua });
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

async function listTodosForProject(TOKEN, projectId, ua) {
  const lists = await listTodoLists(TOKEN, projectId, ua);
  const groups = [];
  for (const l of lists) {
    const todos = await basecampFetch(TOKEN, `/buckets/${projectId}/todolists/${l.id}/todos.json`, { ua });
    groups.push({ todolistId: l.id, todolist: l.name, todos });
  }
  return groups;
}

function todoText(t) {
  return (t?.content || t?.title || t?.name || "").trim();
}

async function listAllOpenTodos(TOKEN, accountId, ua) {
  const projects = await listProjects(TOKEN, accountId, ua);
  const rows = [];
  for (const p of projects) {
    const groups = await listTodosForProject(TOKEN, p.id, ua);
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
  }
  return rows;
}

/**
 * MCP handler: initialize, tools/list, tools/call
 * - Preserves existing tool names so your GPT bindings keep working
 * - Adds broad Basecamp coverage via intent tools + basecamp_request fallback
 */
export async function handleMCP(reqBody, ctx) {
  const { id, method, params } = reqBody || {};
  const { TOKEN, accountId, ua, startStatus, authAccounts } = ctx;

  try {
    if (method === "initialize") {
      return ok(id, { name: "bcgpt", version: "3.0", sessionId: crypto.randomUUID() });
    }

    if (method === "tools/list") {
      // IMPORTANT: return full tool objects w/ schemas (fixes "can't do that right now")
      return ok(id, {
        tools: [
          tool("startbcgpt", "Show connection status, current user (name/email), plus re-auth and logout links.", noProps()),
          tool("whoami", "Return the authenticated user's name/email and current Basecamp account id.", noProps()),

          tool("list_accounts", "List Basecamp accounts available to the authenticated user.", noProps()),
          tool("list_projects", "List projects in the current account (optionally include archived).", {
            type:"object",
            properties:{ archived:{ type:"boolean", description:"Include archived projects (default false)" } },
            additionalProperties:false
          }),
          tool("get_project_by_name", "Resolve a project by name (fuzzy, may return ambiguity options).", {
            type:"object",
            properties:{ name:{type:"string"} },
            required:["name"],
            additionalProperties:false
          }),
          tool("get_project_dock", "Get a project's enabled tools (dock).", {
            type:"object",
            properties:{ project_id:{type:"integer"} },
            required:["project_id"],
            additionalProperties:false
          }),

          // Todos – global
          tool("daily_report", "Across all projects: due today + overdue + per-project counts.", {
            type:"object",
            properties:{ date:{type:"string", description:"YYYY-MM-DD (default: today)"} },
            additionalProperties:false
          }),
          tool("list_todos_due", "Across all projects: list open todos due on a date; optionally include overdue.", {
            type:"object",
            properties:{
              date:{type:"string", description:"YYYY-MM-DD (default: today)"},
              include_overdue:{type:"boolean", description:"Include overdue items too (default false)"}
            },
            additionalProperties:false
          }),
          tool("summarize_overdue_tasks", "Across all projects: list overdue open todos.", noProps()),
          tool("search_todos", "Across all projects: search open todos by keyword.", {
            type:"object",
            properties:{ query:{type:"string"} },
            required:["query"],
            additionalProperties:false
          }),
,
          tool("assignment_report", "For a project: group open todos by assignee (who is assigned to what). Best-effort and optimized to avoid timeouts.", {
            type:"object",
            properties:{
              project:{ type:"string", description:"Project name (fuzzy match)" },
              max_todos:{ type:"integer", description:"Maximum todos to scan (default 200)" },
              include_unassigned:{ type:"boolean", description:"Include unassigned bucket (default true)" }
            },
            required:["project"],
            additionalProperties:false
          }),

          // Todos – project scoped (existing + extended)
          tool("list_todos_for_project", "List todolists + todos for a project by name.", {
            type:"object",
            properties:{ project:{type:"string"} },
            required:["project"],
            additionalProperties:false
          }),
          tool("create_task_naturally", "Create a todo in a project; optionally specify todolist and due date.", {
            type:"object",
            properties:{
              project:{type:"string"},
              todolist:{type:"string"},
              task:{type:"string"},
              description:{type:"string"},
              due_on:{type:"string", description:"YYYY-MM-DD"}
            },
            required:["project","task"],
            additionalProperties:false
          }),
          tool("update_task_naturally", "Update a todo in a project by fuzzy-matching existing task name.", {
            type:"object",
            properties:{
              project:{type:"string"},
              task:{type:"string"},
              new_task:{type:"string"},
              due_on:{type:"string", description:"YYYY-MM-DD"}
            },
            required:["project","task"],
            additionalProperties:false
          }),
          tool("complete_task_by_name", "Complete a todo in a project by fuzzy-matching task name.", {
            type:"object",
            properties:{ project:{type:"string"}, task:{type:"string"} },
            required:["project","task"],
            additionalProperties:false
          }),

          // Messages
          tool("list_message_boards", "List message boards for a project.", {
            type:"object",
            properties:{ project:{type:"string"} },
            required:["project"],
            additionalProperties:false
          }),
          tool("list_messages", "List recent messages for a project's message board (defaults to first board).", {
            type:"object",
            properties:{ project:{type:"string"}, board_name:{type:"string"} },
            required:["project"],
            additionalProperties:false
          }),
          tool("post_update", "Post an update message to a project's message board.", {
            type:"object",
            properties:{ project:{type:"string"}, board:{type:"string"}, subject:{type:"string"}, content:{type:"string"} },
            required:["project","content"],
            additionalProperties:false
          }),
          tool("comment_message", "Comment on a message by message id.", {
            type:"object",
            properties:{ project:{type:"string"}, message_id:{type:"integer"}, content:{type:"string"} },
            required:["project","message_id","content"],
            additionalProperties:false
          }),

          // Schedule (dock-aware)
          tool("list_schedule_entries", "List schedule entries for a project (if Schedule is enabled).", {
            type:"object",
            properties:{ project:{type:"string"} },
            required:["project"],
            additionalProperties:false
          }),
          tool("create_schedule_entry", "Create a schedule entry (event/milestone) in a project.", {
            type:"object",
            properties:{
              project:{type:"string"},
              summary:{type:"string"},
              description:{type:"string"},
              starts_at:{type:"string", description:"ISO datetime or YYYY-MM-DD"},
              ends_at:{type:"string", description:"ISO datetime or YYYY-MM-DD"}
            },
            required:["project","summary","starts_at"],
            additionalProperties:false
          }),

          // Chat (Campfire) – uses chatbot endpoints if available; otherwise fallback to raw
          tool("post_chat", "Post a message to a project's Chat tool (if enabled and an endpoint is available).", {
            type:"object",
            properties:{ project:{type:"string"}, content:{type:"string"} },
            required:["project","content"],
            additionalProperties:false
          }),

          // Catch-all
          tool("basecamp_request", "Raw Basecamp API call for complete coverage. Provide full https URL or a /path.", {
            type:"object",
            properties:{ path:{type:"string"}, method:{type:"string"}, body:{type:"object"} },
            required:["path"],
            additionalProperties:false
          })
        ]
      });
    }

    if (method !== "tools/call") {
      return fail(id, { code: "UNKNOWN_METHOD", message: "Unknown MCP method" });
    }

    const { name, arguments: args = {} } = params || {};
    if (!name) return fail(id, { code: "BAD_REQUEST", message: "Missing tool name" });

    // startbcgpt remains your entry point (works with your /startbcgpt command)
    if (name === "startbcgpt") {
      return ok(id, await startStatus());
    }

    // whoami is useful for your “simple” expectation after /startbcgpt
    if (name === "whoami") {
      if (!TOKEN?.access_token) return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt." });
      const auth = authAccounts ? { accounts: authAccounts } : null;
      return ok(id, { accountId, user: null, accounts: auth?.accounts || [] });
    }

    // everything below requires auth
    if (!TOKEN?.access_token) return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt." });

    // Accounts / projects
    if (name === "list_accounts") return ok(id, authAccounts || []);
    if (name === "list_projects") {
      const projects = await listProjects(TOKEN, accountId, ua, { archived: !!args.archived });
      return ok(id, projects);
    }
    if (name === "get_project_by_name") {
      const project = await projectByName(TOKEN, accountId, args.name, ua);
      return ok(id, project);
    }
    if (name === "get_project_dock") {
      const dock = await getDock(TOKEN, accountId, Number(args.project_id), ua);
      return ok(id, dock);
    }

    // Existing tools preserved (and improved)
    if (name === "list_todos_for_project") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, project.id, ua);
      return ok(id, { project: { id: project.id, name: project.name }, groups });
    }

    if (name === "create_task_naturally") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const lists = await listTodoLists(TOKEN, project.id, ua);
      if (!lists.length) return fail(id, { code: "NO_TODOLISTS", message: "No todolists found in project" });

      let target = lists[0];
      if (args.todolist) {
        const m = resolveByName(lists.map(l => ({ id: l.id, name: l.name })), args.todolist, "todolist");
        target = lists.find(l => l.id === m.id) || lists[0];
      }

      const body = { content: args.task };
      if (args.description) body.description = args.description;
      if (args.due_on) body.due_on = args.due_on;

      const todo = await basecampFetch(TOKEN, `/buckets/${project.id}/todolists/${target.id}/todos.json`, {
        method: "POST",
        body,
        ua
      });
      return ok(id, { message: "Task created", project: { id: project.id, name: project.name }, todolist: { id: target.id, name: target.name }, todo });
    }

    if (name === "update_task_naturally") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, project.id, ua);
      const all = groups.flatMap(g => (g.todos || []).map(t => ({ id: t.id, name: todoText(t), raw: t })));

      const match = resolveBestEffort(all, args.task) || resolveByName(all, args.task, "todo");
      const patch = {};
      if (args.new_task) patch.content = args.new_task;
      if (args.due_on) patch.due_on = args.due_on;

      const updated = await basecampFetch(TOKEN, `/buckets/${project.id}/todos/${match.id}.json`, {
        method: "PUT",
        body: patch,
        ua
      });
      return ok(id, { message: "Task updated", project: { id: project.id, name: project.name }, todo: updated });
    }

    if (name === "complete_task_by_name") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, project.id, ua);
      const all = groups.flatMap(g => (g.todos || []).map(t => ({ id: t.id, name: todoText(t) })));

      const match = resolveBestEffort(all, args.task) || resolveByName(all, args.task, "todo");
      await basecampFetch(TOKEN, `/buckets/${project.id}/todos/${match.id}/completion.json`, { method: "POST", ua });
      return ok(id, { message: "Task completed", project: { id: project.id, name: project.name }, todoId: match.id, task: match.name });
    }

    // Global todo/report tools
    if (name === "daily_report") {
      const date = isoDate(args.date) || new Date().toISOString().slice(0,10);
      const rows = await listAllOpenTodos(TOKEN, accountId, ua);
      const dueToday = rows.filter(r => r.due_on === date);
      const overdue = rows.filter(r => r.due_on && r.due_on < date);
      const perProject = {};
      for (const r of rows) {
        perProject[r.project] ||= { project: r.project, projectId: r.projectId, openTodos: 0, dueToday: 0, overdue: 0 };
        perProject[r.project].openTodos += 1;
        if (r.due_on === date) perProject[r.project].dueToday += 1;
        if (r.due_on && r.due_on < date) perProject[r.project].overdue += 1;
      }
      const perProjectArr = Object.values(perProject).sort((a,b)=>(b.overdue-a.overdue)||(b.dueToday-a.dueToday)||(a.project||"").localeCompare(b.project||""));
      return ok(id, { date, totals: { projects: (new Set(rows.map(r=>r.projectId))).size, dueToday: dueToday.length, overdue: overdue.length }, perProject: perProjectArr, dueToday, overdue });
    }

    if (name === "list_todos_due") {
      const date = isoDate(args.date) || new Date().toISOString().slice(0,10);
      const includeOverdue = !!args.include_overdue;
      const rows = await listAllOpenTodos(TOKEN, accountId, ua);
      const todos = rows.filter(r => r.due_on === date || (includeOverdue && r.due_on && r.due_on < date))
                        .map(r => ({ ...r, overdue: r.due_on && r.due_on < date }));
      todos.sort((a,b)=>(a.overdue===b.overdue?0:(a.overdue?-1:1))||(a.due_on||"").localeCompare(b.due_on||"")||(a.project||"").localeCompare(b.project||""));
      return ok(id, { date, count: todos.length, todos });
    }

    if (name === "summarize_overdue_tasks") {
      const today = new Date().toISOString().slice(0,10);
      const rows = await listAllOpenTodos(TOKEN, accountId, ua);
      const overdue = rows.filter(r => r.due_on && r.due_on < today);
      overdue.sort((a,b)=>(a.due_on||"").localeCompare(b.due_on||"")||(a.project||"").localeCompare(b.project||""));
      return ok(id, { today, count: overdue.length, overdue });
    }

    
if (name === "assignment_report") {
  const project = await projectByName(TOKEN, accountId, ua, args.project);
  const cacheKey = `assign:${accountId}:${project.id}:${args.max_todos || 200}`;
  const cached = cacheGet(cacheKey);
  if (cached) return ok(id, { cached: true, ...cached });

  const maxTodos = Math.max(25, Math.min(1000, Number(args.max_todos || 200)));
  const includeUnassigned = args.include_unassigned !== false;

  // Try to fetch people for name mapping (best-effort)
  let people = [];
  try {
    // This endpoint exists in many Basecamp setups; if not, we gracefully fall back.
    people = await basecampFetch(TOKEN, `/buckets/${project.id}/people.json`, { ua });
  } catch {
    try {
      people = await basecampFetch(TOKEN, `/projects/${project.id}/people.json`, { ua });
    } catch {
      people = [];
    }
  }
  const peopleById = new Map((people || []).map(p => [String(p.id), p.name || p.email_address || String(p.id)]));

  const lists = await listTodoLists(TOKEN, project.id, ua);

  // Fetch todos for each list with limited concurrency to avoid timeouts
  let scanned = 0;
  const perList = await mapLimit(lists, 4, async (l) => {
    if (scanned >= maxTodos) return { list: l, todos: [] };
    let todos = [];
    try {
      todos = await basecampFetch(TOKEN, l.todos_url, { ua });
    } catch {
      // fallback to standard path
      todos = await basecampFetch(TOKEN, `/buckets/${project.id}/todolists/${l.id}/todos.json`, { ua });
    }
    // Only open tasks; trim to remaining budget
    const open = (todos || []).filter(t => !t.completed && !t.completed_at);
    const budget = Math.max(0, maxTodos - scanned);
    const slice = open.slice(0, budget);
    scanned += slice.length;
    return { list: l, todos: slice };
  });

  const assignments = new Map(); // name -> [{task, due, list}]
  const unassigned = [];

  for (const item of perList) {
    const listName = item.list?.name || item.list?.title || "Todo list";
    for (const t of (item.todos || [])) {
      const task = t.content || t.title || t.name || "";
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

  // sort each assignee list by due date then alpha
  const out = {};
  for (const [name, arr] of assignments.entries()) {
    arr.sort((a,b) => (a.due_on || "9999-99-99").localeCompare(b.due_on || "9999-99-99") || a.task.localeCompare(b.task));
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

  return ok(id, cacheSet(cacheKey, payload));
}

if (name === "search_todos") {
      const q = String(args.query || "").toLowerCase().trim();
      const rows = await listAllOpenTodos(TOKEN, accountId, ua);
      const hits = rows.filter(r => r.content.toLowerCase().includes(q));
      hits.sort((a,b)=>(a.due_on||"9999-99-99").localeCompare(b.due_on||"9999-99-99")||(a.project||"").localeCompare(b.project||""));
      return ok(id, { query: args.query, count: hits.length, todos: hits });
    }

    // Messages
    if (name === "list_message_boards") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const boards = await basecampFetch(TOKEN, `/buckets/${project.id}/message_boards.json`, { ua });
      return ok(id, { project: { id: project.id, name: project.name }, boards });
    }

    if (name === "list_messages") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const boards = await basecampFetch(TOKEN, `/buckets/${project.id}/message_boards.json`, { ua });
      if (!boards.length) return fail(id, { code: "NO_MESSAGE_BOARDS", message: "No message boards found" });
      let board = boards[0];
      if (args.board_name) {
        const m = resolveByName(boards.map(b => ({ id: b.id, name: b.name })), args.board_name, "message_board");
        board = boards.find(b => b.id === m.id) || boards[0];
      }
      const messages = await basecampFetch(TOKEN, `/buckets/${project.id}/message_boards/${board.id}/messages.json`, { ua });
      return ok(id, { project: { id: project.id, name: project.name }, board: { id: board.id, name: board.name }, messages });
    }

    if (name === "post_update") {
      // keep existing behavior but allow board selection
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const boards = await basecampFetch(TOKEN, `/buckets/${project.id}/message_boards.json`, { ua });
      if (!boards.length) return fail(id, { code: "NO_MESSAGE_BOARDS", message: "No message boards found" });

      let board = boards[0];
      if (args.board) {
        const m = resolveByName(boards.map(b => ({ id: b.id, name: b.name })), args.board, "message_board");
        board = boards.find(b => b.id === m.id) || boards[0];
      }

      const post = await basecampFetch(TOKEN, `/buckets/${project.id}/message_boards/${board.id}/messages.json`, {
        method: "POST",
        body: { subject: args.subject || "Update", content: args.content },
        ua
      });
      return ok(id, { message: "Posted update", project: { id: project.id, name: project.name }, board: { id: board.id, name: board.name }, post });
    }

    if (name === "comment_message") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const comment = await basecampFetch(TOKEN, `/buckets/${project.id}/recordings/${args.message_id}/comments.json`, {
        method: "POST",
        body: { content: args.content },
        ua
      });
      return ok(id, { message: "Comment posted", project: { id: project.id, name: project.name }, comment });
    }

    // Schedule: uses dock schedule url to find schedule id, then fetch entries
    if (name === "list_schedule_entries") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const dock = await getDock(TOKEN, accountId, project.id, ua);
      const sched = dockFind(dock, ["schedule", "schedules"]);
      if (!sched?.url) return fail(id, { code: "TOOL_NOT_ENABLED", message: "Schedule is not enabled for this project." });
      // sched.url points to /buckets/{id}/schedules/{schedule_id}.json
      const schedule = await basecampFetch(TOKEN, sched.url, { ua });
      const entriesUrl = schedule?.entries_url || schedule?.schedule_entries_url;
      if (!entriesUrl) return fail(id, { code: "NO_ENTRIES_URL", message: "Could not find schedule entries URL." });
      const entries = await basecampFetch(TOKEN, entriesUrl, { ua });
      return ok(id, { project: { id: project.id, name: project.name }, entries });
    }

    if (name === "create_schedule_entry") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const dock = await getDock(TOKEN, accountId, project.id, ua);
      const sched = dockFind(dock, ["schedule", "schedules"]);
      if (!sched?.url) return fail(id, { code: "TOOL_NOT_ENABLED", message: "Schedule is not enabled for this project." });
      const schedule = await basecampFetch(TOKEN, sched.url, { ua });
      const entriesUrl = schedule?.entries_url || schedule?.schedule_entries_url;
      if (!entriesUrl) return fail(id, { code: "NO_ENTRIES_URL", message: "Could not find schedule entries URL." });

      const starts_at = args.starts_at;
      const ends_at = args.ends_at || args.starts_at;
      const body = {
        summary: args.summary,
        description: args.description || "",
        starts_at,
        ends_at
      };
      const created = await basecampFetch(TOKEN, entriesUrl, { method: "POST", body, ua });
      return ok(id, { message: "Schedule entry created", project: { id: project.id, name: project.name }, entry: created });
    }

    // Chat posting: prefer chatbot if dock provides a url with a "chatbots" or "chats" endpoint; else advise using basecamp_request.
    if (name === "post_chat") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const dock = await getDock(TOKEN, accountId, project.id, ua);
      const chat = dockFind(dock, ["chat", "campfire"]);
      if (!chat?.url) return fail(id, { code: "TOOL_NOT_ENABLED", message: "Chat is not enabled for this project." });

      // Many accounts require posting via Chatbots API. We attempt a best-effort:
      // 1) try to fetch the chat tool JSON and look for a "chatbots_url" or "messages_url"
      const chatObj = await basecampFetch(TOKEN, chat.url, { ua });
      const postUrl = chatObj?.messages_url || chatObj?.chatbots_url || null;

      if (!postUrl) {
        return fail(id, { code: "NO_CHAT_POST_URL", message: "Could not find a Chat post endpoint automatically. Use basecamp_request with the Chatbots API URL from Basecamp (Configure chatbots), or enable posting endpoint." });
      }

      const payload = postUrl.includes("chatbots")
        ? { content: args.content } // chatbot message
        : { content: args.content };

      const posted = await basecampFetch(TOKEN, postUrl, { method: "POST", body: payload, ua });
      return ok(id, { message: "Chat message posted", project: { id: project.id, name: project.name }, posted });
    }

    // Raw fallback: complete Basecamp coverage
    if (name === "basecamp_request") {
      const data = await basecampFetch(TOKEN, args.path, { method: args.method || "GET", body: args.body, ua });
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
      return fail(id, { code: "BASECAMP_API_ERROR", message: `Basecamp API error (${e.status})`, data: e.data });
    }
    return fail(id, { code: "INTERNAL_ERROR", message: e?.message || "Unknown error" });
  }
}
