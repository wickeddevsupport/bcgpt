/**
 * Basecamp regression against the BCGPT gateway, scoped to the user's test project.
 *
 * Requirements (env):
 * - BCGPT_API_KEY (required)
 * - BCGPT_BASE_URL (optional, default: https://bcgpt.wickedlab.io)
 * - BASECAMP_PROJECT_ID (optional, default: 45925981)
 *
 * This script is intentionally non-destructive beyond creating a todolist + todo
 * in the configured project.
 */

const DEFAULT_BASE_URL = 'https://bcgpt.wickedlab.io';
const DEFAULT_PROJECT_ID = '45925981';

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(v).trim();
}

function getEnv(name, fallback) {
  const v = process.env[name];
  return v && String(v).trim() !== '' ? String(v).trim() : fallback;
}

function toJsonSafe(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function gatewayCall({ baseUrl, apiKey, op, body }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/action/${encodeURIComponent(op)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bcgpt-api-key': apiKey,
    },
    body: JSON.stringify(body ?? {}),
  });

  const json = await readJson(res);

  if (!res.ok) {
    const err = new Error(`HTTP_${res.status}`);
    err.status = res.status;
    err.details = json;
    throw err;
  }

  // BCGPT returns 200 even for tool errors to avoid "connector failed" UX.
  if (json && typeof json === 'object' && json.ok === false) {
    const err = new Error(json.error || json.message || 'BCGPT_GATEWAY_ERROR');
    err.code = json.code || 'BCGPT_GATEWAY_ERROR';
    err.details = json.details || json;
    throw err;
  }

  return json;
}

function pickTodosetId(structure) {
  const dock = structure?.dock;
  if (!Array.isArray(dock)) return null;
  const hit = dock.find(
    (d) =>
      d &&
      d.enabled !== false &&
      ['todoset', 'todos', 'todo_set'].includes(String(d.name ?? '')),
  );
  return hit?.id != null ? Number(hit.id) : null;
}

function nowStamp() {
  // Human readable, stable in Basecamp list names.
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const baseUrl = getEnv('BCGPT_BASE_URL', DEFAULT_BASE_URL);
  const apiKey = requireEnv('BCGPT_API_KEY');
  const projectId = getEnv('BASECAMP_PROJECT_ID', DEFAULT_PROJECT_ID);

  const prefix = `[bcgpt-regression ${nowStamp()}]`;

  const results = {
    baseUrl,
    projectId,
    created: {
      todolistId: null,
      todoId: null,
    },
    steps: [],
  };

  const step = async (name, fn) => {
    const startedAt = Date.now();
    try {
      const out = await fn();
      results.steps.push({ name, ok: true, ms: Date.now() - startedAt });
      return out;
    } catch (e) {
      results.steps.push({
        name,
        ok: false,
        ms: Date.now() - startedAt,
        error: {
          message: e?.message || String(e),
          code: e?.code || null,
          status: e?.status || null,
        },
      });
      throw e;
    }
  };

  const status = await step('startbcgpt', async () => {
    return gatewayCall({ baseUrl, apiKey, op: 'startbcgpt', body: {} });
  });
  assert(status?.connected === true, `Not connected. Open ${baseUrl}/connect for this API key and connect Basecamp.`);

  const structure = await step('get_project_structure', async () => {
    return gatewayCall({
      baseUrl,
      apiKey,
      op: 'get_project_structure',
      body: { project: projectId },
    });
  });

  const todosetId = pickTodosetId(structure);
  assert(Number.isFinite(todosetId) && todosetId > 0, 'Could not resolve todoset_id from project dock. Is the Todos tool enabled?');

  const listName = `${prefix} Todolist`;
  const createdList = await step('create_todolist', async () => {
    return gatewayCall({
      baseUrl,
      apiKey,
      op: 'create_todolist',
      body: { project: projectId, todoset_id: todosetId, body: { name: listName } },
    });
  });
  const todolistId = Number(createdList?.todolist?.id);
  assert(Number.isFinite(todolistId) && todolistId > 0, `create_todolist did not return a todolist id. Response: ${toJsonSafe(createdList)}`);
  results.created.todolistId = todolistId;

  const lists = await step('list_todolists', async () => {
    return gatewayCall({
      baseUrl,
      apiKey,
      op: 'list_todolists',
      body: { project: projectId, compact: false, preview_limit: 0, inlineLimit: 2000 },
    });
  });
  const listItems = Array.isArray(lists?.todolists) ? lists.todolists : [];
  assert(
    listItems.some((l) => Number(l?.id) === todolistId),
    `Created todolist ${todolistId} not found in list_todolists. Returned=${listItems.length}`,
  );

  const todoTask = `${prefix} Todo`;
  const createdTodo = await step('create_todo', async () => {
    return gatewayCall({
      baseUrl,
      apiKey,
      op: 'create_todo',
      body: { project: projectId, todolist: String(todolistId), task: todoTask },
    });
  });
  const todoId = Number(createdTodo?.todo?.id);
  assert(Number.isFinite(todoId) && todoId > 0, `create_todo did not return a todo id. Response: ${toJsonSafe(createdTodo)}`);
  results.created.todoId = todoId;

  await step('update_todo_details', async () => {
    return gatewayCall({
      baseUrl,
      apiKey,
      op: 'update_todo_details',
      body: {
        project: projectId,
        todo_id: todoId,
        content: `${todoTask} (updated)`,
        description: 'Updated by BCGPT regression script',
        notify: false,
      },
    });
  });

  await step('complete_todo', async () => {
    return gatewayCall({ baseUrl, apiKey, op: 'complete_todo', body: { project: projectId, todo_id: todoId } });
  });

  await step('uncomplete_todo', async () => {
    return gatewayCall({ baseUrl, apiKey, op: 'uncomplete_todo', body: { project: projectId, todo_id: todoId } });
  });

  const todosForList = await step('list_todos_for_list', async () => {
    return gatewayCall({
      baseUrl,
      apiKey,
      op: 'list_todos_for_list',
      body: { project: projectId, todolist_id: todolistId, compact: false, preview_limit: 0, inlineLimit: 2000 },
    });
  });
  const todos = Array.isArray(todosForList?.todos) ? todosForList.todos : [];
  assert(
    todos.some((t) => Number(t?.id) === todoId),
    `Created todo ${todoId} not found in list_todos_for_list. Returned=${todos.length}`,
  );

  // Print a concise summary (no secrets).
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        projectId,
        created: results.created,
        steps: results.steps,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: {
          message: e?.message || String(e),
          code: e?.code || null,
          status: e?.status || null,
          details: e?.details || null,
        },
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

