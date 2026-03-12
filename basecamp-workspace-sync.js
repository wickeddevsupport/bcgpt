import {
  createBasecampSyncRun,
  finishBasecampSyncRun,
  getBasecampSyncState,
  getBasecampWorkspaceSnapshot,
  getSelectedAccount,
  getUserAuthCache,
  getUserToken,
  listBasecampSyncTargets,
  replaceBasecampWorkspaceSnapshot,
  upsertBasecampSyncState,
} from "./db.js";
import { basecampFetch, basecampFetchAll } from "./basecamp.js";
import { buildWorkspaceTodoSnapshot } from "./basecamp-workspace-snapshot.js";

const DEFAULT_SYNC_MAX_AGE_MS = Number(process.env.BASECAMP_WORKSPACE_SYNC_MAX_AGE_MS || 5 * 60 * 1000);
const DEFAULT_SYNC_INTERVAL_MS = Number(process.env.BASECAMP_WORKSPACE_SYNC_INTERVAL_MS || 10 * 60 * 1000);
const DEFAULT_GLOBAL_PREVIEW_LIMIT = Number(process.env.BASECAMP_WORKSPACE_SNAPSHOT_PREVIEW_LIMIT || 20);
const DEFAULT_PROJECT_PREVIEW_LIMIT = Number(process.env.BASECAMP_WORKSPACE_PROJECT_PREVIEW_LIMIT || 4);
const PROJECT_SYNC_CONCURRENCY = Math.max(1, Number(process.env.BASECAMP_WORKSPACE_PROJECT_CONCURRENCY || 2));
const TODOLIST_SYNC_CONCURRENCY = Math.max(1, Number(process.env.BASECAMP_WORKSPACE_TODOLIST_CONCURRENCY || 4));

const syncLocks = new Map();
let syncLoopTimer = null;
let syncLoopRunning = false;

function nowMs() {
  return Date.now();
}

function nowSec() {
  return Math.floor(nowMs() / 1000);
}

function isoDate(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function toEpochSec(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000);
}

function stringOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberStringOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringOrNull(value);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonSafe(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function mapLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length || 1));
  const workers = Array.from({ length: width }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function parseLinkItems(accounts) {
  if (Array.isArray(accounts)) return accounts;
  if (typeof accounts === "string") return Array.isArray(parseJsonSafe(accounts, [])) ? parseJsonSafe(accounts, []) : [];
  return [];
}

async function resolveSyncContext(userKey, accountId = null) {
  const token = await getUserToken(userKey);
  if (!token?.access_token) {
    throw new Error(`No Basecamp token available for ${userKey}`);
  }

  const selectedAccountId = accountId || (await getSelectedAccount(userKey));
  if (selectedAccountId) {
    return { userKey, accountId: String(selectedAccountId), token };
  }

  const authCache = await getUserAuthCache(userKey);
  const accounts = parseLinkItems(authCache?.accounts);
  const fallbackAccountId = accounts[0]?.id != null ? String(accounts[0].id) : null;
  if (!fallbackAccountId) {
    throw new Error(`No Basecamp account selected for ${userKey}`);
  }
  return { userKey, accountId: fallbackAccountId, token };
}

function dockFind(dock, names) {
  const wanted = new Set((names || []).map((name) => String(name).toLowerCase()));
  for (const item of dock || []) {
    const name = String(item?.name || item?.type || item?.title || "").toLowerCase();
    if (wanted.has(name)) return item;
  }
  return null;
}

async function getMyProfile(token, accountId) {
  return await basecampFetch(token, "/my/profile.json", { accountId });
}

async function listProjects(token, accountId) {
  return await basecampFetchAll(token, "/projects.json", {
    accountId,
    maxPages: 100,
    pageDelayMs: 60,
  });
}

async function getProject(token, accountId, projectId) {
  return await basecampFetch(token, `/projects/${projectId}.json`, { accountId });
}

async function listTodoLists(token, accountId, projectId, projectDetail) {
  const dock = Array.isArray(projectDetail?.dock) ? projectDetail.dock : [];
  const todosDock = dockFind(dock, ["todoset", "todos", "todo_set"]);
  if (!todosDock) return [];

  if (todosDock.url) {
    try {
      const todoset = await basecampFetch(token, todosDock.url, { accountId });
      if (todoset?.todolists_url) {
        return await basecampFetchAll(token, todoset.todolists_url, {
          accountId,
          maxPages: 100,
          pageDelayMs: 40,
        });
      }
    } catch {
      // Fall through to the id-based endpoint.
    }
  }

  const todosetId = numberStringOrNull(todosDock.id);
  if (!todosetId) return [];
  return await basecampFetchAll(token, `/buckets/${projectId}/todosets/${todosetId}/todolists.json`, {
    accountId,
    maxPages: 100,
    pageDelayMs: 40,
  });
}

async function listTodosForList(token, accountId, projectId, todolist) {
  if (todolist?.todos_url) {
    return await basecampFetchAll(token, todolist.todos_url, {
      accountId,
      maxPages: 100,
      pageDelayMs: 30,
    });
  }
  return await basecampFetchAll(token, `/buckets/${projectId}/todolists/${todolist.id}/todos.json`, {
    accountId,
    maxPages: 100,
    pageDelayMs: 30,
  });
}

function buildRawRecord({ resourceType, resourceId, payload, projectId = null, parentType = null, parentId = null, sourcePath = null }) {
  const sourceUpdatedAt =
    toEpochSec(payload?.updated_at) ??
    toEpochSec(payload?.created_at) ??
    toEpochSec(payload?.updatedAt) ??
    null;
  return {
    resourceType,
    resourceId: String(resourceId),
    projectId: projectId == null ? null : String(projectId),
    parentType,
    parentId: parentId == null ? null : String(parentId),
    sourcePath,
    sourceUpdatedAt,
    payload,
  };
}

function normalizeTodo({
  todo,
  project,
  todolist,
  currentPersonId,
}) {
  const todoId = numberStringOrNull(todo?.id) ?? numberStringOrNull(todo?.todo_id);
  if (!todoId) return null;
  const title =
    stringOrNull(todo?.title) ??
    stringOrNull(todo?.content) ??
    stringOrNull(todo?.name);
  if (!title) return null;
  const assigneeIds = Array.isArray(todo?.assignee_ids)
    ? todo.assignee_ids.map((value) => Number(value)).filter(Number.isFinite)
    : Array.isArray(todo?.assignees)
      ? todo.assignees.map((entry) => Number(entry?.id)).filter(Number.isFinite)
      : todo?.assignee_id != null
        ? [Number(todo.assignee_id)].filter(Number.isFinite)
        : [];
  const dueOn = isoDate(todo?.due_on || todo?.due_at);
  return {
    todoId,
    projectId: numberStringOrNull(project?.id),
    projectName: stringOrNull(project?.name),
    todolistId: numberStringOrNull(todolist?.id),
    todolistName: stringOrNull(todolist?.name),
    title,
    status: stringOrNull(todo?.status) ?? (todo?.completed || todo?.completed_at ? "completed" : "active"),
    dueOn,
    appUrl: stringOrNull(todo?.app_url) ?? stringOrNull(todo?.url),
    assigneeIds,
    assignedToCurrentUser: Number.isFinite(currentPersonId) && assigneeIds.includes(currentPersonId),
    sourceUpdatedAt: toEpochSec(todo?.updated_at) ?? toEpochSec(todo?.created_at) ?? null,
  };
}

async function collectWorkspaceTodoData({ token, accountId, previewLimit, projectPreviewLimit, maxProjects = 0 }) {
  const [identityRaw, projectsRaw] = await Promise.all([
    getMyProfile(token, accountId),
    listProjects(token, accountId),
  ]);
  const identity = identityRaw
    ? {
        id: Number(identityRaw.id),
        name: identityRaw.name ?? null,
        email: identityRaw.email_address ?? null,
      }
    : null;

  const activeProjects = (Array.isArray(projectsRaw) ? projectsRaw : []).filter((project) => {
    const status = String(project?.status || "active").toLowerCase();
    return status !== "archived";
  });
  const projects = maxProjects > 0 ? activeProjects.slice(0, maxProjects) : activeProjects;
  const rawRecords = [];
  const todos = [];

  for (const project of projects) {
    rawRecords.push(
      buildRawRecord({
        resourceType: "project",
        resourceId: project.id,
        projectId: project.id,
        sourcePath: `/projects/${project.id}.json`,
        payload: project,
      }),
    );
  }

  const details = await mapLimit(projects, PROJECT_SYNC_CONCURRENCY, async (project) => {
    try {
      const detail = await getProject(token, accountId, project.id);
      rawRecords.push(
        buildRawRecord({
          resourceType: "project_detail",
          resourceId: project.id,
          projectId: project.id,
          sourcePath: `/projects/${project.id}.json`,
          payload: detail,
        }),
      );
      const todolists = await listTodoLists(token, accountId, project.id, detail);
      for (const todolist of todolists) {
        rawRecords.push(
          buildRawRecord({
            resourceType: "todolist",
            resourceId: todolist.id,
            projectId: project.id,
            parentType: "project",
            parentId: project.id,
            sourcePath: todolist?.todos_url ?? `/buckets/${project.id}/todolists/${todolist.id}.json`,
            payload: todolist,
          }),
        );
      }
      const todoPages = await mapLimit(todolists, TODOLIST_SYNC_CONCURRENCY, async (todolist) => {
        try {
          const listTodos = await listTodosForList(token, accountId, project.id, todolist);
          return { todolist, todos: Array.isArray(listTodos) ? listTodos : [] };
        } catch {
          return { todolist, todos: [] };
        }
      });
      return {
        project,
        detail,
        todolists,
        todoPages,
      };
    } catch {
      return {
        project,
        detail: project,
        todolists: [],
        todoPages: [],
      };
    }
  });

  for (const entry of details) {
    for (const group of entry.todoPages) {
      for (const todo of group.todos) {
        rawRecords.push(
          buildRawRecord({
            resourceType: "todo",
            resourceId: todo.id,
            projectId: entry.project.id,
            parentType: "todolist",
            parentId: group.todolist.id,
            sourcePath: group.todolist?.todos_url ?? `/buckets/${entry.project.id}/todolists/${group.todolist.id}/todos.json`,
            payload: todo,
          }),
        );
        const normalized = normalizeTodo({
          todo,
          project: entry.project,
          todolist: group.todolist,
          currentPersonId: identity?.id ?? null,
        });
        if (normalized && !["completed", "done"].includes(String(normalized.status || "").toLowerCase())) {
          todos.push(normalized);
        }
      }
    }
  }

  const projectsForSnapshot = details.map((entry) => ({
    ...entry.project,
    todoListsCount: entry.todolists.length,
    sourceUpdatedAt:
      toEpochSec(entry.detail?.updated_at) ??
      toEpochSec(entry.project?.updated_at) ??
      toEpochSec(entry.detail?.created_at) ??
      toEpochSec(entry.project?.created_at) ??
      null,
  }));

  const snapshot = buildWorkspaceTodoSnapshot({
    userKey: token.user_key ?? null,
    accountId,
    fetchedAt: nowSec(),
    identity,
    projects: projectsForSnapshot,
    todos,
    previewLimit,
    projectPreviewLimit,
  });

  return {
    identity,
    projects,
    todos,
    rawRecords,
    snapshot,
  };
}

export async function runBasecampWorkspaceSync({
  userKey,
  accountId = null,
  reason = "manual",
  previewLimit = DEFAULT_GLOBAL_PREVIEW_LIMIT,
  projectPreviewLimit = DEFAULT_PROJECT_PREVIEW_LIMIT,
  maxProjects = 0,
} = {}) {
  const ctx = await resolveSyncContext(userKey, accountId);
  const lockKey = `${ctx.userKey}:${ctx.accountId}`;
  const existing = syncLocks.get(lockKey);
  if (existing) return await existing;

  const promise = (async () => {
    const startedAt = nowSec();
    const previousState = await getBasecampSyncState(ctx.userKey, ctx.accountId);
    const runId = await createBasecampSyncRun(ctx.userKey, ctx.accountId, {
      status: "running",
      startedAt,
      stats: { reason },
    });
    await upsertBasecampSyncState(ctx.userKey, ctx.accountId, {
      status: "running",
      lastStartedAt: startedAt,
      lastCompletedAt: null,
      lastSuccessAt: null,
      lastError: null,
      stats: { reason },
    });

    try {
      const result = await collectWorkspaceTodoData({
        token: ctx.token,
        accountId: ctx.accountId,
        previewLimit,
        projectPreviewLimit,
        maxProjects,
      });
      const fetchedAt = nowSec();
      const stats = {
        reason,
        projectCount: result.snapshot.totals.projectCount,
        openTodos: result.snapshot.totals.openTodos,
        rawRecordCount: result.rawRecords.length,
      };
      const snapshot = await replaceBasecampWorkspaceSnapshot(ctx.userKey, ctx.accountId, {
        fetchedAt,
        snapshot: {
          ...result.snapshot,
          userKey: ctx.userKey,
          accountId: ctx.accountId,
          fetchedAt,
        },
        projects: result.snapshot.projects,
        todos: result.todos,
        rawRecords: result.rawRecords,
      });
      await finishBasecampSyncRun(runId, {
        status: "success",
        completedAt: nowSec(),
        fetchedAt,
        stats,
      });
      const syncState = await upsertBasecampSyncState(ctx.userKey, ctx.accountId, {
        status: "success",
        lastStartedAt: startedAt,
        lastCompletedAt: nowSec(),
        lastSuccessAt: fetchedAt,
        lastError: null,
        stats,
      });
      return {
        ...snapshot,
        syncState,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishBasecampSyncRun(runId, {
        status: "error",
        completedAt: nowSec(),
        error: message,
      });
      const syncState = await upsertBasecampSyncState(ctx.userKey, ctx.accountId, {
        status: "error",
        lastStartedAt: startedAt,
        lastCompletedAt: nowSec(),
        lastSuccessAt: previousState?.lastSuccessAt ?? null,
        lastError: message,
        stats: { reason },
      });
      throw Object.assign(new Error(message), { syncState });
    } finally {
      syncLocks.delete(lockKey);
    }
  })();

  syncLocks.set(lockKey, promise);
  return await promise;
}

export async function getOrRefreshBasecampWorkspaceSnapshot({
  userKey,
  accountId = null,
  maxAgeMs = DEFAULT_SYNC_MAX_AGE_MS,
  waitForFresh = false,
  reason = "read",
  previewLimit = DEFAULT_GLOBAL_PREVIEW_LIMIT,
  projectPreviewLimit = DEFAULT_PROJECT_PREVIEW_LIMIT,
  maxProjects = 0,
} = {}) {
  const ctx = await resolveSyncContext(userKey, accountId);
  const snapshot = await getBasecampWorkspaceSnapshot(ctx.userKey, ctx.accountId);
  const syncState = await getBasecampSyncState(ctx.userKey, ctx.accountId);
  const fetchedAtMs = snapshot?.fetchedAt ? Number(snapshot.fetchedAt) * 1000 : 0;
  const ageMs = fetchedAtMs > 0 ? Math.max(0, nowMs() - fetchedAtMs) : Number.POSITIVE_INFINITY;
  const isFresh = Boolean(snapshot) && ageMs <= maxAgeMs;

  if (isFresh && snapshot) {
    return {
      ...snapshot,
      syncState,
      stale: false,
      ageMs,
    };
  }

  if (!snapshot || waitForFresh) {
    const fresh = await runBasecampWorkspaceSync({
      userKey: ctx.userKey,
      accountId: ctx.accountId,
      reason,
      previewLimit,
      projectPreviewLimit,
      maxProjects,
    });
    return {
      ...fresh,
      stale: false,
      ageMs: 0,
    };
  }

  runBasecampWorkspaceSync({
    userKey: ctx.userKey,
    accountId: ctx.accountId,
    reason: `${reason}:background`,
    previewLimit,
    projectPreviewLimit,
    maxProjects,
  }).catch(() => {});

  return {
    ...snapshot,
    syncState,
    stale: true,
    ageMs,
  };
}

export async function syncAllBasecampWorkspaces({ maxAgeMs = DEFAULT_SYNC_MAX_AGE_MS } = {}) {
  if (syncLoopRunning) return;
  syncLoopRunning = true;
  try {
    const targets = await listBasecampSyncTargets();
    for (const target of targets) {
      try {
        await getOrRefreshBasecampWorkspaceSnapshot({
          userKey: target.userKey,
          accountId: target.accountId,
          maxAgeMs,
          waitForFresh: false,
          reason: "scheduler",
        });
      } catch {
        // Ignore per-workspace failures so one bad token does not stop the loop.
      }
    }
  } finally {
    syncLoopRunning = false;
  }
}

export function startBasecampWorkspaceSyncLoop() {
  if (syncLoopTimer) return syncLoopTimer;
  syncLoopTimer = setInterval(() => {
    syncAllBasecampWorkspaces().catch(() => {});
  }, DEFAULT_SYNC_INTERVAL_MS);
  return syncLoopTimer;
}

export function stopBasecampWorkspaceSyncLoop() {
  if (syncLoopTimer) {
    clearInterval(syncLoopTimer);
    syncLoopTimer = null;
  }
}
