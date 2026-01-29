
import crypto from "crypto";
import { basecampFetch } from "./basecamp.js";
import { resolveByName } from "./resolvers.js";

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function fail(id, error) {
  return { jsonrpc: "2.0", id, error };
}

async function listProjects(TOKEN, accountId, ua) {
  return await basecampFetch(TOKEN, `/${accountId}/projects.json`, { ua });
}

async function projectByName(TOKEN, accountId, name, ua) {
  const projects = await listProjects(TOKEN, accountId, ua);
  return resolveByName(projects, name, "project");
}

async function listTodoLists(TOKEN, projectId, ua) {
  return await basecampFetch(TOKEN, `/buckets/${projectId}/todolists.json`, { ua });
}

async function listTodosForProject(TOKEN, projectId, ua) {
  const lists = await listTodoLists(TOKEN, projectId, ua);
  const groups = [];
  for (const l of lists) {
    const todos = await basecampFetch(
      TOKEN,
      `/buckets/${projectId}/todolists/${l.id}/todos.json`,
      { ua }
    );
    groups.push({ todolistId: l.id, todolist: l.name, todos });
  }
  return groups;
}

/**
 * MCP handler: initialize, tools/list, tools/call
 * Tools are semantic and fail-fast on ambiguity.
 */
export async function handleMCP(reqBody, ctx) {
  const { id, method, params } = reqBody || {};
  const { TOKEN, accountId, ua, startStatus, authAccounts } = ctx;

  try {
    if (method === "initialize") {
      return ok(id, { name: "bcgpt", version: "2.0", sessionId: crypto.randomUUID() });
    }

    if (method === "tools/list") {
      return ok(id, {
        tools: [
          "startbcgpt",
          "list_accounts",
          "list_projects",
          "get_project_by_name",
          "list_todos_for_project",
          "create_task_naturally",
          "update_task_naturally",
          "complete_task_by_name",
          "post_update",
          "summarize_project",
          "summarize_overdue_tasks",
          "basecamp_request"
        ]
      });
    }

    if (method !== "tools/call") {
      return fail(id, { code: "UNKNOWN_METHOD", message: "Unknown MCP method" });
    }

    const { name, arguments: args = {} } = params || {};
    if (!name) return fail(id, { code: "BAD_REQUEST", message: "Missing tool name" });

    if (name === "startbcgpt") {
      return ok(id, await startStatus());
    }

    if (name === "list_accounts") {
      return ok(id, authAccounts || []);
    }

    if (name === "list_projects") {
      return ok(id, await listProjects(TOKEN, accountId, ua));
    }

    if (name === "get_project_by_name") {
      const project = await projectByName(TOKEN, accountId, args.name, ua);
      return ok(id, project);
    }

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

      const todo = await basecampFetch(
        TOKEN,
        `/buckets/${project.id}/todolists/${target.id}/todos.json`,
        { method: "POST", body, ua }
      );

      return ok(id, {
        message: "Task created",
        project: { id: project.id, name: project.name },
        todolist: { id: target.id, name: target.name },
        todo
      });
    }

    if (name === "update_task_naturally") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, project.id, ua);
      const all = groups.flatMap(g =>
        (g.todos || []).map(t => ({ id: t.id, name: t.content || t.title || t.name || "" }))
      );

      const match = resolveByName(all, args.task, "todo");

      const patch = {};
      if (args.new_task) patch.content = args.new_task;
      if (args.due_on) patch.due_on = args.due_on;

      const updated = await basecampFetch(
        TOKEN,
        `/buckets/${project.id}/todos/${match.id}.json`,
        { method: "PUT", body: patch, ua }
      );

      return ok(id, { message: "Task updated", project: { id: project.id, name: project.name }, todo: updated });
    }

    if (name === "complete_task_by_name") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, project.id, ua);
      const all = groups.flatMap(g =>
        (g.todos || []).map(t => ({ id: t.id, name: t.content || t.title || t.name || "" }))
      );

      const match = resolveByName(all, args.task, "todo");
      await basecampFetch(TOKEN, `/buckets/${project.id}/todos/${match.id}/completion.json`, { method: "POST", ua });

      return ok(id, { message: "Task completed", project: { id: project.id, name: project.name }, todoId: match.id, task: match.name });
    }

    if (name === "post_update") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const boards = await basecampFetch(TOKEN, `/buckets/${project.id}/message_boards.json`, { ua });
      if (!boards.length) return fail(id, { code: "NO_MESSAGE_BOARDS", message: "No message boards found" });

      let board = boards[0];
      if (args.board) {
        const m = resolveByName(boards.map(b => ({ id: b.id, name: b.name })), args.board, "message_board");
        board = boards.find(b => b.id === m.id) || boards[0];
      }

      const post = await basecampFetch(
        TOKEN,
        `/buckets/${project.id}/message_boards/${board.id}/messages.json`,
        { method: "POST", body: { subject: args.subject || "Update", content: args.content }, ua }
      );

      return ok(id, { message: "Posted update", project: { id: project.id, name: project.name }, board: { id: board.id, name: board.name }, post });
    }

    if (name === "summarize_project") {
      const project = await projectByName(TOKEN, accountId, args.project, ua);
      const groups = await listTodosForProject(TOKEN, project.id, ua);
      const openCount = groups.reduce((n, g) => n + ((g.todos || []).length), 0);
      return ok(id, { project: { id: project.id, name: project.name }, openTodos: openCount, todolists: groups.map(g => ({ todolist: g.todolist, count: (g.todos || []).length })) });
    }

    if (name === "summarize_overdue_tasks") {
      const projects = await listProjects(TOKEN, accountId, ua);
      const today = new Date().toISOString().slice(0, 10);
      const overdue = [];

      for (const p of projects) {
        const groups = await listTodosForProject(TOKEN, p.id, ua);
        for (const g of groups) {
          for (const t of g.todos || []) {
            const due = t.due_on || t.due_at || null;
            const completed = !!(t.completed || t.completed_at);
            if (due && String(due).slice(0, 10) < today && !completed) {
              overdue.push({
                project: p.name,
                projectId: p.id,
                todolist: g.todolist,
                todoId: t.id,
                content: t.content || t.title || t.name || "",
                due_on: String(due).slice(0, 10)
              });
            }
          }
        }
      }
      return ok(id, { count: overdue.length, overdue });
    }

    if (name === "basecamp_request") {
      const data = await basecampFetch(TOKEN, args.path, { method: args.method || "GET", body: args.body, ua });
      return ok(id, data);
    }

    return fail(id, { code: "UNKNOWN_TOOL", message: "Unknown tool name" });
  } catch (e) {
    if (e?.code === "AMBIGUOUS_MATCH") {
      return fail(id, { code: "AMBIGUOUS_MATCH", label: e.label, options: e.options });
    }
    if (e?.code === "NO_MATCH") {
      return fail(id, { code: "NO_MATCH", label: e.label });
    }
    if (e?.code === "NOT_AUTHENTICATED") {
      return fail(id, { code: "NOT_AUTHENTICATED", message: "Not authenticated" });
    }
    if (e?.code === "BASECAMP_API_ERROR") {
      return fail(id, { code: "BASECAMP_API_ERROR", status: e.status, data: e.data });
    }
    return fail(id, { code: "ERROR", message: String(e?.message || e) });
  }
}
