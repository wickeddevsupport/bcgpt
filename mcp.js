// mcp.js
// ============================================================================
// BCGPT - Fully Intelligent Basecamp MCP Server
// ============================================================================
// Basecamp 3 API Reference: https://github.com/basecamp/bc3-api
//
// CORE API ENDPOINTS USED:
// ├─ PROJECTS
// │  ├─ GET  /projects.json                              List all projects
// │  ├─ GET  /projects/{id}.json                         Get project details
// │
// ├─ TODOS (core - always use todolists, NOT todosets)
// │  ├─ GET  /buckets/{id}/todolists.json               List todo lists in project
// │  ├─ GET  /buckets/{id}/todolists/{id}/todos.json    List todos in a list
// │  ├─ GET  /buckets/{id}/todos/{id}.json              Get specific todo
// │  ├─ POST /buckets/{id}/todolists.json               Create todo list
// │  ├─ POST /buckets/{id}/todolists/{id}/todos.json    Create todo
// │  ├─ POST /buckets/{id}/todos/{id}/completion.json   Mark todo done
// │
// ├─ CARD TABLES (Kanban)
// │  ├─ GET  /buckets/{id}/card_tables.json             List card tables
// │  ├─ GET  /buckets/{id}/card_tables/{id}/columns.json List columns
// │  ├─ GET  /buckets/{id}/card_tables/{id}/cards.json  List cards
// │  ├─ POST /buckets/{id}/card_tables/{id}/cards.json  Create card
// │  ├─ PUT  /buckets/{id}/card_tables/cards/{id}.json  Move/update card
// │
// ├─ MESSAGES (dock-driven)
// │  ├─ GET  {dock.url}                                 Get message board list
// │  ├─ GET  {board.messages_url}                       Get messages
// │
// ├─ DOCUMENTS/VAULT (dock-driven)
// │  ├─ GET  {dock.url}                                 Get vault
// │  ├─ GET  {vault.documents_url}                      Get documents
// │
// ├─ SCHEDULE (dock-driven)
// │  ├─ GET  {dock.url}                                 Get schedule
// │  ├─ GET  {schedule.entries_url}                     Get entries
// │
// ├─ SEARCH
// │  ├─ POST /projects/{id}/search.json                 Search within project
// │
// └─ HILL CHART (dock-driven)
//    └─ GET  /buckets/{id}/hill_charts/{id}.json        Get hill chart
//
// IMPORTANT NOTES:
// - projectId IS the bucketId - they're the same in Basecamp 3
// - Dock is the project's UI configuration (what features are enabled)
// - Todolists are the primary interface, NOT todosets (legacy)
// - Most endpoints require accountId which is determined from auth
// - Pagination: Uses Link headers (RFC 5988), not per_page parameter alone
// - Rate limit: 429 with Retry-After header, handle gracefully
// ============================================================================

import crypto from "crypto";
import { basecampFetch, basecampFetchAll } from "./basecamp.js";
import { resolveByName, resolveBestEffort } from "./resolvers.js";
import { indexSearchItem } from "./db.js";
import { getTools } from "./mcp/tools.js";

// Intelligent chaining modules
import { RequestContext } from './intelligent-executor.js';
import * as intelligent from './intelligent-integration.js';

// ---------- JSON-RPC helpers ----------
function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function fail(id, error) { return { jsonrpc: "2.0", id, error }; }

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
  // If ctx has basecampFetch function, use it directly (already has TOKEN and accountId baked in)
  if (typeof ctx?.basecampFetch === "function") {
    console.log(`[api] Using ctx.basecampFetch for:`, pathOrUrl);
    return ctx.basecampFetch(pathOrUrl, opts);
  }
  // Otherwise use the standalone function (requires TOKEN)
  console.log(`[api] Using standalone basecampFetch for:`, pathOrUrl);
  return basecampFetch(ctx.TOKEN, pathOrUrl, { ...opts, accountId: ctx.accountId, ua: ctx.ua });
}

function apiAll(ctx, pathOrUrl, opts = {}) {
  // If ctx has basecampFetchAll function, use it directly (already has TOKEN and accountId baked in)
  if (typeof ctx?.basecampFetchAll === "function") {
    console.log(`[apiAll] Using ctx.basecampFetchAll for:`, pathOrUrl);
    return ctx.basecampFetchAll(pathOrUrl, opts);
  }
  // Otherwise use the standalone function (requires TOKEN)
  console.log(`[apiAll] Using standalone basecampFetchAll for:`, pathOrUrl);
  return basecampFetchAll(ctx.TOKEN, pathOrUrl, { ...opts, accountId: ctx.accountId, ua: ctx.ua });
}

// ---------- Projects ----------
// Utility: chunk an array into arrays of max size n
function chunkArray(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) {
    out.push(arr.slice(i, i + n));
  }
  return out;
}

// Utility: create a concise JSON summary for a project
function projectSummary(p) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    created_at: p.created_at,
    updated_at: p.updated_at,
    app_url: p.app_url,
    // Only include a summary of dock items, not the full raw dock
    dock: Array.isArray(p.dock)
      ? p.dock.filter(d => d && d.enabled !== false).map(d => ({
          name: d.name,
          enabled: d.enabled !== false,
          url: d.url || null,
        }))
      : [],
  };
}

// List all projects, paginated and aggregated, with meaningful JSON output
async function listProjects(ctx, { archived = false, compact = true, limit, chunkSize = null } = {}) {
  const qs = new URLSearchParams();
  if (archived) qs.set("status", "archived");
  qs.set("per_page", "100");
  qs.set("page", "1");

  // Fetch all pages (apiAll already paginates and returns flat array)
  let data = await apiAll(ctx, `/projects.json?${qs.toString()}`);
  
  if (!Array.isArray(data)) {
    console.error("[listProjects] apiAll did not return array:", typeof data, data);
    data = [];
  }

  // Index projects in search database
  try {
    for (const p of data) {
      indexSearchItem("project", p.id, {
        title: p.name,
        content: p.description || "",
        url: p.app_url || p.url,
        created_at: p.created_at,
        updated_at: p.updated_at,
        userKey: ctx.userKey,
      });
    }
  } catch (e) {
    console.error("[listProjects] Error indexing projects:", e.message);
  }

  let out = data;
  if (compact) {
    out = data.map(projectSummary);
  }

  if (limit && Number.isFinite(Number(limit))) {
    out = out.slice(0, Math.max(0, Number(limit)));
  }

  // Only chunk if explicitly requested and needed
  if (chunkSize && out.length > chunkSize) {
    return {
      _chunked: true,
      _totalItems: out.length,
      chunks: chunkArray(out, chunkSize)
    };
  }
  
  return out;
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

async function createProject(ctx, body) {
  return api(ctx, `/projects.json`, { method: "POST", body });
}

async function updateProject(ctx, projectId, body) {
  return api(ctx, `/projects/${projectId}.json`, { method: "PUT", body });
}

async function trashProject(ctx, projectId) {
  await api(ctx, `/projects/${projectId}.json`, { method: "DELETE" });
  return { message: "Project trashed", project_id: projectId };
}

async function getDock(ctx, projectId) {
  const p = await getProject(ctx, projectId);
  return p?.dock || [];
}

// ---------- Todos (stable paths first) ----------
async function listTodoLists(ctx, projectId) {
  // ✅ CORRECT: Follow the links provided by Basecamp.
  // 1. Get the dock (which has the todoset link)
  // 2. Fetch the todoset object
  // 3. Extract todolists_url from the todoset and follow it
  
  try {
    const dock = await getDock(ctx, projectId);
    const todosDock = dockFind(dock, ["todoset", "todos", "todo_set"]);
    
    if (!todosDock) {
      console.log(`[listTodoLists] No todoset in dock for project ${projectId}`);
      return [];
    }
    
    if (!todosDock.id) {
      console.log(`[listTodoLists] Todoset found but no ID: ${JSON.stringify(todosDock)}`);
      return [];
    }

    // Fetch the todoset object itself to get the todolists_url link
    try {
      console.log(`[listTodoLists] Fetching todoset object from: ${todosDock.url}`);
      const todoset = await api(ctx, todosDock.url);
      
      if (todoset?.todolists_url) {
        console.log(`[listTodoLists] Using todolists_url from todoset: ${todoset.todolists_url}`);
        return await apiAll(ctx, todoset.todolists_url);
      }
      
      // Fallback: if no todolists_url, try the standard path
      console.warn(`[listTodoLists] Todoset ${todosDock.id} has no todolists_url; attempting standard path`);
    } catch (e) {
      console.warn(`[listTodoLists] Could not fetch todoset object: ${e?.message}`);
    }

    // Fallback path: standard endpoint based on todoset ID
    const endpoint = `/buckets/${projectId}/todosets/${todosDock.id}/todolists.json`;
    console.log(`[listTodoLists] Trying standard endpoint: ${endpoint}`);
    return await apiAll(ctx, endpoint);
    
  } catch (e) {
    if (e?.code === "BASECAMP_API_ERROR" && e.status === 404) {
      console.log(`[listTodoLists] 404 for project ${projectId} - no todos feature or empty`);
      return [];
    }
    console.error(`[listTodoLists] Error for project ${projectId}:`, e.message);
    // Return empty list on any error to avoid breaking project enumeration
    return [];
  }
}

async function getTodoList(ctx, projectId, todolistId) {
  return api(ctx, `/buckets/${projectId}/todolists/${todolistId}.json`);
}

async function createTodoList(ctx, projectId, todosetId, body) {
  return api(ctx, `/buckets/${projectId}/todosets/${todosetId}/todolists.json`, { method: "POST", body });
}

async function updateTodoList(ctx, projectId, todolistId, body) {
  return api(ctx, `/buckets/${projectId}/todolists/${todolistId}.json`, { method: "PUT", body });
}

async function listTodosForList(ctx, projectId, todolist) {
  try {
    if (todolist?.todos_url) return await apiAll(ctx, todolist.todos_url);
    return await apiAll(ctx, `/buckets/${projectId}/todolists/${todolist.id}/todos.json`);
  } catch (e) {
    // Graceful handling: if the todos endpoint isn't available or the list is inaccessible,
    // treat it as empty rather than failing the whole project listing.
    if (e?.code === 'BASECAMP_API_ERROR' && (e.status === 404 || e.status === 403)) {
      console.warn(`[listTodosForList] Todos inaccessible for list ${todolist?.id} in project ${projectId}: ${e.message}`);
      return [];
    }
    throw e;
  }
}

async function listTodosForProject(ctx, projectId) {
  const lists = await listTodoLists(ctx, projectId);
  const groups = await mapLimit(lists || [], 2, async (l) => {
    const todos = await listTodosForList(ctx, projectId, l);
    
    // Index todos in search database
    try {
      for (const t of todos || []) {
        if (!t.completed && !t.completed_at) { // Only index incomplete todos
          indexSearchItem("todo", t.id, {
            title: todoText(t),
            content: t.description || "",
            url: t.app_url || t.url,
            created_at: t.created_at,
            updated_at: t.updated_at,
            userKey: ctx.userKey,
          });
        }
      }
    } catch (e) {
      console.error(`[listTodosForProject] Error indexing todos in list ${l.id}:`, e.message);
    }
    
    return { todolistId: l.id, todolist: l.name, todos };
  });
  return groups;
}

function normalizeQuery(q) {
  return String(q || "").trim();
}

// Update todo details (preserve existing fields unless overridden)
async function updateTodoDetails(ctx, projectId, todoId, updates = {}) {
  const current = await api(ctx, `/buckets/${projectId}/todos/${todoId}.json`);

  const body = {
    content: (updates.content ?? current?.content ?? current?.title ?? "").trim()
  };
  if (!body.content) throw new Error("Missing content for todo update.");

  if ("description" in updates) body.description = updates.description;
  else if (current?.description) body.description = current.description;

  if ("assignee_ids" in updates) body.assignee_ids = updates.assignee_ids;
  else if (Array.isArray(current?.assignee_ids)) body.assignee_ids = current.assignee_ids;

  if ("completion_subscriber_ids" in updates) body.completion_subscriber_ids = updates.completion_subscriber_ids;
  else if (Array.isArray(current?.completion_subscriber_ids)) body.completion_subscriber_ids = current.completion_subscriber_ids;

  if ("notify" in updates) body.notify = updates.notify;
  else if (typeof current?.notify === "boolean") body.notify = current.notify;

  if ("due_on" in updates) body.due_on = updates.due_on;
  else if (current?.due_on) body.due_on = current.due_on;

  if ("starts_on" in updates) body.starts_on = updates.starts_on;
  else if (current?.starts_on) body.starts_on = current.starts_on;

  return api(ctx, `/buckets/${projectId}/todos/${todoId}.json`, { method: "PUT", body });
}

/**
 * Helper: find a todo by ID within a project
 * Searches across all todolists in the todoset
 */
async function findTodoInProject(ctx, projectId, todoId) {
  const lists = await listTodoLists(ctx, projectId);
  for (const l of lists || []) {
    try {
      const todos = await listTodosForList(ctx, projectId, l);
      const found = (todos || []).find(t => String(t.id) === String(todoId));
      if (found) return found;
    } catch (e) {
      console.debug(`[findTodoInProject] Error searching list ${l.id}: ${e.message}`);
    }
  }
  return null;
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
            raw: t,
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

// ---------- Search within a project ----------
async function searchProject(ctx, projectId, { query } = {}) {
  if (!query || !query.trim()) {
    return [];
  }

  try {
    // Use account-level search endpoint with bucket_id filter
    // GET /search.json?q=<query>&bucket_id=<projectId>&per_page=100&page=1
    let path = `/search.json?q=${encodeURIComponent(query.trim())}&bucket_id=${projectId}&per_page=100&page=1`;
    
    console.log(`[searchProject] Searching project ${projectId} with endpoint: ${path}`);
    
    // apiAll will automatically follow all pages and aggregate results
    const results = await apiAll(ctx, path);
    const arr = Array.isArray(results) ? results : [];
    
    console.log(`[searchProject] Found ${arr.length} results in project`);
    
    return arr.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      plain_text_content: r.plain_text_content,
      url: r.url,
      app_url: r.app_url,
      created_at: r.created_at,
      updated_at: r.updated_at,
      bucket: r.bucket,
      creator_id: r.creator_id,
      assignee_ids: r.assignee_ids,
      status: r.status,
      completed: r.completed,
      completion: r.completion,
    }));
  } catch (e) {
    console.error(`[searchProject] Error searching project ${projectId}:`, e.message);
    
    // Fallback: search todos, messages, documents manually if API search fails
    const results = [];
    
    try {
      const todos = await listTodosForProject(ctx, projectId);
      if (todos) {
        for (const group of todos) {
          for (const t of group.todos || []) {
            if ((t.content || "").toLowerCase().includes(query.toLowerCase())) {
              results.push({
                type: "todo",
                title: t.content,
                url: t.url,
                app_url: t.app_url,
              });
            }
          }
        }
      }
    } catch {
      // ignore
    }
    
    return results;
  }
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
        raw: t,
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

async function getCardTable(ctx, projectId, cardTableId) {
  return api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}.json`);
}

async function listCardTableColumns(ctx, projectId, cardTableId) {
  const table = await api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}.json`);
  return Array.isArray(table?.lists) ? table.lists : [];
}

async function getCardTableColumn(ctx, projectId, columnId) {
  return api(ctx, `/buckets/${projectId}/card_tables/columns/${columnId}.json`);
}

async function createCardTableColumn(ctx, projectId, cardTableId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}/columns.json`, { method: "POST", body });
}

async function updateCardTableColumn(ctx, projectId, columnId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/columns/${columnId}.json`, { method: "PUT", body });
}

async function moveCardTableColumn(ctx, projectId, cardTableId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}/moves.json`, { method: "POST", body });
}

async function subscribeCardTableColumn(ctx, projectId, columnId) {
  return api(ctx, `/buckets/${projectId}/card_tables/lists/${columnId}/subscription.json`, { method: "POST" });
}

async function unsubscribeCardTableColumn(ctx, projectId, columnId) {
  await api(ctx, `/buckets/${projectId}/card_tables/lists/${columnId}/subscription.json`, { method: "DELETE" });
  return { message: "Column unsubscribed", column_id: columnId };
}

async function createCardTableOnHold(ctx, projectId, columnId) {
  return api(ctx, `/buckets/${projectId}/card_tables/columns/${columnId}/on_hold.json`, { method: "POST" });
}

async function deleteCardTableOnHold(ctx, projectId, columnId) {
  await api(ctx, `/buckets/${projectId}/card_tables/columns/${columnId}/on_hold.json`, { method: "DELETE" });
  return { message: "Column on-hold removed", column_id: columnId };
}

async function updateCardTableColumnColor(ctx, projectId, columnId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/columns/${columnId}/color.json`, { method: "PUT", body });
}

// Fetch all cards from all columns in a card table
async function listCardTableCards(ctx, projectId, cardTableId) {
  try {
    // First get the card table with all its columns (lists)
    const cardTable = await api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}.json`);
    if (!cardTable?.lists) return [];
    
    // Fetch cards from each column and aggregate
    const allCards = [];
    for (const column of cardTable.lists) {
      if (column.cards_url) {
        const cards = await apiAll(ctx, column.cards_url);
        allCards.push(...(Array.isArray(cards) ? cards : []));
      }
    }
    return allCards;
  } catch (e) {
    console.error(`[listCardTableCards] Error fetching cards for card table ${cardTableId}:`, e.message);
    return [];
  }
}

async function getCard(ctx, projectId, cardId) {
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`);
}

async function createCard(ctx, projectId, cardTableId, { title, content, column_id, due_on } = {}) {
  const body = { title };
  if (content) body.content = content;
  if (due_on) body.due_on = due_on;
  // Note: column_id is the list/column to create the card in
  // If column_id not provided, user must specify via handler
  if (!column_id) throw new Error("column_id (list/column ID) is required to create a card");
  return api(ctx, `/buckets/${projectId}/card_tables/lists/${column_id}/cards.json`, { method: "POST", body });
}

async function updateCard(ctx, projectId, cardId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`, { method: "PUT", body });
}

async function moveCard(ctx, projectId, cardId, { column_id, position } = {}) {
  const body = {};
  if (column_id) body.column_id = column_id;
  if (position != null) body.position = position;
  // Move endpoint: POST /buckets/{id}/card_tables/cards/{id}/moves.json
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}/moves.json`, { method: "POST", body });
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

// ---------- Messages / Docs / Schedule (dock-driven) ----------
async function listMessageBoards(ctx, projectId) {
  const dock = await getDock(ctx, projectId);
  const mb = dockFind(dock, ["message_board", "message_boards"]);
  if (!mb?.url) throw new Error("This project does not expose a message board dock item.");
  // Typically returns an array of message boards.
  const boards = await apiAll(ctx, mb.url);
  return (Array.isArray(boards) ? boards : []).map((b) => ({
    id: b.id,
    title: b.title,
    status: b.status,
    app_url: b.app_url,
    messages_url: b.messages_url,
  }));
}

async function listMessages(ctx, projectId, { board_id, board_title, limit } = {}) {
  const boards = await listMessageBoards(ctx, projectId);
  let board = null;
  if (board_id) board = boards.find((b) => String(b.id) === String(board_id));
  if (!board && board_title) {
    const q = board_title.toLowerCase();
    board = boards.find((b) => (b.title || "").toLowerCase().includes(q)) || null;
  }
  if (!board) {
    // default to first board if present
    board = boards[0] || null;
  }
  if (!board?.messages_url) {
    throw new Error("No message board/messages_url found. Provide board_id or board_title.");
  }
  const msgs = await apiAll(ctx, board.messages_url);
  const arr = Array.isArray(msgs) ? msgs : [];
  
  // Index messages in search database
  try {
    for (const m of arr) {
      indexSearchItem("message", m.id, {
        title: m.subject,
        content: m.content || "",
        url: m.app_url || m.url,
        created_at: m.created_at,
        updated_at: m.updated_at,
        userKey: ctx.userKey,
      });
    }
  } catch (e) {
    console.error(`[listMessages] Error indexing messages:`, e.message);
  }
  
  const mapped = arr.map((m) => ({
    id: m.id,
    subject: m.subject,
    status: m.status,
    created_at: m.created_at,
    updated_at: m.updated_at,
    creator_id: m.creator?.id,
    bucket: m.bucket,
    app_url: m.app_url,
    url: m.url,
  }));
  if (limit != null) return mapped.slice(0, Math.max(0, Number(limit) || 0));
  return mapped;
}

async function getMessageBoard(ctx, projectId, boardId) {
  return api(ctx, `/buckets/${projectId}/message_boards/${boardId}.json`);
}

async function getMessage(ctx, projectId, messageId) {
  return api(ctx, `/buckets/${projectId}/messages/${messageId}.json`);
}

async function createMessage(ctx, projectId, boardId, body) {
  return api(ctx, `/buckets/${projectId}/message_boards/${boardId}/messages.json`, { method: "POST", body });
}

async function updateMessage(ctx, projectId, messageId, body) {
  return api(ctx, `/buckets/${projectId}/messages/${messageId}.json`, { method: "PUT", body });
}

async function listDocuments(ctx, projectId, { limit } = {}) {
  const dock = await getDock(ctx, projectId);
  const vault = dockFind(dock, ["vault", "documents"]);
  if (!vault?.url) throw new Error("This project does not expose a vault/documents dock item.");
  const vaultObj = await api(ctx, vault.url);
  // Many vault payloads include a documents_url.
  const docsUrl = vaultObj?.documents_url || vaultObj?.documents?.url || vaultObj?.documents;
  if (!docsUrl) throw new Error("Could not locate documents_url on vault payload.");
  const docs = await apiAll(ctx, docsUrl);
  const arr = Array.isArray(docs) ? docs : [];
  
  // Index documents in search database
  try {
    for (const d of arr) {
      indexSearchItem("document", d.id, {
        title: d.title,
        content: d.description || "",
        url: d.app_url || d.url,
        created_at: d.created_at,
        updated_at: d.updated_at,
        userKey: ctx.userKey,
      });
    }
  } catch (e) {
    console.error(`[listDocuments] Error indexing documents:`, e.message);
  }
  
  const mapped = arr.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    created_at: d.created_at,
    updated_at: d.updated_at,
    creator_id: d.creator?.id,
    bucket: d.bucket,
    app_url: d.app_url,
    url: d.url,
  }));
  if (limit != null) return mapped.slice(0, Math.max(0, Number(limit) || 0));
  return mapped;
}

async function getDocument(ctx, projectId, documentId) {
  return api(ctx, `/buckets/${projectId}/documents/${documentId}.json`);
}

async function createDocument(ctx, projectId, vaultId, body) {
  if (!vaultId) throw new Error("vault_id is required to create a document.");
  return api(ctx, `/buckets/${projectId}/vaults/${vaultId}/documents.json`, { method: "POST", body });
}

async function updateDocument(ctx, projectId, documentId, body) {
  return api(ctx, `/buckets/${projectId}/documents/${documentId}.json`, { method: "PUT", body });
}

async function listScheduleEntries(ctx, projectId, { limit } = {}) {
  const dock = await getDock(ctx, projectId);
  const schedule = dockFind(dock, ["schedule", "schedules"]);
  if (!schedule?.url) throw new Error("This project does not expose a schedule dock item.");
  const schedObj = await api(ctx, schedule.url);
  const entriesUrl = schedObj?.entries_url || schedObj?.entries?.url || schedObj?.entries;
  if (!entriesUrl) throw new Error("Could not locate entries_url on schedule payload.");
  const entries = await apiAll(ctx, entriesUrl);
  const arr = Array.isArray(entries) ? entries : [];
  const mapped = arr.map((e) => ({
    id: e.id,
    summary: e.summary,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    created_at: e.created_at,
    updated_at: e.updated_at,
    creator_id: e.creator?.id,
    bucket: e.bucket,
    app_url: e.app_url,
    url: e.url,
  }));
  if (limit != null) return mapped.slice(0, Math.max(0, Number(limit) || 0));
  return mapped;
}

async function getSchedule(ctx, projectId, scheduleId) {
  return api(ctx, `/buckets/${projectId}/schedules/${scheduleId}.json`);
}

async function updateSchedule(ctx, projectId, scheduleId, body) {
  return api(ctx, `/buckets/${projectId}/schedules/${scheduleId}.json`, { method: "PUT", body });
}

async function getScheduleEntry(ctx, projectId, entryId) {
  return api(ctx, `/buckets/${projectId}/schedule_entries/${entryId}.json`);
}

async function createScheduleEntry(ctx, projectId, scheduleId, body) {
  return api(ctx, `/buckets/${projectId}/schedules/${scheduleId}/entries.json`, { method: "POST", body });
}

async function updateScheduleEntry(ctx, projectId, entryId, body) {
  return api(ctx, `/buckets/${projectId}/schedule_entries/${entryId}.json`, { method: "PUT", body });
}

// ========== PEOPLE ENDPOINTS ==========
async function listAllPeople(ctx) {
  const people = await apiAll(ctx, `/people.json`);
  const arr = Array.isArray(people) ? people : [];
  return arr.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email_address,
    title: p.title,
    admin: p.admin,
    owner: p.owner,
    client: p.client,
    employee: p.employee,
    avatar_url: p.avatar_url,
    app_url: p.app_url,
  }));
}

async function listPingablePeople(ctx) {
  const people = await apiAll(ctx, `/circles/people.json`);
  return Array.isArray(people) ? people : [];
}

async function getPerson(ctx, personId) {
  const p = await api(ctx, `/people/${personId}.json`);
  return {
    id: p.id,
    name: p.name,
    email: p.email_address,
    title: p.title,
    bio: p.bio,
    location: p.location,
    admin: p.admin,
    owner: p.owner,
    client: p.client,
    employee: p.employee,
    time_zone: p.time_zone,
    avatar_url: p.avatar_url,
    created_at: p.created_at,
    updated_at: p.updated_at,
    app_url: p.app_url,
  };
}

async function getMyProfile(ctx) {
  const p = await api(ctx, `/my/profile.json`);
  return {
    id: p.id,
    name: p.name,
    email: p.email_address,
    title: p.title,
    bio: p.bio,
    location: p.location,
    avatar_url: p.avatar_url,
    time_zone: p.time_zone,
    admin: p.admin,
    owner: p.owner,
  };
}

async function listProjectPeople(ctx, projectId) {
  const people = await apiAll(ctx, `/projects/${projectId}/people.json`);
  const arr = Array.isArray(people) ? people : [];
  return arr.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email_address,
    title: p.title,
    avatar_url: p.avatar_url,
    app_url: p.app_url,
  }));
}

async function updateProjectPeople(ctx, projectId, body) {
  return api(ctx, `/projects/${projectId}/people/users.json`, { method: "PUT", body });
}

// ========== COMMENTS ENDPOINTS ==========
async function listComments(ctx, projectId, recordingId) {
  // Returns: { comments: [...], _meta: { originalRecordingId, usedRecordingId, autoResolved, matchedTitle, resolvedType } }
  const meta = { originalRecordingId: recordingId, usedRecordingId: recordingId, autoResolved: false, matchedTitle: null, resolvedType: null };

  // If recordingId is falsy, return empty
  if (!recordingId) {
    return { comments: [], _meta: { ...meta, autoResolved: false } };
  }

  // Try direct lookup first as a RECORDING
  let recordingJson;
  let commentsUrl;
  let commentsCount;
  
  try {
    recordingJson = await api(ctx, `/buckets/${projectId}/recordings/${recordingId}.json`);
    meta.resolvedType = "recording";
    commentsUrl = recordingJson?.comments_url || recordingJson?.comments_url_raw || `/buckets/${projectId}/recordings/${recordingId}/comments.json`;
    commentsCount = typeof recordingJson?.comments_count === 'number' ? recordingJson.comments_count : null;
  } catch (e) {
    // If not found as recording, try as a TODO (todos also have comments!)
    if (e && e.message && e.message.includes('404')) {
      console.log(`[listComments] ID ${recordingId} not found as recording — checking if it's a todo ID`);
      
      try {
        // First try direct fetch
        const todoJson = await api(ctx, `/buckets/${projectId}/todos/${recordingId}.json`);
        console.log(`[listComments] Found ID ${recordingId} as a todo via direct fetch — fetching its comments`);
        meta.resolvedType = "todo";
        meta.usedRecordingId = recordingId;
        meta.matchedTitle = todoJson?.title || null;
        
        // Todos have comments_url and comments_count
        commentsUrl = todoJson?.comments_url || `/buckets/${projectId}/todos/${recordingId}/comments.json`;
        commentsCount = typeof todoJson?.comments_count === 'number' ? todoJson.comments_count : null;
        recordingJson = todoJson;
      } catch (todoErr) {
        // Not found via direct fetch — search across todolists
        console.log(`[listComments] ID ${recordingId} not found via direct fetch — searching across todolists in project`);
        
        try {
          const todoJson = await findTodoInProject(ctx, projectId, recordingId);
          if (todoJson) {
            console.log(`[listComments] Found ID ${recordingId} as a todo in project ${projectId} — fetching its comments`);
            meta.resolvedType = "todo";
            meta.usedRecordingId = recordingId;
            meta.matchedTitle = todoJson?.title || null;
            
            commentsUrl = todoJson?.comments_url || `/buckets/${projectId}/todos/${recordingId}/comments.json`;
            commentsCount = typeof todoJson?.comments_count === 'number' ? todoJson.comments_count : null;
            recordingJson = todoJson;
          } else {
            // Not a recording or a todo — try fuzzy search by ID
            console.log(`[listComments] ID ${recordingId} not found as recording or todo — attempting search`);
            
            const results = await searchRecordings(ctx, recordingId, { bucket_id: projectId });
            const arr = Array.isArray(results) ? results : [];
            if (arr.length) {
              // Choose best effort match by title/content
              const candidates = arr.map((r) => ({ id: r.id, name: r.title || r.content || "", raw: r }));
              const best = resolveBestEffort(candidates, recordingId) || candidates[0];
              meta.usedRecordingId = best.id;
              meta.autoResolved = true;
              meta.matchedTitle = best.name;
              meta.resolvedType = "recording";
              recordingId = best.id;
              recordingJson = best.raw || (await api(ctx, `/buckets/${projectId}/recordings/${best.id}.json`));
              commentsUrl = recordingJson?.comments_url || `/buckets/${projectId}/recordings/${best.id}/comments.json`;
              commentsCount = typeof recordingJson?.comments_count === 'number' ? recordingJson.comments_count : null;
              console.log(`[listComments] Auto-resolved to recording id=${best.id} title="${best.name}"`);
            } else {
              console.warn(`[listComments] ID ${recordingId} not found as recording, todo, or search result in project ${projectId}`);
              return { comments: [], _meta: { ...meta, error: "NOT_FOUND", message: `Recording or todo with ID ${recordingId} not found in project ${projectId}` } };
            }
          }
        } catch (searchErr) {
          console.warn(`[listComments] Search/lookup failed: ${searchErr?.message}`);
          return { comments: [], _meta: { ...meta, error: "LOOKUP_FAILED", message: `Could not locate ID ${recordingId}` } };
        }
      }
    } else {
      throw e;
    }
  }

  // If we have recording/todo JSON but no comments URL, return empty
  if (!commentsUrl && commentsCount === null) {
    console.warn(`[listComments] ${meta.resolvedType || 'unknown'} ${recordingId} (project ${projectId}) has no comments meta; returning empty result`);
    return { comments: [], _meta: { ...meta, comments_supported: false } };
  }

  // If comments_count is zero, avoid calling endpoint (fast path)
  if (commentsCount === 0) {
    return { comments: [], _meta: { ...meta, comments_supported: true, comments_count: 0 } };
  }

  // Now fetch comments (graceful if comments endpoint not available)
  try {
    const comments = await apiAll(ctx, commentsUrl);
    const arr = Array.isArray(comments) ? comments : [];
    const mapped = arr.map((c) => ({
      id: c.id,
      created_at: c.created_at,
      updated_at: c.updated_at,
      content: c.content,
      creator: c.creator?.name,
      creator_id: c.creator?.id,
      status: c.status,
      visible_to_clients: c.visible_to_clients,
      app_url: c.app_url,
    }));
    return { comments: mapped, _meta: { ...meta, comments_supported: true, comments_count: arr.length } };
  } catch (e) {
    if (e && e.message && e.message.includes('404')) {
      console.warn(`[listComments] Comments endpoint returned 404 for ${meta.resolvedType || 'recording'} ${recordingId} in project ${projectId}`);
      return { comments: [], _meta: { ...meta, comments_supported: false } };
    }
    throw e;
  }
}

async function getComment(ctx, projectId, commentId) {
  const c = await api(ctx, `/buckets/${projectId}/comments/${commentId}.json`);
  return {
    id: c.id,
    created_at: c.created_at,
    updated_at: c.updated_at,
    content: c.content,
    creator: c.creator?.name,
    creator_id: c.creator?.id,
    status: c.status,
    visible_to_clients: c.visible_to_clients,
    parent: c.parent,
    app_url: c.app_url,
  };
}

async function createComment(ctx, projectId, recordingId, content) {
  const c = await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/comments.json`, {
    method: "POST",
    body: { content },
  });
  return {
    id: c.id,
    created_at: c.created_at,
    content: c.content,
    creator: c.creator?.name,
    creator_id: c.creator?.id,
    app_url: c.app_url,
  };
}

async function updateComment(ctx, projectId, commentId, content) {
  const c = await api(ctx, `/buckets/${projectId}/comments/${commentId}.json`, {
    method: "PUT",
    body: { content }
  });
  return {
    id: c.id,
    updated_at: c.updated_at,
    content: c.content,
    creator: c.creator?.name,
    creator_id: c.creator?.id,
    app_url: c.app_url,
  };
}

// ========== UPLOADS/FILES ENDPOINTS ==========
async function listUploads(ctx, projectId, vaultId) {
  // Uploads are nested under a vault: GET /buckets/{projectId}/vaults/{vaultId}/uploads.json
  let useVaultId = vaultId;
  if (!useVaultId) {
    const vaults = await listVaults(ctx, projectId);
    useVaultId = vaults?.[0]?.id;
  }
  if (!useVaultId) return [];

  const uploads = await apiAll(ctx, `/buckets/${projectId}/vaults/${useVaultId}/uploads.json`);
  const arr = Array.isArray(uploads) ? uploads : [];
  return arr.map((u) => ({
    id: u.id,
    title: u.title,
    filename: u.filename,
    byte_size: u.byte_size,
    content_type: u.content_type,
    created_at: u.created_at,
    creator: u.creator?.name,
    creator_id: u.creator?.id,
    download_url: u.download_url,
    description: u.description,
    status: u.status,
    app_url: u.app_url,
  }));
}

async function getUpload(ctx, projectId, uploadId) {
  const u = await api(ctx, `/buckets/${projectId}/uploads/${uploadId}.json`);
  return {
    id: u.id,
    title: u.title,
    filename: u.filename,
    byte_size: u.byte_size,
    content_type: u.content_type,
    created_at: u.created_at,
    updated_at: u.updated_at,
    creator: u.creator?.name,
    creator_id: u.creator?.id,
    download_url: u.download_url,
    description: u.description,
    status: u.status,
    app_url: u.app_url,
  };
}

async function createUpload(ctx, projectId, vaultId, body) {
  if (!vaultId) throw new Error("vault_id is required to create an upload.");
  return api(ctx, `/buckets/${projectId}/vaults/${vaultId}/uploads.json`, { method: "POST", body });
}

async function updateUpload(ctx, projectId, uploadId, body) {
  return api(ctx, `/buckets/${projectId}/uploads/${uploadId}.json`, { method: "PUT", body });
}

// ========== ATTACHMENTS ==========
async function createAttachment(ctx, name, contentType, contentBase64) {
  if (!name) throw new Error("name is required for attachment upload.");
  if (!contentType) throw new Error("content_type is required for attachment upload.");
  if (!contentBase64) throw new Error("content_base64 is required for attachment upload.");
  const buffer = Buffer.from(contentBase64, "base64");
  return api(ctx, `/attachments.json?name=${encodeURIComponent(name)}`, {
    method: "POST",
    body: buffer,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length)
    }
  });
}

// ========== RECORDINGS ENDPOINTS ==========
async function getRecordings(ctx, type, { bucket = null, status = "active", sort = "created_at", direction = "desc" } = {}) {
  if (!type) throw new Error("Recording type is required (e.g., Todo, Message, Document, Upload)");
  let path = `/projects/recordings.json?type=${encodeURIComponent(type)}&status=${encodeURIComponent(status)}&sort=${encodeURIComponent(sort)}&direction=${encodeURIComponent(direction)}`;
  if (bucket) path += `&bucket=${encodeURIComponent(bucket)}`;
  
  const recordings = await apiAll(ctx, path);
  const arr = Array.isArray(recordings) ? recordings : [];
  return arr.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    created_at: r.created_at,
    updated_at: r.updated_at,
    status: r.status,
    bucket: r.bucket,
    bucket_id: r.bucket?.id,
    creator: r.creator?.name,
    creator_id: r.creator?.id,
    assignee_ids: r.assignee_ids,
    completed: r.completed,
    completion: r.completion,
    app_url: r.app_url,
  }));
}

async function trashRecording(ctx, projectId, recordingId) {
  await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/status/trashed.json`, { method: "PUT" });
  return { message: "Recording trashed", recording_id: recordingId };
}

async function archiveRecording(ctx, projectId, recordingId) {
  await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/status/archived.json`, { method: "PUT" });
  return { message: "Recording archived", recording_id: recordingId };
}

async function unarchiveRecording(ctx, projectId, recordingId) {
  await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/status/active.json`, { method: "PUT" });
  return { message: "Recording unarchived", recording_id: recordingId };
}

// ========== VAULTS/DOCUMENT STORAGE ==========
async function listVaults(ctx, projectId) {
  try {
    const dock = await getDock(ctx, projectId);
    const vaultDock = dockFind(dock, ["vault", "documents", "vaults"]);
    if (vaultDock?.url) {
      const vault = await api(ctx, vaultDock.url);
      return vault ? [{
        id: vault.id,
        name: vault.name,
        title: vault.title,
        position: vault.position,
        app_url: vault.app_url,
        entries_url: vault.entries_url,
        documents_url: vault.documents_url,
        uploads_url: vault.uploads_url,
        vaults_url: vault.vaults_url
      }] : [];
    }
  } catch (e) {
    console.warn(`[listVaults] Dock lookup failed for project ${projectId}: ${e.message}`);
  }

  // Fallback: older endpoint (if supported)
  try {
    const vault = await api(ctx, `/buckets/${projectId}/vault.json`);
    return vault ? [{
      id: vault.id,
      name: vault.name,
      title: vault.title,
      position: vault.position,
      app_url: vault.app_url,
      entries_url: vault.entries_url,
      documents_url: vault.documents_url,
      uploads_url: vault.uploads_url,
      vaults_url: vault.vaults_url
    }] : [];
  } catch {
    return [];
  }
}

// ========== VAULT CHILD VAULTS ==========
async function listChildVaults(ctx, projectId, vaultId) {
  try {
    return await apiAll(ctx, `/buckets/${projectId}/vaults/${vaultId}/vaults.json`);
  } catch (e) {
    if (e?.code === "BASECAMP_API_ERROR" && (e.status === 404 || e.status === 403)) {
      return [];
    }
    throw e;
  }
}

async function createChildVault(ctx, projectId, vaultId, body) {
  return api(ctx, `/buckets/${projectId}/vaults/${vaultId}/vaults.json`, { method: "POST", body });
}

async function updateVault(ctx, projectId, vaultId, body) {
  return api(ctx, `/buckets/${projectId}/vaults/${vaultId}.json`, { method: "PUT", body });
}

// ========== CAMPFIRES / CHAT ==========
async function resolveCampfire(ctx, projectId, chatId = null) {
  if (chatId) return api(ctx, `/buckets/${projectId}/chats/${chatId}.json`);

  const dock = await getDock(ctx, projectId);
  const chatDock = dockFind(dock, ["chat", "campfire", "campfires"]);
  if (chatDock?.url) {
    const chat = await api(ctx, chatDock.url);
    if (Array.isArray(chat)) return chat[0] || null;
    return chat;
  }

  try {
    const chats = await apiAll(ctx, `/chats.json`);
    const arr = Array.isArray(chats) ? chats : [];
    return arr.find(c => String(c?.bucket?.id) === String(projectId)) || null;
  } catch {
    return null;
  }
}

async function listCampfires(ctx, projectId = null) {
  const chats = await apiAll(ctx, `/chats.json`);
  const arr = Array.isArray(chats) ? chats : [];
  if (!projectId) return arr;
  return arr.filter(c => String(c?.bucket?.id) === String(projectId));
}

async function listCampfireLines(ctx, projectId, chatId, { limit } = {}) {
  const lines = await apiAll(ctx, `/buckets/${projectId}/chats/${chatId}/lines.json`);
  const arr = Array.isArray(lines) ? lines : [];
  if (limit && Number.isFinite(Number(limit))) return arr.slice(0, Math.max(0, Number(limit)));
  return arr;
}

async function getCampfireLine(ctx, projectId, chatId, lineId) {
  return api(ctx, `/buckets/${projectId}/chats/${chatId}/lines/${lineId}.json`);
}

async function createCampfireLine(ctx, projectId, chatId, body) {
  return api(ctx, `/buckets/${projectId}/chats/${chatId}/lines.json`, { method: "POST", body });
}

async function deleteCampfireLine(ctx, projectId, chatId, lineId) {
  await api(ctx, `/buckets/${projectId}/chats/${chatId}/lines/${lineId}.json`, { method: "DELETE" });
  return { message: "Line deleted", line_id: lineId };
}

// ========== CHATBOTS (Campfire integrations) ==========
async function listChatbots(ctx, projectId, chatId) {
  return apiAll(ctx, `/buckets/${projectId}/chats/${chatId}/integrations.json`);
}

async function getChatbot(ctx, projectId, chatId, integrationId) {
  return api(ctx, `/buckets/${projectId}/chats/${chatId}/integrations/${integrationId}.json`);
}

async function createChatbot(ctx, projectId, chatId, body) {
  return api(ctx, `/buckets/${projectId}/chats/${chatId}/integrations.json`, { method: "POST", body });
}

async function updateChatbot(ctx, projectId, chatId, integrationId, body) {
  return api(ctx, `/buckets/${projectId}/chats/${chatId}/integrations/${integrationId}.json`, { method: "PUT", body });
}

async function deleteChatbot(ctx, projectId, chatId, integrationId) {
  await api(ctx, `/buckets/${projectId}/chats/${chatId}/integrations/${integrationId}.json`, { method: "DELETE" });
  return { message: "Chatbot deleted", integration_id: integrationId };
}

async function postChatbotLine(ctx, projectId, chatId, integrationKey, body) {
  return api(ctx, `/integrations/${integrationKey}/buckets/${projectId}/chats/${chatId}/lines.json`, { method: "POST", body });
}

// ========== WEBHOOKS ==========
async function listWebhooks(ctx, projectId) {
  return apiAll(ctx, `/buckets/${projectId}/webhooks.json`);
}

async function getWebhook(ctx, projectId, webhookId) {
  return api(ctx, `/buckets/${projectId}/webhooks/${webhookId}.json`);
}

async function createWebhook(ctx, projectId, body) {
  return api(ctx, `/buckets/${projectId}/webhooks.json`, { method: "POST", body });
}

async function updateWebhook(ctx, projectId, webhookId, body) {
  return api(ctx, `/buckets/${projectId}/webhooks/${webhookId}.json`, { method: "PUT", body });
}

async function deleteWebhook(ctx, projectId, webhookId) {
  await api(ctx, `/buckets/${projectId}/webhooks/${webhookId}.json`, { method: "DELETE" });
  return { message: "Webhook deleted", webhook_id: webhookId };
}

// ========== MESSAGE TYPES / PINNING ==========
async function listMessageTypes(ctx, projectId) {
  try {
    return apiAll(ctx, `/buckets/${projectId}/categories.json`);
  } catch (e) {
    if (e?.code === "BASECAMP_API_ERROR" && (e.status === 404 || e.status === 403)) {
      return [];
    }
    throw e;
  }
}

async function getMessageType(ctx, projectId, categoryId) {
  return api(ctx, `/buckets/${projectId}/categories/${categoryId}.json`);
}

async function createMessageType(ctx, projectId, body) {
  return api(ctx, `/buckets/${projectId}/categories.json`, { method: "POST", body });
}

async function updateMessageType(ctx, projectId, categoryId, body) {
  return api(ctx, `/buckets/${projectId}/categories/${categoryId}.json`, { method: "PUT", body });
}

async function deleteMessageType(ctx, projectId, categoryId) {
  await api(ctx, `/buckets/${projectId}/categories/${categoryId}.json`, { method: "DELETE" });
  return { message: "Message type deleted", category_id: categoryId };
}

async function pinRecording(ctx, projectId, recordingId) {
  await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/pin.json`, { method: "POST" });
  return { message: "Recording pinned", recording_id: recordingId };
}

async function unpinRecording(ctx, projectId, recordingId) {
  await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/pin.json`, { method: "DELETE" });
  return { message: "Recording unpinned", recording_id: recordingId };
}

// ========== CLIENT COMMUNICATIONS ==========
async function listClientCorrespondences(ctx, projectId) {
  return apiAll(ctx, `/buckets/${projectId}/client/correspondences.json`);
}

async function getClientCorrespondence(ctx, projectId, correspondenceId) {
  return api(ctx, `/buckets/${projectId}/client/correspondences/${correspondenceId}.json`);
}

async function listClientApprovals(ctx, projectId) {
  return apiAll(ctx, `/buckets/${projectId}/client/approvals.json`);
}

async function getClientApproval(ctx, projectId, approvalId) {
  return api(ctx, `/buckets/${projectId}/client/approvals/${approvalId}.json`);
}

async function listClientReplies(ctx, projectId, recordingId) {
  return apiAll(ctx, `/buckets/${projectId}/client/recordings/${recordingId}/replies.json`);
}

async function getClientReply(ctx, projectId, recordingId, replyId) {
  return api(ctx, `/buckets/${projectId}/client/recordings/${recordingId}/replies/${replyId}.json`);
}

// ========== CARD STEPS ==========
async function listCardSteps(ctx, projectId, cardId) {
  const card = await api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`);
  return Array.isArray(card?.steps) ? card.steps : [];
}

async function createCardStep(ctx, projectId, cardId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}/steps.json`, { method: "POST", body });
}

async function updateCardStep(ctx, projectId, stepId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/steps/${stepId}.json`, { method: "PUT", body });
}

async function setCardStepCompletion(ctx, projectId, stepId, completion) {
  return api(ctx, `/buckets/${projectId}/card_tables/steps/${stepId}/completions.json`, { method: "PUT", body: { completion } });
}

async function completeCardStep(ctx, projectId, stepId) {
  await setCardStepCompletion(ctx, projectId, stepId, "on");
  return { message: "Card step completed", step_id: stepId };
}

async function uncompleteCardStep(ctx, projectId, stepId) {
  await setCardStepCompletion(ctx, projectId, stepId, "off");
  return { message: "Card step uncompleted", step_id: stepId };
}

async function repositionCardStep(ctx, projectId, cardId, stepId, position) {
  await api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}/positions.json`, {
    method: "POST",
    body: { source_id: stepId, position }
  });
  return { message: "Card step repositioned", step_id: stepId, position };
}

// ========== SEARCH ACROSS RECORDINGS ==========
// Official Basecamp search endpoint: GET /search.json
// Query params: q (required), type, bucket_id, creator_id, file_type, exclude_chat, page, per_page
async function searchRecordings(ctx, query, { bucket_id = null, type = null } = {}) {
  // Coerce query to string and validate — prevents TypeError when non-strings (e.g., numeric ids) are passed
  const rawQuery = (typeof query === 'string' ? query : String(query || '')).trim();
  if (!rawQuery) throw new Error("Search query is required");
  
  // Build the search endpoint with proper query parameters
  let path = `/search.json?q=${encodeURIComponent(rawQuery)}`;
  
  // Add optional filters
  if (bucket_id) path += `&bucket_id=${encodeURIComponent(bucket_id)}`;
  if (type) path += `&type=${encodeURIComponent(type)}`;
  
  // Pagination: per_page and page will be added by apiAll/basecampFetchAll
  // Force pagination with per_page=100, page=1
  path += `&per_page=100&page=1`;
  
  console.log(`[searchRecordings] Searching with endpoint: ${path}`);
  
  // apiAll will automatically follow pagination and aggregate all pages
  const results = await apiAll(ctx, path);
  const arr = Array.isArray(results) ? results : [];
  
  console.log(`[searchRecordings] Found ${arr.length} results for query: "${rawQuery}"`);
  
  return arr.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    plain_text_content: r.plain_text_content,
    created_at: r.created_at,
    updated_at: r.updated_at,
    bucket: r.bucket,
    bucket_id: r.bucket?.id,
    creator_id: r.creator?.id,
    assignee_ids: r.assignee_ids,
    status: r.status,
    completed: r.completed,
    completion: r.completion,
    app_url: r.app_url,
    url: r.url,
  }));
}

async function searchMetadata(ctx) {
  return api(ctx, `/searches/metadata.json`);
}

// ========== CLIENT VISIBILITY ==========
async function updateClientVisibility(ctx, projectId, recordingId, body) {
  return api(ctx, `/buckets/${projectId}/recordings/${recordingId}/client_visibility.json`, { method: "PUT", body });
}

// ========== EVENTS ==========
async function listRecordingEvents(ctx, projectId, recordingId) {
  return apiAll(ctx, `/buckets/${projectId}/recordings/${recordingId}/events.json`);
}

// ========== SUBSCRIPTIONS ==========
async function getSubscription(ctx, projectId, recordingId) {
  return api(ctx, `/buckets/${projectId}/recordings/${recordingId}/subscription.json`);
}

async function subscribeRecording(ctx, projectId, recordingId) {
  return api(ctx, `/buckets/${projectId}/recordings/${recordingId}/subscription.json`, { method: "POST" });
}

async function unsubscribeRecording(ctx, projectId, recordingId) {
  await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/subscription.json`, { method: "DELETE" });
  return { message: "Unsubscribed", recording_id: recordingId };
}

async function updateSubscription(ctx, projectId, recordingId, body) {
  return api(ctx, `/buckets/${projectId}/recordings/${recordingId}/subscription.json`, { method: "PUT", body });
}

// ========== REPORTS ==========
async function reportTodosAssigned(ctx) {
  return apiAll(ctx, `/reports/todos/assigned.json`);
}

async function reportTodosAssignedPerson(ctx, personId) {
  return apiAll(ctx, `/reports/todos/assigned/${personId}.json`);
}

async function reportTodosOverdue(ctx) {
  return apiAll(ctx, `/reports/todos/overdue.json`);
}

async function reportSchedulesUpcoming(ctx, query) {
  const path = query ? `/reports/schedules/upcoming.json?${query}` : `/reports/schedules/upcoming.json`;
  return apiAll(ctx, path);
}

// ========== TIMELINE ==========
async function reportTimeline(ctx, query) {
  const path = query ? `/reports/progress.json?${query}` : `/reports/progress.json`;
  return apiAll(ctx, path);
}

async function projectTimeline(ctx, projectId, query) {
  const path = query ? `/projects/${projectId}/timeline.json?${query}` : `/projects/${projectId}/timeline.json`;
  return apiAll(ctx, path);
}

async function userTimeline(ctx, personId, query) {
  const path = query ? `/reports/users/progress/${personId}.json?${query}` : `/reports/users/progress/${personId}.json`;
  return apiAll(ctx, path);
}

// ========== TIMESHEETS ==========
async function reportTimesheet(ctx, query) {
  const path = query ? `/reports/timesheet.json?${query}` : `/reports/timesheet.json`;
  return apiAll(ctx, path);
}

async function projectTimesheet(ctx, projectId, query) {
  const path = query ? `/projects/${projectId}/timesheet.json?${query}` : `/projects/${projectId}/timesheet.json`;
  return apiAll(ctx, path);
}

async function recordingTimesheet(ctx, projectId, recordingId, query) {
  const path = query ? `/projects/${projectId}/recordings/${recordingId}/timesheet.json?${query}` : `/projects/${projectId}/recordings/${recordingId}/timesheet.json`;
  return apiAll(ctx, path);
}

// ========== INBOXES / FORWARDS / REPLIES ==========
async function getInbox(ctx, projectId, inboxId) {
  return api(ctx, `/buckets/${projectId}/inboxes/${inboxId}.json`);
}

async function listInboxForwards(ctx, projectId, inboxId) {
  return apiAll(ctx, `/buckets/${projectId}/inboxes/${inboxId}/forwards.json`);
}

async function getInboxForward(ctx, projectId, forwardId) {
  return api(ctx, `/buckets/${projectId}/inbox_forwards/${forwardId}.json`);
}

async function listInboxReplies(ctx, projectId, forwardId) {
  return apiAll(ctx, `/buckets/${projectId}/inbox_forwards/${forwardId}/replies.json`);
}

async function getInboxReply(ctx, projectId, forwardId, replyId) {
  return api(ctx, `/buckets/${projectId}/inbox_forwards/${forwardId}/replies/${replyId}.json`);
}

// ========== QUESTIONNAIRES / QUESTIONS / ANSWERS ==========
async function getQuestionnaire(ctx, projectId, questionnaireId) {
  return api(ctx, `/buckets/${projectId}/questionnaires/${questionnaireId}.json`);
}

async function listQuestions(ctx, projectId, questionnaireId) {
  return apiAll(ctx, `/buckets/${projectId}/questionnaires/${questionnaireId}/questions.json`);
}

async function getQuestion(ctx, projectId, questionId) {
  return api(ctx, `/buckets/${projectId}/questions/${questionId}.json`);
}

async function createQuestion(ctx, projectId, questionnaireId, body) {
  return api(ctx, `/buckets/${projectId}/questionnaires/${questionnaireId}/questions.json`, { method: "POST", body });
}

async function updateQuestion(ctx, projectId, questionId, body) {
  return api(ctx, `/buckets/${projectId}/questions/${questionId}.json`, { method: "PUT", body });
}

async function pauseQuestion(ctx, projectId, questionId) {
  await api(ctx, `/buckets/${projectId}/questions/${questionId}/pause.json`, { method: "POST" });
  return { message: "Question paused", question_id: questionId };
}

async function resumeQuestion(ctx, projectId, questionId) {
  await api(ctx, `/buckets/${projectId}/questions/${questionId}/pause.json`, { method: "DELETE" });
  return { message: "Question resumed", question_id: questionId };
}

async function updateQuestionNotificationSettings(ctx, projectId, questionId, body) {
  return api(ctx, `/buckets/${projectId}/questions/${questionId}/notification_settings.json`, { method: "PUT", body });
}

async function listQuestionAnswers(ctx, projectId, questionId) {
  return apiAll(ctx, `/buckets/${projectId}/questions/${questionId}/answers.json`);
}

async function listQuestionAnswersBy(ctx, projectId, questionId) {
  return apiAll(ctx, `/buckets/${projectId}/questions/${questionId}/answers/by.json`);
}

async function listQuestionAnswersByPerson(ctx, projectId, questionId, personId) {
  return apiAll(ctx, `/buckets/${projectId}/questions/${questionId}/answers/by/${personId}.json`);
}

async function getQuestionAnswer(ctx, projectId, answerId) {
  return api(ctx, `/buckets/${projectId}/question_answers/${answerId}.json`);
}

async function createQuestionAnswer(ctx, projectId, questionId, body) {
  return api(ctx, `/buckets/${projectId}/questions/${questionId}/answers.json`, { method: "POST", body });
}

async function updateQuestionAnswer(ctx, projectId, answerId, body) {
  return api(ctx, `/buckets/${projectId}/question_answers/${answerId}.json`, { method: "PUT", body });
}

async function listQuestionReminders(ctx) {
  return apiAll(ctx, `/my/question_reminders.json`);
}

// ========== TEMPLATES ==========
async function listTemplates(ctx) {
  return apiAll(ctx, `/templates.json`);
}

async function getTemplate(ctx, templateId) {
  return api(ctx, `/templates/${templateId}.json`);
}

async function createTemplate(ctx, body) {
  return api(ctx, `/templates.json`, { method: "POST", body });
}

async function updateTemplate(ctx, templateId, body) {
  return api(ctx, `/templates/${templateId}.json`, { method: "PUT", body });
}

async function trashTemplate(ctx, templateId) {
  await api(ctx, `/templates/${templateId}.json`, { method: "DELETE" });
  return { message: "Template trashed", template_id: templateId };
}

async function createProjectConstruction(ctx, templateId, body) {
  return api(ctx, `/templates/${templateId}/project_constructions.json`, { method: "POST", body });
}

async function getProjectConstruction(ctx, templateId, constructionId) {
  return api(ctx, `/templates/${templateId}/project_constructions/${constructionId}.json`);
}

// ========== TOOLS (DOCK TOOLS) ==========
async function getDockTool(ctx, projectId, toolId) {
  return api(ctx, `/buckets/${projectId}/dock/tools/${toolId}.json`);
}

async function createDockTool(ctx, projectId, body) {
  return api(ctx, `/buckets/${projectId}/dock/tools.json`, { method: "POST", body });
}

async function updateDockTool(ctx, projectId, toolId, body) {
  return api(ctx, `/buckets/${projectId}/dock/tools/${toolId}.json`, { method: "PUT", body });
}

async function enableDockTool(ctx, projectId, recordingId, body) {
  return api(ctx, `/buckets/${projectId}/recordings/${recordingId}/position.json`, { method: "POST", body });
}

async function moveDockTool(ctx, projectId, recordingId, body) {
  return api(ctx, `/buckets/${projectId}/recordings/${recordingId}/position.json`, { method: "PUT", body });
}

async function disableDockTool(ctx, projectId, recordingId) {
  await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/position.json`, { method: "DELETE" });
  return { message: "Tool disabled", recording_id: recordingId };
}

async function trashDockTool(ctx, projectId, toolId) {
  await api(ctx, `/buckets/${projectId}/dock/tools/${toolId}.json`, { method: "DELETE" });
  return { message: "Tool trashed", tool_id: toolId };
}

// ========== LINEUP MARKERS ==========
async function createLineupMarker(ctx, body) {
  return api(ctx, `/lineup/markers.json`, { method: "POST", body });
}

async function updateLineupMarker(ctx, markerId, body) {
  return api(ctx, `/lineup/markers/${markerId}.json`, { method: "PUT", body });
}

async function deleteLineupMarker(ctx, markerId) {
  await api(ctx, `/lineup/markers/${markerId}.json`, { method: "DELETE" });
  return { message: "Lineup marker deleted", marker_id: markerId };
}

// ========== TODO LIST GROUPS / TODOSETS ==========
async function listTodolistGroups(ctx, projectId, todolistId) {
  return apiAll(ctx, `/buckets/${projectId}/todolists/${todolistId}/groups.json`);
}

async function getTodolistGroup(ctx, projectId, groupId) {
  return api(ctx, `/buckets/${projectId}/todolists/${groupId}.json`);
}

async function createTodolistGroup(ctx, projectId, todolistId, body) {
  return api(ctx, `/buckets/${projectId}/todolists/${todolistId}/groups.json`, { method: "POST", body });
}

async function repositionTodolistGroup(ctx, projectId, groupId, position) {
  return api(ctx, `/buckets/${projectId}/todolists/groups/${groupId}/position.json`, { method: "PUT", body: { position } });
}

async function getTodoset(ctx, projectId, todosetId) {
  return api(ctx, `/buckets/${projectId}/todosets/${todosetId}.json`);
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
        tools: getTools(),
      });
    }

    if (method !== "tools/call") {
      return fail(id, { code: "UNKNOWN_METHOD", message: "Unknown MCP method" });
    }

    const { name, arguments: args = {} } = params || {};
    if (!name) return fail(id, { code: "BAD_REQUEST", message: "Missing tool name" });

    // Debug logging
    console.log(`[MCP] Tool called: ${name}`, { args, authenticated: !!TOKEN?.access_token, accountId });

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

    if (name === "get_project_structure") {
      try {
        const p = await projectByName(ctx, args.project);
        const dock = await getDock(ctx, p.id);
        
        // Return structured dock info with all available links
        const dockInfo = (dock || []).map(d => ({
          id: d.id,
          title: d.title,
          name: d.name,
          enabled: d.enabled,
          position: d.position,
          url: d.url,
          app_url: d.app_url,
        }));
        
        return ok(id, {
          project: { id: p.id, name: p.name },
          dock: dockInfo,
          description: "Dock contains links to all features. Use the 'url' field to construct API calls. Follow links from each resource to get comments_url, todos_url, etc."
        });
      } catch (e) {
        return fail(id, { code: "GET_STRUCTURE_ERROR", message: e.message });
      }
    }

    if (name === "list_projects") {
      // Return all projects as a flat array (no chunking for MCP)
      const projects = await listProjects(ctx, { archived: !!args.archived, compact: true, chunkSize: null });
      return ok(id, { projects, count: Array.isArray(projects) ? projects.length : 0 });
    }

    if (name === "find_project") {
      const p = await projectByName(ctx, args.name);
      // Return concise summary, not raw
      return ok(id, projectSummary(p));
    }

    if (name === "get_project") {
      try {
        const project = await getProject(ctx, Number(args.project_id));
        return ok(id, projectSummary(project));
      } catch (e) {
        return fail(id, { code: "GET_PROJECT_ERROR", message: e.message });
      }
    }

    if (name === "create_project") {
      try {
        const project = await createProject(ctx, args.body || {});
        return ok(id, { message: "Project created", project });
      } catch (e) {
        return fail(id, { code: "CREATE_PROJECT_ERROR", message: e.message });
      }
    }

    if (name === "update_project") {
      try {
        const project = await updateProject(ctx, Number(args.project_id), args.body || {});
        return ok(id, { message: "Project updated", project });
      } catch (e) {
        return fail(id, { code: "UPDATE_PROJECT_ERROR", message: e.message });
      }
    }

    if (name === "trash_project") {
      try {
        const result = await trashProject(ctx, Number(args.project_id));
        return ok(id, result);
      } catch (e) {
        return fail(id, { code: "TRASH_PROJECT_ERROR", message: e.message });
      }
    }

    if (name === "list_todos_for_project") {
      try {
        const p = await projectByName(ctx, args.project);
        const groups = await listTodosForProject(ctx, p.id);
        
        // INTELLIGENT CHAINING: Enrich todos with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `list todos for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        
        const enrichedGroups = await Promise.all(
          (groups || []).map(async (group) => ({
            ...group,
            todos: await Promise.all(
              (group.todos || []).map(t => enricher.enrich(t, {
                getPerson: (id) => ctx_intel.getPerson(id),
                getProject: (id) => ctx_intel.getProject(id)
              }))
            )
          }))
        );
        
        return ok(id, { 
          project: { id: p.id, name: p.name }, 
          groups: enrichedGroups,
          metrics: ctx_intel.getMetrics()
        });
      } catch (e) {
        console.error(`[list_todos_for_project] Error:`, e.message);
        // Fallback to non-enriched list
        try {
          const p = await projectByName(ctx, args.project);
          const groups = await listTodosForProject(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, groups, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_TODOS_FOR_PROJECT_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "daily_report") {
      try {
        const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);

        // INTELLIGENT CHAINING: Load todos and enrich in parallel
        // Automatically fetches project names, assignee details, and formats results
        const result = await intelligent.executeDailyReport(ctx, date);

        return ok(id, {
          date,
          totals: result.totals,
          perProject: result.perProject,
          dueToday: result.dueToday,
          overdue: result.overdue,
          metrics: result._metadata
        });
      } catch (e) {
        console.error(`[daily_report] Error:`, e.message);
        // Fallback to original implementation
        try {
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
            overdue,
            fallback: true
          });
        } catch (fbErr) {
          return fail(id, { code: "DAILY_REPORT_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_todos_due") {
      try {
        const date = isoDate(args.date) || new Date().toISOString().slice(0, 10);
        const days = Number(args.days || 0);
        const includeOverdue = !!args.include_overdue;

        let endDate = date;
        if (days > 0) {
          // Calculate end date if range specified
          const endDateObj = new Date(date);
          endDateObj.setDate(endDateObj.getDate() + days);
          endDate = endDateObj.toISOString().split('T')[0];
        }

        // INTELLIGENT CHAINING: Use TimelineExecutor for intelligent filtering
        // Automatically filters by date range, enriches with person/project details
        const p = await projectByName(ctx, args.project || "[current]");
        const result = await intelligent.executeTimeline(ctx, p.id, date, endDate);

        // Format results with overdue indicator
        const formattedTodos = result.todos.map(group => ({
          ...group,
          todos: (group.todos || []).map(t => ({
            ...t,
            overdue: !!(t.due_on && t.due_on < date)
          }))
        }));

        return ok(id, {
          project: p.name,
          date_range: { start: date, end: endDate },
          count: result.count,
          todos: formattedTodos,
          metrics: result._metadata
        });
      } catch (e) {
        console.error(`[list_todos_due] Error:`, e.message);
        // Fallback to original implementation
        try {
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

          return ok(id, { date, count: todos.length, todos, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_TODOS_DUE_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "search_todos") {
      const q = String(args.query || "").trim();
      if (!q) return ok(id, { query: "", count: 0, todos: [] });

      const cacheKey = `search:${ctx.accountId}:${q}`;
      const cached = cacheGet(cacheKey);
      if (cached) return ok(id, { cached: true, ...cached });

      try {
        // INTELLIGENT CHAINING: Search with automatic enrichment
        // Detects assignee_ids and automatically fetches person objects
        const result = await intelligent.executeIntelligentSearch(ctx, q);
        
        const response = cacheSet(cacheKey, { 
          query: args.query, 
          count: result.count, 
          todos: result.items 
        });
        return ok(id, { ...response, source: "intelligent_api", metrics: result._metadata });
      } catch (e) {
        console.error(`[search_todos] Intelligent search failed:`, e.message);
        
        // Fallback: Traditional search without enrichment
        try {
          const results = await searchRecordings(ctx, q, { type: "Todo" });
          const todos = results.map((r) => ({
            id: r.id,
            title: r.title,
            content: r.title,
            type: "Todo",
            bucket: r.bucket,
            app_url: r.app_url
          }));
          const response = cacheSet(cacheKey, { query: args.query, count: todos.length, todos });
          return ok(id, { ...response, source: "fallback_search" });
        } catch (fallbackErr) {
          console.error(`[search_todos] Fallback also failed:`, fallbackErr.message);
          return ok(id, { query: args.query, count: 0, todos: [], error: fallbackErr.message });
        }
      }
    }

    if (name === "assignment_report") {
      try {
        const maxTodos = Number(args.max_todos || 250);
        const p = await projectByName(ctx, args.project);
        
        // INTELLIGENT CHAINING: Use specialized executor for assignment pattern
        // Automatically groups by assignee, enriches with person details, aggregates stats
        const result = await intelligent.executeAssignmentReport(ctx, p.id, maxTodos);
        
        return ok(id, {
          project: p.name,
          project_id: p.id,
          by_person: result.by_person,
          summary: {
            total_todos: result.total_todos,
            total_people: result.by_person.length,
            metrics: result._metadata
          }
        });
      } catch (e) {
        console.error(`[assignment_report] Error:`, e.message);
        // Fallback to original implementation
        try {
          const result = await assignmentReport(ctx, args.project, { maxTodos: args.max_todos });
          return ok(id, result);
        } catch (fbErr) {
          return fail(id, { code: "ASSIGNMENT_REPORT_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "get_person_assignments") {
      try {
        const p = await projectByName(ctx, args.project);
        const groups = await listTodosForProject(ctx, p.id);

        const ctx_intel = new RequestContext(ctx, `assignments for ${args.person}`);
        await ctx_intel.preloadEssentials({ loadPeople: true, loadProjects: true });
        const personInput = normalizeQuery(args.person);
        let person = null;
        if (/^\d+$/.test(personInput)) {
          person = ctx_intel.getPerson(Number(personInput));
        }
        if (!person) {
          person = ctx_intel.findPersonByName(args.person);
        }
        if (!person) {
          const allPeople = await listAllPeople(ctx);
          const candidates = (allPeople || []).map((p) => ({ id: p.id, name: p.name }));
          const best = resolveBestEffort(candidates, args.person) || null;
          if (best) person = allPeople.find(p => p.id === best.id) || null;
        }
        if (!person) return ok(id, { error: "Person not found", searched_for: args.person, project: { id: p.id, name: p.name } });

        const todos = groups.flatMap(g => g.todos || []);
        const assigned = todos.filter(t => Array.isArray(t.assignee_ids) && t.assignee_ids.includes(person.id));

        const enricher = intelligent.createEnricher(ctx_intel);
        const enriched = await enricher.formatTodoResults(assigned);

        return ok(id, {
          project: { id: p.id, name: p.name },
          person: { id: person.id, name: person.name, email: person.email_address },
          todos: enriched,
          count: enriched.length,
          metrics: ctx_intel.getMetrics()
        });
      } catch (e) {
        console.error(`[get_person_assignments] Error:`, e.message);
        // Fallback: global scan across all open todos
        try {
          const ctx_intel = new RequestContext(ctx, `assignments for ${args.person}`);
          await ctx_intel.preloadEssentials({ loadPeople: true, loadProjects: true });

          const personInput = normalizeQuery(args.person);
          let person = null;
          if (/^\d+$/.test(personInput)) {
            person = ctx_intel.getPerson(Number(personInput));
          }
          if (!person) {
            person = ctx_intel.findPersonByName(args.person);
          }
          if (!person) {
            const allPeople = await listAllPeople(ctx);
            const candidates = (allPeople || []).map((p) => ({ id: p.id, name: p.name }));
            const best = resolveBestEffort(candidates, args.person) || null;
            if (best) person = allPeople.find(p => p.id === best.id) || null;
          }
          if (!person) return ok(id, { error: "Person not found", searched_for: args.person });

          const rows = await listAllOpenTodos(ctx);
          const todos = rows.map(r => r.raw).filter(Boolean);
          const assigned = todos.filter(t => Array.isArray(t.assignee_ids) && t.assignee_ids.includes(person.id));

          const enricher = intelligent.createEnricher(ctx_intel);
          const enriched = await enricher.formatTodoResults(assigned);

          return ok(id, {
            person: { id: person.id, name: person.name, email: person.email_address },
            todos: enriched,
            count: enriched.length,
            fallback: true,
            metrics: ctx_intel.getMetrics()
          });
        } catch (fbErr) {
          return fail(id, { code: "GET_PERSON_ASSIGNMENTS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_assigned_to_me") {
      try {
        const profile = await getMyProfile(ctx);
        const ctx_intel = new RequestContext(ctx, `assigned to me`);
        await ctx_intel.preloadEssentials({ loadPeople: true, loadProjects: true });

        let todos = [];
        if (args.project) {
          const p = await projectByName(ctx, args.project);
          const groups = await listTodosForProject(ctx, p.id);
          todos = groups.flatMap(g => g.todos || []);
        } else {
          const rows = await listAllOpenTodos(ctx);
          todos = rows.map(r => r.raw).filter(Boolean);
        }

        const assigned = todos.filter(t => Array.isArray(t.assignee_ids) && t.assignee_ids.includes(profile.id));
        const enricher = intelligent.createEnricher(ctx_intel);
        const enriched = await enricher.formatTodoResults(assigned);

        return ok(id, {
          person: { id: profile.id, name: profile.name, email: profile.email },
          project: args.project ? { name: args.project } : null,
          todos: enriched,
          count: enriched.length,
          metrics: ctx_intel.getMetrics()
        });
      } catch (e) {
        console.error(`[list_assigned_to_me] Error:`, e.message);
        // Fallback: global scan across all open todos
        try {
          const profile = await getMyProfile(ctx);
          const ctx_intel = new RequestContext(ctx, `assigned to me fallback`);
          await ctx_intel.preloadEssentials({ loadPeople: true, loadProjects: true });

          const rows = await listAllOpenTodos(ctx);
          const todos = rows.map(r => r.raw).filter(Boolean);
          const assigned = todos.filter(t => Array.isArray(t.assignee_ids) && t.assignee_ids.includes(profile.id));
          const enricher = intelligent.createEnricher(ctx_intel);
          const enriched = await enricher.formatTodoResults(assigned);

          return ok(id, {
            person: { id: profile.id, name: profile.name, email: profile.email },
            todos: enriched,
            count: enriched.length,
            fallback: true,
            metrics: ctx_intel.getMetrics()
          });
        } catch (fbErr) {
          return fail(id, { code: "LIST_ASSIGNED_TO_ME_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "create_todo") {
      try {
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
        if (args.assignee_ids && Array.isArray(args.assignee_ids)) body.assignee_ids = args.assignee_ids;

        let created;
        if (target.todos_url) {
          created = await api(ctx, target.todos_url, { method: "POST", body });
        } else {
          created = await api(ctx, `/buckets/${p.id}/todolists/${target.id}/todos.json`, { method: "POST", body });
        }

        // INTELLIGENT CHAINING: Enrich created todo with person/project details
        let enrichedTodo = created;
        try {
          const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `created todo`);
          const enricher = intelligent.createEnricher(ctx_intel);
          enrichedTodo = await enricher.enrich(created, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          });
        } catch (enrichErr) {
          console.warn(`[create_todo] Enrichment failed, returning raw todo:`, enrichErr.message);
          // Return raw created todo if enrichment fails
        }

        return ok(id, {
          message: "Todo created",
          project: { id: p.id, name: p.name },
          todolist: { id: target.id, name: target.name },
          todo: enrichedTodo
        });
      } catch (e) {
        console.error(`[create_todo] Error:`, e.message);
        return fail(id, { code: "CREATE_TODO_ERROR", message: e.message });
      }
    }

    if (name === "update_todo_details") {
      try {
        const p = await projectByName(ctx, args.project);
        const updated = await updateTodoDetails(ctx, p.id, Number(args.todo_id), {
          content: args.content,
          description: args.description,
          assignee_ids: args.assignee_ids,
          completion_subscriber_ids: args.completion_subscriber_ids,
          notify: args.notify,
          due_on: args.due_on,
          starts_on: args.starts_on
        });

        const ctx_intel = new RequestContext(ctx, `updated todo`);
        await ctx_intel.preloadEssentials({ loadPeople: true, loadProjects: true });
        const enricher = intelligent.createEnricher(ctx_intel);
        const enriched = await enricher.enrich(updated, {
          getPerson: (id) => ctx_intel.getPerson(id),
          getProject: (id) => ctx_intel.getProject(id)
        });

        return ok(id, { project: { id: p.id, name: p.name }, todo: enriched, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[update_todo_details] Error:`, e.message);
        // Fallback: return existing todo if update failed
        try {
          const p = await projectByName(ctx, args.project);
          const existing = await api(ctx, `/buckets/${p.id}/todos/${Number(args.todo_id)}.json`);
          const ctx_intel = new RequestContext(ctx, `updated todo fallback`);
          await ctx_intel.preloadEssentials({ loadPeople: true, loadProjects: true });
          const enricher = intelligent.createEnricher(ctx_intel);
          const enriched = await enricher.enrich(existing, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          });
          return ok(id, { project: { id: p.id, name: p.name }, todo: enriched, fallback: true, metrics: ctx_intel.getMetrics() });
        } catch (fbErr) {
          return fail(id, { code: "UPDATE_TODO_DETAILS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "smart_action") {
      const query = normalizeQuery(args.query);
      if (!query) return fail(id, { code: "BAD_REQUEST", message: "Missing query." });

      try {
        const analysis = intelligent.analyzeQuery(query);
        const lower = query.toLowerCase();

        // Quick intent rules
        if (lower.includes("daily report")) {
          const date = analysis.constraints.dueDate || new Date().toISOString().slice(0, 10);
          const result = await intelligent.executeDailyReport(ctx, date);
          return ok(id, { query, action: "daily_report", result });
        }

        if (lower.includes("assigned to me") || lower.includes("my todos")) {
          const result = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "list_assigned_to_me", arguments: { project: args.project } } }, ctx);
          return ok(id, { query, action: "list_assigned_to_me", result: result?.result ?? result });
        }

        if (analysis.pattern === "person_finder" && analysis.personNames.length) {
          const person = analysis.personNames[0];
          if (args.project) {
            const result = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "get_person_assignments", arguments: { project: args.project, person } } }, ctx);
            return ok(id, { query, action: "get_person_assignments", result: result?.result ?? result });
          }
        }

        if (analysis.constraints.dueDate) {
          if (args.project) {
            const result = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "list_todos_due", arguments: { date: analysis.constraints.dueDate, include_overdue: lower.includes("overdue"), project: args.project } } }, ctx);
            return ok(id, { query, action: "list_todos_due", result: result?.result ?? result });
          }
          const rows = await listAllOpenTodos(ctx);
          const todos = rows.filter(r => r.due_on === analysis.constraints.dueDate).map(r => r.raw).filter(Boolean);
          return ok(id, { query, action: "list_todos_due_fallback", date: analysis.constraints.dueDate, todos, count: todos.length });
        }

        if (analysis.pattern === "assignment" && args.project) {
          const result = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "assignment_report", arguments: { project: args.project } } }, ctx);
          return ok(id, { query, action: "assignment_report", result: result?.result ?? result });
        }

        if (analysis.pattern === "search_enrich" || lower.includes("search") || lower.includes("find")) {
          if (args.project) {
            const result = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_project", arguments: { project: args.project, query } } }, ctx);
            return ok(id, { query, action: "search_project", result: result?.result ?? result });
          }
          const result = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_recordings", arguments: { query } } }, ctx);
          return ok(id, { query, action: "search_recordings", result: result?.result ?? result });
        }

        // Default: global search
        const result = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_recordings", arguments: { query } } }, ctx);
        return ok(id, { query, action: "search_recordings", result: result?.result ?? result });
      } catch (e) {
        console.error(`[smart_action] Error:`, e.message);
        try {
          const result = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_recordings", arguments: { query } } }, ctx);
          return ok(id, { query, action: "search_recordings", result: result?.result ?? result, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "SMART_ACTION_ERROR", message: fbErr.message });
        }
      }
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
      try {
        const p = await projectByName(ctx, args.project);
        const tables = await listCardTables(ctx, p.id);

        // INTELLIGENT CHAINING: Enrich card tables with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `card tables for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedTables = await Promise.all(
          (tables || []).map(t => enricher.enrich({ ...t, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, card_tables: enrichedTables, count: enrichedTables.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_card_tables] Error:`, e.message);
        // Fallback to non-enriched card tables
        try {
          const p = await projectByName(ctx, args.project);
          const tables = await listCardTables(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, card_tables: tables, count: tables.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_CARD_TABLES_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_card_table_columns") {
      try {
        const p = await projectByName(ctx, args.project);
        const cols = await listCardTableColumns(ctx, p.id, Number(args.card_table_id));

        // INTELLIGENT CHAINING: Enrich columns with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `card table columns ${args.card_table_id}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedCols = await Promise.all(
          (cols || []).map(c => enricher.enrich({ ...c, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, columns: enrichedCols, count: enrichedCols.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_card_table_columns] Error:`, e.message);
        // Fallback to non-enriched columns
        try {
          const p = await projectByName(ctx, args.project);
          const cols = await listCardTableColumns(ctx, p.id, Number(args.card_table_id));
          return ok(id, { project: { id: p.id, name: p.name }, columns: cols, count: cols.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_CARD_TABLE_COLUMNS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_card_table_cards") {
      try {
        const p = await projectByName(ctx, args.project);
        const cards = await listCardTableCards(ctx, p.id, Number(args.card_table_id));

        // INTELLIGENT CHAINING: Enrich cards with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `card table ${args.card_table_id}`);
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedCards = await Promise.all(
          (cards || []).map(c => enricher.enrich({ ...c, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, cards: enrichedCards, count: enrichedCards.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_card_table_cards] Error:`, e.message);
        // Fallback to non-enriched cards
        try {
          const p = await projectByName(ctx, args.project);
          const cards = await listCardTableCards(ctx, p.id, Number(args.card_table_id));
          return ok(id, { project: { id: p.id, name: p.name }, cards, count: cards.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_CARD_TABLE_CARDS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "create_card") {
      try {
        const p = await projectByName(ctx, args.project);
        const card = await createCard(ctx, p.id, Number(args.card_table_id), {
          title: args.title,
          content: args.content,
          column_id: args.column_id,
          due_on: args.due_on
        });

        // INTELLIGENT CHAINING: Enrich created card with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `created card`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedCard = await enricher.enrich({ ...card, bucket: { id: p.id, name: p.name } }, {
          getPerson: (id) => ctx_intel.getPerson(id),
          getProject: (id) => ctx_intel.getProject(id)
        });

        return ok(id, { message: "Card created", project: { id: p.id, name: p.name }, card: enrichedCard, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[create_card] Error:`, e.message);
        // Fallback to non-enriched card
        try {
          const p = await projectByName(ctx, args.project);
          const card = await createCard(ctx, p.id, Number(args.card_table_id), {
            title: args.title,
            content: args.content,
            column_id: args.column_id,
            due_on: args.due_on
          });
          return ok(id, { message: "Card created", project: { id: p.id, name: p.name }, card, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "CREATE_CARD_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "move_card") {
      try {
        const p = await projectByName(ctx, args.project);
        const card = await moveCard(ctx, p.id, Number(args.card_id), { column_id: args.column_id, position: args.position });

        // INTELLIGENT CHAINING: Enrich moved card with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `moved card ${args.card_id}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedCard = await enricher.enrich({ ...card, bucket: { id: p.id, name: p.name } }, {
          getPerson: (id) => ctx_intel.getPerson(id),
          getProject: (id) => ctx_intel.getProject(id)
        });

        return ok(id, { message: "Card updated", project: { id: p.id, name: p.name }, card: enrichedCard, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[move_card] Error:`, e.message);
        // Fallback to non-enriched card
        try {
          const p = await projectByName(ctx, args.project);
          const card = await moveCard(ctx, p.id, Number(args.card_id), { column_id: args.column_id, position: args.position });
          return ok(id, { message: "Card updated", project: { id: p.id, name: p.name }, card, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "MOVE_CARD_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_card_steps") {
      try {
        const p = await projectByName(ctx, args.project);
        const steps = await listCardSteps(ctx, p.id, Number(args.card_id));
        return ok(id, { project: { id: p.id, name: p.name }, card_id: Number(args.card_id), steps, count: steps.length });
      } catch (e) {
        console.error(`[list_card_steps] Error:`, e.message);
        return ok(id, { steps: [], fallback: true });
      }
    }

    if (name === "create_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        const step = await createCardStep(ctx, p.id, Number(args.card_id), args.body || {});
        return ok(id, { message: "Card step created", project: { id: p.id, name: p.name }, step });
      } catch (e) {
        return fail(id, { code: "CREATE_CARD_STEP_ERROR", message: e.message });
      }
    }

    if (name === "update_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        const step = await updateCardStep(ctx, p.id, Number(args.step_id), args.body || {});
        return ok(id, { message: "Card step updated", project: { id: p.id, name: p.name }, step });
      } catch (e) {
        return fail(id, { code: "UPDATE_CARD_STEP_ERROR", message: e.message });
      }
    }

    if (name === "complete_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await completeCardStep(ctx, p.id, Number(args.step_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "COMPLETE_CARD_STEP_ERROR", message: e.message });
      }
    }

    if (name === "uncomplete_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await uncompleteCardStep(ctx, p.id, Number(args.step_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "UNCOMPLETE_CARD_STEP_ERROR", message: e.message });
      }
    }

    if (name === "reposition_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await repositionCardStep(ctx, p.id, Number(args.card_id), Number(args.step_id), Number(args.position));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "REPOSITION_CARD_STEP_ERROR", message: e.message });
      }
    }

    // Hill charts
    if (name === "get_hill_chart") {
      try {
        const p = await projectByName(ctx, args.project);
        const hill = await getHillChartFromDock(ctx, p.id);
        if (!hill) return fail(id, { code: "TOOL_NOT_ENABLED", message: "Hill chart not enabled for this project (or not accessible)." });

        // INTELLIGENT CHAINING: Enrich hill chart with project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `hill chart for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedHill = await enricher.enrich({ ...hill, bucket: { id: p.id, name: p.name } }, {
          getPerson: (id) => ctx_intel.getPerson(id),
          getProject: (id) => ctx_intel.getProject(id)
        });

        return ok(id, { project: { id: p.id, name: p.name }, hill_chart: enrichedHill, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[get_hill_chart] Error:`, e.message);
        // Fallback to non-enriched hill chart
        try {
          const p = await projectByName(ctx, args.project);
          const hill = await getHillChartFromDock(ctx, p.id);
          if (!hill) return fail(id, { code: "TOOL_NOT_ENABLED", message: "Hill chart not enabled for this project (or not accessible)." });
          return ok(id, { project: { id: p.id, name: p.name }, hill_chart: hill, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "GET_HILL_CHART_ERROR", message: fbErr.message });
        }
      }
    }

    // Messages / Docs / Schedule (dock-driven)
    if (name === "list_message_boards") {
      try {
        const p = await projectByName(ctx, args.project);
        const boards = await listMessageBoards(ctx, p.id);

        // INTELLIGENT CHAINING: Enrich message boards with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `message boards for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedBoards = await Promise.all(
          (boards || []).map(b => enricher.enrich({ ...b, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, message_boards: enrichedBoards, count: enrichedBoards.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_message_boards] Error:`, e.message);
        // Fallback to non-enriched message boards
        try {
          const p = await projectByName(ctx, args.project);
          const boards = await listMessageBoards(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, message_boards: boards, count: boards.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_MESSAGE_BOARDS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_messages") {
      try {
        const p = await projectByName(ctx, args.project);
        const msgs = await listMessages(ctx, p.id, { board_id: args.message_board_id });

        // INTELLIGENT CHAINING: Enrich messages with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `messages for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedMessages = await Promise.all(
          msgs.map(m => enricher.enrich({ ...m, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, messages: enrichedMessages, count: enrichedMessages.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_messages] Error:`, e.message);
        // Fallback to non-enriched messages
        try {
          const p = await projectByName(ctx, args.project);
          const msgs = await listMessages(ctx, p.id, { board_id: args.message_board_id });
          return ok(id, { project: { id: p.id, name: p.name }, messages: msgs, count: msgs.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_MESSAGES_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "get_message_board") {
      try {
        const p = await projectByName(ctx, args.project);
        const board = await getMessageBoard(ctx, p.id, Number(args.message_board_id));
        return ok(id, { project: { id: p.id, name: p.name }, message_board: board });
      } catch (e) {
        return fail(id, { code: "GET_MESSAGE_BOARD_ERROR", message: e.message });
      }
    }

    if (name === "get_message") {
      try {
        const p = await projectByName(ctx, args.project);
        const message = await getMessage(ctx, p.id, Number(args.message_id));
        return ok(id, { project: { id: p.id, name: p.name }, message });
      } catch (e) {
        return fail(id, { code: "GET_MESSAGE_ERROR", message: e.message });
      }
    }

    if (name === "create_message") {
      try {
        const p = await projectByName(ctx, args.project);
        const message = await createMessage(ctx, p.id, Number(args.message_board_id), args.body || {});
        return ok(id, { message: "Message created", project: { id: p.id, name: p.name }, message });
      } catch (e) {
        return fail(id, { code: "CREATE_MESSAGE_ERROR", message: e.message });
      }
    }

    if (name === "update_message") {
      try {
        const p = await projectByName(ctx, args.project);
        const message = await updateMessage(ctx, p.id, Number(args.message_id), args.body || {});
        return ok(id, { message: "Message updated", project: { id: p.id, name: p.name }, message });
      } catch (e) {
        return fail(id, { code: "UPDATE_MESSAGE_ERROR", message: e.message });
      }
    }

    if (name === "list_message_types") {
      try {
        const p = await projectByName(ctx, args.project);
        const types = await listMessageTypes(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, types, count: types.length });
      } catch (e) {
        console.error(`[list_message_types] Error:`, e.message);
        return ok(id, { types: [], fallback: true });
      }
    }

    if (name === "get_message_type") {
      try {
        const p = await projectByName(ctx, args.project);
        const category = await getMessageType(ctx, p.id, Number(args.category_id));
        return ok(id, { project: { id: p.id, name: p.name }, message_type: category });
      } catch (e) {
        return fail(id, { code: "GET_MESSAGE_TYPE_ERROR", message: e.message });
      }
    }

    if (name === "create_message_type") {
      try {
        const p = await projectByName(ctx, args.project);
        const category = await createMessageType(ctx, p.id, args.body || {});
        return ok(id, { message: "Message type created", project: { id: p.id, name: p.name }, message_type: category });
      } catch (e) {
        return fail(id, { code: "CREATE_MESSAGE_TYPE_ERROR", message: e.message });
      }
    }

    if (name === "update_message_type") {
      try {
        const p = await projectByName(ctx, args.project);
        const category = await updateMessageType(ctx, p.id, Number(args.category_id), args.body || {});
        return ok(id, { message: "Message type updated", project: { id: p.id, name: p.name }, message_type: category });
      } catch (e) {
        return fail(id, { code: "UPDATE_MESSAGE_TYPE_ERROR", message: e.message });
      }
    }

    if (name === "delete_message_type") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await deleteMessageType(ctx, p.id, Number(args.category_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "DELETE_MESSAGE_TYPE_ERROR", message: e.message });
      }
    }

    if (name === "pin_recording") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await pinRecording(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "PIN_RECORDING_ERROR", message: e.message });
      }
    }

    if (name === "unpin_recording") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await unpinRecording(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "UNPIN_RECORDING_ERROR", message: e.message });
      }
    }

    if (name === "list_client_correspondences") {
      try {
        const p = await projectByName(ctx, args.project);
        const items = await listClientCorrespondences(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, correspondences: items, count: items.length });
      } catch (e) {
        console.error(`[list_client_correspondences] Error:`, e.message);
        return ok(id, { correspondences: [], fallback: true });
      }
    }

    if (name === "get_client_correspondence") {
      try {
        const p = await projectByName(ctx, args.project);
        const item = await getClientCorrespondence(ctx, p.id, Number(args.correspondence_id));
        return ok(id, { project: { id: p.id, name: p.name }, correspondence: item });
      } catch (e) {
        return fail(id, { code: "GET_CLIENT_CORRESPONDENCE_ERROR", message: e.message });
      }
    }

    if (name === "list_client_approvals") {
      try {
        const p = await projectByName(ctx, args.project);
        const items = await listClientApprovals(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, approvals: items, count: items.length });
      } catch (e) {
        console.error(`[list_client_approvals] Error:`, e.message);
        return ok(id, { approvals: [], fallback: true });
      }
    }

    if (name === "get_client_approval") {
      try {
        const p = await projectByName(ctx, args.project);
        const item = await getClientApproval(ctx, p.id, Number(args.approval_id));
        return ok(id, { project: { id: p.id, name: p.name }, approval: item });
      } catch (e) {
        return fail(id, { code: "GET_CLIENT_APPROVAL_ERROR", message: e.message });
      }
    }

    if (name === "list_client_replies") {
      try {
        const p = await projectByName(ctx, args.project);
        const items = await listClientReplies(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, recording_id: Number(args.recording_id), replies: items, count: items.length });
      } catch (e) {
        console.error(`[list_client_replies] Error:`, e.message);
        return ok(id, { replies: [], fallback: true });
      }
    }

    if (name === "get_client_reply") {
      try {
        const p = await projectByName(ctx, args.project);
        const item = await getClientReply(ctx, p.id, Number(args.recording_id), Number(args.reply_id));
        return ok(id, { project: { id: p.id, name: p.name }, reply: item });
      } catch (e) {
        return fail(id, { code: "GET_CLIENT_REPLY_ERROR", message: e.message });
      }
    }

    if (name === "list_documents") {
      try {
        const p = await projectByName(ctx, args.project);
        const docs = await listDocuments(ctx, p.id);

        // INTELLIGENT CHAINING: Enrich documents with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `documents for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedDocs = await Promise.all(
          docs.map(d => enricher.enrich({ ...d, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, documents: enrichedDocs, count: enrichedDocs.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_documents] Error:`, e.message);
        // Fallback to non-enriched documents
        try {
          const p = await projectByName(ctx, args.project);
          const docs = await listDocuments(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, documents: docs, count: docs.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_DOCUMENTS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "get_document") {
      try {
        const p = await projectByName(ctx, args.project);
        const doc = await getDocument(ctx, p.id, Number(args.document_id));
        return ok(id, { project: { id: p.id, name: p.name }, document: doc });
      } catch (e) {
        return fail(id, { code: "GET_DOCUMENT_ERROR", message: e.message });
      }
    }

    if (name === "create_document") {
      try {
        const p = await projectByName(ctx, args.project);
        const doc = await createDocument(ctx, p.id, Number(args.vault_id), args.body || {});
        return ok(id, { message: "Document created", project: { id: p.id, name: p.name }, document: doc });
      } catch (e) {
        return fail(id, { code: "CREATE_DOCUMENT_ERROR", message: e.message });
      }
    }

    if (name === "update_document") {
      try {
        const p = await projectByName(ctx, args.project);
        const doc = await updateDocument(ctx, p.id, Number(args.document_id), args.body || {});
        return ok(id, { message: "Document updated", project: { id: p.id, name: p.name }, document: doc });
      } catch (e) {
        return fail(id, { code: "UPDATE_DOCUMENT_ERROR", message: e.message });
      }
    }

    if (name === "create_upload") {
      try {
        const p = await projectByName(ctx, args.project);
        const upload = await createUpload(ctx, p.id, Number(args.vault_id), args.body || {});
        return ok(id, { message: "Upload created", project: { id: p.id, name: p.name }, upload });
      } catch (e) {
        return fail(id, { code: "CREATE_UPLOAD_ERROR", message: e.message });
      }
    }

    if (name === "update_upload") {
      try {
        const p = await projectByName(ctx, args.project);
        const upload = await updateUpload(ctx, p.id, Number(args.upload_id), args.body || {});
        return ok(id, { message: "Upload updated", project: { id: p.id, name: p.name }, upload });
      } catch (e) {
        return fail(id, { code: "UPDATE_UPLOAD_ERROR", message: e.message });
      }
    }

    if (name === "list_child_vaults") {
      try {
        const p = await projectByName(ctx, args.project);
        const vaults = await listChildVaults(ctx, p.id, Number(args.vault_id));
        return ok(id, { project: { id: p.id, name: p.name }, vault_id: Number(args.vault_id), vaults, count: vaults.length });
      } catch (e) {
        console.error(`[list_child_vaults] Error:`, e.message);
        return ok(id, { vaults: [], fallback: true });
      }
    }

    if (name === "create_child_vault") {
      try {
        const p = await projectByName(ctx, args.project);
        const vault = await createChildVault(ctx, p.id, Number(args.vault_id), args.body || {});
        return ok(id, { message: "Child vault created", project: { id: p.id, name: p.name }, vault });
      } catch (e) {
        return fail(id, { code: "CREATE_CHILD_VAULT_ERROR", message: e.message });
      }
    }

    if (name === "update_vault") {
      try {
        const p = await projectByName(ctx, args.project);
        const vault = await updateVault(ctx, p.id, Number(args.vault_id), args.body || {});
        return ok(id, { message: "Vault updated", project: { id: p.id, name: p.name }, vault });
      } catch (e) {
        return fail(id, { code: "UPDATE_VAULT_ERROR", message: e.message });
      }
    }

    if (name === "list_schedule_entries") {
      try {
        const p = await projectByName(ctx, args.project);
        const entries = await listScheduleEntries(ctx, p.id, { from: args.from, to: args.to });

        // INTELLIGENT CHAINING: Enrich schedule entries with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `schedule entries for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedEntries = await Promise.all(
          entries.map(e => enricher.enrich({ ...e, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, schedule_entries: enrichedEntries, count: enrichedEntries.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_schedule_entries] Error:`, e.message);
        // Fallback to non-enriched schedule entries
        try {
          const p = await projectByName(ctx, args.project);
          const entries = await listScheduleEntries(ctx, p.id, { from: args.from, to: args.to });
          return ok(id, { project: { id: p.id, name: p.name }, schedule_entries: entries, count: entries.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_SCHEDULE_ENTRIES_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "search_project") {
      try {
        const p = await projectByName(ctx, args.project);
        const results = await searchProject(ctx, p.id, { query: args.query });
        
        // INTELLIGENT CHAINING: Enrich search results with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, args.query);
        const enricher = intelligent.createEnricher(ctx_intel);
        
        let enrichedResults = results;
        if (Array.isArray(results)) {
          enrichedResults = await Promise.all(
            results.map(r => enricher.enrich(r, {
              getPerson: (id) => ctx_intel.getPerson(id),
              getProject: (id) => ctx_intel.getProject(id)
            }))
          );
        }
        
        return ok(id, { 
          project: { id: p.id, name: p.name }, 
          query: args.query, 
          results: enrichedResults,
          count: enrichedResults.length,
          metrics: ctx_intel.getMetrics()
        });
      } catch (e) {
        console.error(`[search_project] Error:`, e.message);
        // Fallback to non-enriched search
        try {
          const p = await projectByName(ctx, args.project);
          const results = await searchProject(ctx, p.id, { query: args.query });
          return ok(id, { project: { id: p.id, name: p.name }, query: args.query, results, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "SEARCH_PROJECT_ERROR", message: fbErr.message });
        }
      }
    }

    // ===== NEW PEOPLE ENDPOINTS =====
    if (name === "list_all_people") {
      try {
        const people = await listAllPeople(ctx);

        // INTELLIGENT CHAINING: Provide metrics for consistency
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `list all people`);
        return ok(id, { people, count: people.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_all_people] Error:`, e.message);
        try {
          const people = await listAllPeople(ctx);
          return ok(id, { people, count: people.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_ALL_PEOPLE_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_pingable_people") {
      try {
        const people = await listPingablePeople(ctx);
        return ok(id, { people, count: people.length });
      } catch (e) {
        return fail(id, { code: "LIST_PINGABLE_PEOPLE_ERROR", message: e.message });
      }
    }

    if (name === "get_person") {
      try {
        const person = await getPerson(ctx, args.person_id);

        // INTELLIGENT CHAINING: Provide metrics for consistency
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `person ${args.person_id}`);
        return ok(id, { ...person, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[get_person] Error:`, e.message);
        try {
          const person = await getPerson(ctx, args.person_id);
          return ok(id, { ...person, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "GET_PERSON_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "get_my_profile") {
      try {
        const profile = await getMyProfile(ctx);

        // INTELLIGENT CHAINING: Provide metrics for consistency
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `my profile`);
        return ok(id, { ...profile, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[get_my_profile] Error:`, e.message);
        try {
          const profile = await getMyProfile(ctx);
          return ok(id, { ...profile, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "GET_MY_PROFILE_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_project_people") {
      try {
        const p = await projectByName(ctx, args.project);
        const people = await listProjectPeople(ctx, p.id);

        // INTELLIGENT CHAINING: Provide metrics and project context
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `people for ${p.name}`);
        const enrichedPeople = people.map((person) => ({
          ...person,
          bucket: { id: p.id, name: p.name }
        }));

        return ok(id, { project: { id: p.id, name: p.name }, people: enrichedPeople, count: enrichedPeople.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_project_people] Error:`, e.message);
        try {
          const p = await projectByName(ctx, args.project);
          const people = await listProjectPeople(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, people, count: people.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_PROJECT_PEOPLE_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "update_project_people") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await updateProjectPeople(ctx, p.id, args.body || {});
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        return fail(id, { code: "UPDATE_PROJECT_PEOPLE_ERROR", message: e.message });
      }
    }

    // ===== NEW COMMENTS ENDPOINTS =====
    if (name === "list_comments") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await listComments(ctx, p.id, args.recording_id);
        const comments = result.comments || [];

        // INTELLIGENT CHAINING: Enrich comments with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `comments for ${args.recording_id}`);
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedComments = await Promise.all(
          comments.map(c => enricher.enrich(c, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, {
          project: { id: p.id, name: p.name },
          recording_id: args.recording_id,
          comments: enrichedComments,
          count: enrichedComments.length,
          _meta: result._meta,
          metrics: ctx_intel.getMetrics()
        });
      } catch (e) {
        console.error(`[list_comments] Error:`, e.message);
        // Fallback to non-enriched comments
        try {
          const p = await projectByName(ctx, args.project);
          const result = await listComments(ctx, p.id, args.recording_id);
          const comments = result.comments || [];
          return ok(id, { project: { id: p.id, name: p.name }, recording_id: args.recording_id, comments, count: comments.length, _meta: result._meta, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_COMMENTS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "get_comment") {
      try {
        const p = await projectByName(ctx, args.project);
        const comment = await getComment(ctx, p.id, args.comment_id);

        // INTELLIGENT CHAINING: Enrich comment with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `comment ${args.comment_id}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedComment = await enricher.enrich({ ...comment, bucket: { id: p.id, name: p.name } }, {
          getPerson: (id) => ctx_intel.getPerson(id),
          getProject: (id) => ctx_intel.getProject(id)
        });

        return ok(id, { ...enrichedComment, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[get_comment] Error:`, e.message);
        // Fallback to non-enriched comment
        try {
          const p = await projectByName(ctx, args.project);
          const comment = await getComment(ctx, p.id, args.comment_id);
          return ok(id, { ...comment, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "GET_COMMENT_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "create_comment") {
      try {
        const p = await projectByName(ctx, args.project);
        const comment = await createComment(ctx, p.id, args.recording_id, args.content);

        // INTELLIGENT CHAINING: Enrich created comment with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `created comment`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedComment = await enricher.enrich({ ...comment, bucket: { id: p.id, name: p.name } }, {
          getPerson: (id) => ctx_intel.getPerson(id),
          getProject: (id) => ctx_intel.getProject(id)
        });

        return ok(id, { message: "Comment created", project: { id: p.id, name: p.name }, comment: enrichedComment, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[create_comment] Error:`, e.message);
        // Fallback to non-enriched comment
        try {
          const p = await projectByName(ctx, args.project);
          const comment = await createComment(ctx, p.id, args.recording_id, args.content);
          return ok(id, { message: "Comment created", project: { id: p.id, name: p.name }, comment, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "CREATE_COMMENT_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "update_comment") {
      try {
        const p = await projectByName(ctx, args.project);
        const comment = await updateComment(ctx, p.id, args.comment_id, args.content);
        return ok(id, { message: "Comment updated", project: { id: p.id, name: p.name }, comment });
      } catch (e) {
        return fail(id, { code: "UPDATE_COMMENT_ERROR", message: e.message });
      }
    }

    // ===== NEW UPLOADS ENDPOINTS =====
    if (name === "list_uploads") {
      try {
        const p = await projectByName(ctx, args.project);
        const vaults = await listVaults(ctx, p.id);
        const vaultId = args.vault_id || (vaults?.[0]?.id);
        if (!vaultId) return fail(id, { code: "NO_VAULT", message: "No vault found for this project." });
        const uploads = await listUploads(ctx, p.id, vaultId);

        // INTELLIGENT CHAINING: Enrich uploads with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `uploads for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedUploads = await Promise.all(
          uploads.map(u => enricher.enrich({ ...u, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, vault_id: vaultId, uploads: enrichedUploads, count: enrichedUploads.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_uploads] Error:`, e.message);
        // Fallback to non-enriched uploads
        try {
          const p = await projectByName(ctx, args.project);
          const vaults = await listVaults(ctx, p.id);
          const vaultId = args.vault_id || (vaults?.[0]?.id);
          if (!vaultId) return fail(id, { code: "NO_VAULT", message: "No vault found for this project." });
          const uploads = await listUploads(ctx, p.id, vaultId);
          return ok(id, { project: { id: p.id, name: p.name }, vault_id: vaultId, uploads, count: uploads.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_UPLOADS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "get_upload") {
      try {
        const p = await projectByName(ctx, args.project);
        const upload = await getUpload(ctx, p.id, args.upload_id);

        // INTELLIGENT CHAINING: Enrich upload with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `upload ${args.upload_id}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedUpload = await enricher.enrich({ ...upload, bucket: { id: p.id, name: p.name } }, {
          getPerson: (id) => ctx_intel.getPerson(id),
          getProject: (id) => ctx_intel.getProject(id)
        });

        return ok(id, { ...enrichedUpload, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[get_upload] Error:`, e.message);
        // Fallback to non-enriched upload
        try {
          const p = await projectByName(ctx, args.project);
          const upload = await getUpload(ctx, p.id, args.upload_id);
          return ok(id, { ...upload, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "GET_UPLOAD_ERROR", message: fbErr.message });
        }
      }
    }

    // ===== NEW RECORDINGS ENDPOINTS =====
    if (name === "get_recordings") {
      try {
        const recordings = await getRecordings(ctx, args.type, { bucket: args.bucket, status: args.status });

        // INTELLIGENT CHAINING: Enrich recordings with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `recordings ${args.type || ""}`.trim());
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedRecordings = await Promise.all(
          recordings.map(r => enricher.enrich(r, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { type: args.type, recordings: enrichedRecordings, count: enrichedRecordings.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[get_recordings] Error:`, e.message);
        // Fallback to non-enriched recordings
        try {
          const recordings = await getRecordings(ctx, args.type, { bucket: args.bucket, status: args.status });
          return ok(id, { type: args.type, recordings, count: recordings.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "GET_RECORDINGS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "trash_recording") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await trashRecording(ctx, p.id, args.recording_id);

        // INTELLIGENT CHAINING: Provide metrics for consistency
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `trash recording ${args.recording_id}`);
        return ok(id, { ...result, project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[trash_recording] Error:`, e.message);
        try {
          const p = await projectByName(ctx, args.project);
          const result = await trashRecording(ctx, p.id, args.recording_id);
          return ok(id, { ...result, project: { id: p.id, name: p.name }, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "TRASH_RECORDING_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "archive_recording") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await archiveRecording(ctx, p.id, args.recording_id);

        // INTELLIGENT CHAINING: Provide metrics for consistency
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `archive recording ${args.recording_id}`);
        return ok(id, { ...result, project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[archive_recording] Error:`, e.message);
        try {
          const p = await projectByName(ctx, args.project);
          const result = await archiveRecording(ctx, p.id, args.recording_id);
          return ok(id, { ...result, project: { id: p.id, name: p.name }, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "ARCHIVE_RECORDING_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "unarchive_recording") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await unarchiveRecording(ctx, p.id, args.recording_id);

        // INTELLIGENT CHAINING: Provide metrics for consistency
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `unarchive recording ${args.recording_id}`);
        return ok(id, { ...result, project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[unarchive_recording] Error:`, e.message);
        try {
          const p = await projectByName(ctx, args.project);
          const result = await unarchiveRecording(ctx, p.id, args.recording_id);
          return ok(id, { ...result, project: { id: p.id, name: p.name }, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "UNARCHIVE_RECORDING_ERROR", message: fbErr.message });
        }
      }
    }

    // ===== NEW VAULT ENDPOINTS =====
    if (name === "list_vaults") {
      try {
        const p = await projectByName(ctx, args.project);
        const vaults = await listVaults(ctx, p.id);

        // INTELLIGENT CHAINING: Enrich vaults with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `vaults for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedVaults = await Promise.all(
          (vaults || []).map(v => enricher.enrich({ ...v, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, vaults: enrichedVaults, count: enrichedVaults.length, metrics: ctx_intel.getMetrics() });
      } catch (e) {
        console.error(`[list_vaults] Error:`, e.message);
        // Fallback to non-enriched vaults
        try {
          const p = await projectByName(ctx, args.project);
          const vaults = await listVaults(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, vaults, count: vaults.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "LIST_VAULTS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_campfires") {
      try {
        const projectName = args.project || null;
        if (!projectName) {
          const chats = await listCampfires(ctx, null);
          return ok(id, { campfires: chats, count: chats.length });
        }
        const p = await projectByName(ctx, projectName);
        const chats = await listCampfires(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, campfires: chats, count: chats.length });
      } catch (e) {
        console.error(`[list_campfires] Error:`, e.message);
        return ok(id, { campfires: [], fallback: true });
      }
    }

    if (name === "get_campfire") {
      try {
        const p = await projectByName(ctx, args.project);
        const chat = await resolveCampfire(ctx, p.id, args.chat_id ? Number(args.chat_id) : null);
        if (!chat) return fail(id, { code: "CAMPFIRE_NOT_FOUND", message: "Campfire not found or not enabled." });
        return ok(id, { project: { id: p.id, name: p.name }, campfire: chat });
      } catch (e) {
        return fail(id, { code: "GET_CAMPFIRE_ERROR", message: e.message });
      }
    }

    if (name === "list_campfire_lines") {
      try {
        const p = await projectByName(ctx, args.project);
        const lines = await listCampfireLines(ctx, p.id, Number(args.chat_id), { limit: args.limit });
        return ok(id, { project: { id: p.id, name: p.name }, chat_id: Number(args.chat_id), lines, count: lines.length });
      } catch (e) {
        return fail(id, { code: "LIST_CAMPFIRE_LINES_ERROR", message: e.message });
      }
    }

    if (name === "get_campfire_line") {
      try {
        const p = await projectByName(ctx, args.project);
        const line = await getCampfireLine(ctx, p.id, Number(args.chat_id), Number(args.line_id));
        return ok(id, { project: { id: p.id, name: p.name }, chat_id: Number(args.chat_id), line });
      } catch (e) {
        return fail(id, { code: "GET_CAMPFIRE_LINE_ERROR", message: e.message });
      }
    }

    if (name === "create_campfire_line") {
      try {
        const p = await projectByName(ctx, args.project);
        const line = await createCampfireLine(ctx, p.id, Number(args.chat_id), args.body || {});
        return ok(id, { message: "Campfire line created", project: { id: p.id, name: p.name }, line });
      } catch (e) {
        return fail(id, { code: "CREATE_CAMPFIRE_LINE_ERROR", message: e.message });
      }
    }

    if (name === "delete_campfire_line") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await deleteCampfireLine(ctx, p.id, Number(args.chat_id), Number(args.line_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "DELETE_CAMPFIRE_LINE_ERROR", message: e.message });
      }
    }

    if (name === "list_chatbots") {
      try {
        const p = await projectByName(ctx, args.project);
        const bots = await listChatbots(ctx, p.id, Number(args.chat_id));
        return ok(id, { project: { id: p.id, name: p.name }, chat_id: Number(args.chat_id), chatbots: bots, count: bots.length });
      } catch (e) {
        return fail(id, { code: "LIST_CHATBOTS_ERROR", message: e.message });
      }
    }

    if (name === "get_chatbot") {
      try {
        const p = await projectByName(ctx, args.project);
        const bot = await getChatbot(ctx, p.id, Number(args.chat_id), Number(args.integration_id));
        return ok(id, { project: { id: p.id, name: p.name }, chat_id: Number(args.chat_id), chatbot: bot });
      } catch (e) {
        return fail(id, { code: "GET_CHATBOT_ERROR", message: e.message });
      }
    }

    if (name === "create_chatbot") {
      try {
        const p = await projectByName(ctx, args.project);
        const bot = await createChatbot(ctx, p.id, Number(args.chat_id), args.body || {});
        return ok(id, { message: "Chatbot created", project: { id: p.id, name: p.name }, chatbot: bot });
      } catch (e) {
        return fail(id, { code: "CREATE_CHATBOT_ERROR", message: e.message });
      }
    }

    if (name === "update_chatbot") {
      try {
        const p = await projectByName(ctx, args.project);
        const bot = await updateChatbot(ctx, p.id, Number(args.chat_id), Number(args.integration_id), args.body || {});
        return ok(id, { message: "Chatbot updated", project: { id: p.id, name: p.name }, chatbot: bot });
      } catch (e) {
        return fail(id, { code: "UPDATE_CHATBOT_ERROR", message: e.message });
      }
    }

    if (name === "delete_chatbot") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await deleteChatbot(ctx, p.id, Number(args.chat_id), Number(args.integration_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "DELETE_CHATBOT_ERROR", message: e.message });
      }
    }

    if (name === "post_chatbot_line") {
      try {
        const p = await projectByName(ctx, args.project);
        const line = await postChatbotLine(ctx, p.id, Number(args.chat_id), args.integration_key, args.body || {});
        return ok(id, { message: "Chatbot line posted", project: { id: p.id, name: p.name }, line });
      } catch (e) {
        return fail(id, { code: "POST_CHATBOT_LINE_ERROR", message: e.message });
      }
    }

    if (name === "list_webhooks") {
      try {
        const p = await projectByName(ctx, args.project);
        const hooks = await listWebhooks(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, webhooks: hooks, count: hooks.length });
      } catch (e) {
        return fail(id, { code: "LIST_WEBHOOKS_ERROR", message: e.message });
      }
    }

    if (name === "get_webhook") {
      try {
        const p = await projectByName(ctx, args.project);
        const hook = await getWebhook(ctx, p.id, Number(args.webhook_id));
        return ok(id, { project: { id: p.id, name: p.name }, webhook: hook });
      } catch (e) {
        return fail(id, { code: "GET_WEBHOOK_ERROR", message: e.message });
      }
    }

    if (name === "create_webhook") {
      try {
        const p = await projectByName(ctx, args.project);
        const hook = await createWebhook(ctx, p.id, args.body || {});
        return ok(id, { message: "Webhook created", project: { id: p.id, name: p.name }, webhook: hook });
      } catch (e) {
        return fail(id, { code: "CREATE_WEBHOOK_ERROR", message: e.message });
      }
    }

    if (name === "update_webhook") {
      try {
        const p = await projectByName(ctx, args.project);
        const hook = await updateWebhook(ctx, p.id, Number(args.webhook_id), args.body || {});
        return ok(id, { message: "Webhook updated", project: { id: p.id, name: p.name }, webhook: hook });
      } catch (e) {
        return fail(id, { code: "UPDATE_WEBHOOK_ERROR", message: e.message });
      }
    }

    if (name === "delete_webhook") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await deleteWebhook(ctx, p.id, Number(args.webhook_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "DELETE_WEBHOOK_ERROR", message: e.message });
      }
    }

    if (name === "create_attachment") {
      try {
        const attachment = await createAttachment(ctx, args.name, args.content_type, args.content_base64);
        return ok(id, { attachment });
      } catch (e) {
        return fail(id, { code: "CREATE_ATTACHMENT_ERROR", message: e.message });
      }
    }

    if (name === "update_client_visibility") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await updateClientVisibility(ctx, p.id, Number(args.recording_id), args.body || {});
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        return fail(id, { code: "UPDATE_CLIENT_VISIBILITY_ERROR", message: e.message });
      }
    }

    if (name === "list_recording_events") {
      try {
        const p = await projectByName(ctx, args.project);
        const events = await listRecordingEvents(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, events, count: events.length });
      } catch (e) {
        return fail(id, { code: "LIST_RECORDING_EVENTS_ERROR", message: e.message });
      }
    }

    if (name === "get_subscription") {
      try {
        const p = await projectByName(ctx, args.project);
        const sub = await getSubscription(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, subscription: sub });
      } catch (e) {
        return fail(id, { code: "GET_SUBSCRIPTION_ERROR", message: e.message });
      }
    }

    if (name === "subscribe_recording") {
      try {
        const p = await projectByName(ctx, args.project);
        const sub = await subscribeRecording(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, subscription: sub });
      } catch (e) {
        return fail(id, { code: "SUBSCRIBE_RECORDING_ERROR", message: e.message });
      }
    }

    if (name === "unsubscribe_recording") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await unsubscribeRecording(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "UNSUBSCRIBE_RECORDING_ERROR", message: e.message });
      }
    }

    if (name === "update_subscription") {
      try {
        const p = await projectByName(ctx, args.project);
        const sub = await updateSubscription(ctx, p.id, Number(args.recording_id), args.body || {});
        return ok(id, { project: { id: p.id, name: p.name }, subscription: sub });
      } catch (e) {
        return fail(id, { code: "UPDATE_SUBSCRIPTION_ERROR", message: e.message });
      }
    }

    if (name === "search_metadata") {
      try {
        const meta = await searchMetadata(ctx);
        return ok(id, meta);
      } catch (e) {
        return fail(id, { code: "SEARCH_METADATA_ERROR", message: e.message });
      }
    }

    if (name === "report_todos_assigned") {
      try {
        const data = await reportTodosAssigned(ctx);
        return ok(id, { people: data, count: Array.isArray(data) ? data.length : 0 });
      } catch (e) {
        return fail(id, { code: "REPORT_TODOS_ASSIGNED_ERROR", message: e.message });
      }
    }

    if (name === "report_todos_assigned_person") {
      try {
        const data = await reportTodosAssignedPerson(ctx, Number(args.person_id));
        return ok(id, { person_id: Number(args.person_id), todos: data, count: Array.isArray(data) ? data.length : 0 });
      } catch (e) {
        return fail(id, { code: "REPORT_TODOS_ASSIGNED_PERSON_ERROR", message: e.message });
      }
    }

    if (name === "report_todos_overdue") {
      try {
        const data = await reportTodosOverdue(ctx);
        return ok(id, { overdue: data });
      } catch (e) {
        return fail(id, { code: "REPORT_TODOS_OVERDUE_ERROR", message: e.message });
      }
    }

    if (name === "report_schedules_upcoming") {
      try {
        const data = await reportSchedulesUpcoming(ctx, args.query || "");
        return ok(id, { upcoming: data });
      } catch (e) {
        return fail(id, { code: "REPORT_SCHEDULES_UPCOMING_ERROR", message: e.message });
      }
    }

    if (name === "report_timeline") {
      try {
        const data = await reportTimeline(ctx, args.query || "");
        return ok(id, { events: data });
      } catch (e) {
        return fail(id, { code: "REPORT_TIMELINE_ERROR", message: e.message });
      }
    }

    if (name === "project_timeline") {
      try {
        const data = await projectTimeline(ctx, Number(args.project_id), args.query || "");
        return ok(id, { project_id: Number(args.project_id), events: data });
      } catch (e) {
        return fail(id, { code: "PROJECT_TIMELINE_ERROR", message: e.message });
      }
    }

    if (name === "user_timeline") {
      try {
        const data = await userTimeline(ctx, Number(args.person_id), args.query || "");
        return ok(id, { person_id: Number(args.person_id), events: data });
      } catch (e) {
        return fail(id, { code: "USER_TIMELINE_ERROR", message: e.message });
      }
    }

    if (name === "report_timesheet") {
      try {
        const data = await reportTimesheet(ctx, args.query || "");
        return ok(id, { entries: data });
      } catch (e) {
        return fail(id, { code: "REPORT_TIMESHEET_ERROR", message: e.message });
      }
    }

    if (name === "project_timesheet") {
      try {
        const data = await projectTimesheet(ctx, Number(args.project_id), args.query || "");
        return ok(id, { project_id: Number(args.project_id), entries: data });
      } catch (e) {
        return fail(id, { code: "PROJECT_TIMESHEET_ERROR", message: e.message });
      }
    }

    if (name === "recording_timesheet") {
      try {
        const data = await recordingTimesheet(ctx, Number(args.project_id), Number(args.recording_id), args.query || "");
        return ok(id, { project_id: Number(args.project_id), recording_id: Number(args.recording_id), entries: data });
      } catch (e) {
        return fail(id, { code: "RECORDING_TIMESHEET_ERROR", message: e.message });
      }
    }

    if (name === "get_inbox") {
      try {
        const p = await projectByName(ctx, args.project);
        const inbox = await getInbox(ctx, p.id, Number(args.inbox_id));
        return ok(id, { project: { id: p.id, name: p.name }, inbox });
      } catch (e) {
        return fail(id, { code: "GET_INBOX_ERROR", message: e.message });
      }
    }

    if (name === "list_inbox_forwards") {
      try {
        const p = await projectByName(ctx, args.project);
        const forwards = await listInboxForwards(ctx, p.id, Number(args.inbox_id));
        return ok(id, { project: { id: p.id, name: p.name }, forwards, count: forwards.length });
      } catch (e) {
        return fail(id, { code: "LIST_INBOX_FORWARDS_ERROR", message: e.message });
      }
    }

    if (name === "get_inbox_forward") {
      try {
        const p = await projectByName(ctx, args.project);
        const forward = await getInboxForward(ctx, p.id, Number(args.forward_id));
        return ok(id, { project: { id: p.id, name: p.name }, forward });
      } catch (e) {
        return fail(id, { code: "GET_INBOX_FORWARD_ERROR", message: e.message });
      }
    }

    if (name === "list_inbox_replies") {
      try {
        const p = await projectByName(ctx, args.project);
        const replies = await listInboxReplies(ctx, p.id, Number(args.forward_id));
        return ok(id, { project: { id: p.id, name: p.name }, replies, count: replies.length });
      } catch (e) {
        return fail(id, { code: "LIST_INBOX_REPLIES_ERROR", message: e.message });
      }
    }

    if (name === "get_inbox_reply") {
      try {
        const p = await projectByName(ctx, args.project);
        const reply = await getInboxReply(ctx, p.id, Number(args.forward_id), Number(args.reply_id));
        return ok(id, { project: { id: p.id, name: p.name }, reply });
      } catch (e) {
        return fail(id, { code: "GET_INBOX_REPLY_ERROR", message: e.message });
      }
    }

    if (name === "get_questionnaire") {
      try {
        const p = await projectByName(ctx, args.project);
        const q = await getQuestionnaire(ctx, p.id, Number(args.questionnaire_id));
        return ok(id, { project: { id: p.id, name: p.name }, questionnaire: q });
      } catch (e) {
        return fail(id, { code: "GET_QUESTIONNAIRE_ERROR", message: e.message });
      }
    }

    if (name === "list_questions") {
      try {
        const p = await projectByName(ctx, args.project);
        const questions = await listQuestions(ctx, p.id, Number(args.questionnaire_id));
        return ok(id, { project: { id: p.id, name: p.name }, questions, count: questions.length });
      } catch (e) {
        return fail(id, { code: "LIST_QUESTIONS_ERROR", message: e.message });
      }
    }

    if (name === "get_question") {
      try {
        const p = await projectByName(ctx, args.project);
        const question = await getQuestion(ctx, p.id, Number(args.question_id));
        return ok(id, { project: { id: p.id, name: p.name }, question });
      } catch (e) {
        return fail(id, { code: "GET_QUESTION_ERROR", message: e.message });
      }
    }

    if (name === "create_question") {
      try {
        const p = await projectByName(ctx, args.project);
        const question = await createQuestion(ctx, p.id, Number(args.questionnaire_id), args.body || {});
        return ok(id, { message: "Question created", project: { id: p.id, name: p.name }, question });
      } catch (e) {
        return fail(id, { code: "CREATE_QUESTION_ERROR", message: e.message });
      }
    }

    if (name === "update_question") {
      try {
        const p = await projectByName(ctx, args.project);
        const question = await updateQuestion(ctx, p.id, Number(args.question_id), args.body || {});
        return ok(id, { message: "Question updated", project: { id: p.id, name: p.name }, question });
      } catch (e) {
        return fail(id, { code: "UPDATE_QUESTION_ERROR", message: e.message });
      }
    }

    if (name === "pause_question") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await pauseQuestion(ctx, p.id, Number(args.question_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "PAUSE_QUESTION_ERROR", message: e.message });
      }
    }

    if (name === "resume_question") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await resumeQuestion(ctx, p.id, Number(args.question_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "RESUME_QUESTION_ERROR", message: e.message });
      }
    }

    if (name === "update_question_notification_settings") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await updateQuestionNotificationSettings(ctx, p.id, Number(args.question_id), args.body || {});
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        return fail(id, { code: "UPDATE_QUESTION_NOTIFICATION_ERROR", message: e.message });
      }
    }

    if (name === "list_question_answers") {
      try {
        const p = await projectByName(ctx, args.project);
        const answers = await listQuestionAnswers(ctx, p.id, Number(args.question_id));
        return ok(id, { project: { id: p.id, name: p.name }, answers, count: answers.length });
      } catch (e) {
        return fail(id, { code: "LIST_QUESTION_ANSWERS_ERROR", message: e.message });
      }
    }

    if (name === "list_question_answers_by") {
      try {
        const p = await projectByName(ctx, args.project);
        const people = await listQuestionAnswersBy(ctx, p.id, Number(args.question_id));
        return ok(id, { project: { id: p.id, name: p.name }, people, count: people.length });
      } catch (e) {
        return fail(id, { code: "LIST_QUESTION_ANSWERS_BY_ERROR", message: e.message });
      }
    }

    if (name === "list_question_answers_by_person") {
      try {
        const p = await projectByName(ctx, args.project);
        const answers = await listQuestionAnswersByPerson(ctx, p.id, Number(args.question_id), Number(args.person_id));
        return ok(id, { project: { id: p.id, name: p.name }, answers, count: answers.length });
      } catch (e) {
        return fail(id, { code: "LIST_QUESTION_ANSWERS_BY_PERSON_ERROR", message: e.message });
      }
    }

    if (name === "get_question_answer") {
      try {
        const p = await projectByName(ctx, args.project);
        const answer = await getQuestionAnswer(ctx, p.id, Number(args.answer_id));
        return ok(id, { project: { id: p.id, name: p.name }, answer });
      } catch (e) {
        return fail(id, { code: "GET_QUESTION_ANSWER_ERROR", message: e.message });
      }
    }

    if (name === "create_question_answer") {
      try {
        const p = await projectByName(ctx, args.project);
        const answer = await createQuestionAnswer(ctx, p.id, Number(args.question_id), args.body || {});
        return ok(id, { message: "Answer created", project: { id: p.id, name: p.name }, answer });
      } catch (e) {
        return fail(id, { code: "CREATE_QUESTION_ANSWER_ERROR", message: e.message });
      }
    }

    if (name === "update_question_answer") {
      try {
        const p = await projectByName(ctx, args.project);
        const answer = await updateQuestionAnswer(ctx, p.id, Number(args.answer_id), args.body || {});
        return ok(id, { message: "Answer updated", project: { id: p.id, name: p.name }, answer });
      } catch (e) {
        return fail(id, { code: "UPDATE_QUESTION_ANSWER_ERROR", message: e.message });
      }
    }

    if (name === "list_question_reminders") {
      try {
        const reminders = await listQuestionReminders(ctx);
        return ok(id, { reminders, count: reminders.length });
      } catch (e) {
        return fail(id, { code: "LIST_QUESTION_REMINDERS_ERROR", message: e.message });
      }
    }

    if (name === "list_templates") {
      try {
        const templates = await listTemplates(ctx);
        return ok(id, { templates, count: templates.length });
      } catch (e) {
        return fail(id, { code: "LIST_TEMPLATES_ERROR", message: e.message });
      }
    }

    if (name === "get_template") {
      try {
        const template = await getTemplate(ctx, Number(args.template_id));
        return ok(id, { template });
      } catch (e) {
        return fail(id, { code: "GET_TEMPLATE_ERROR", message: e.message });
      }
    }

    if (name === "create_template") {
      try {
        const template = await createTemplate(ctx, args.body || {});
        return ok(id, { message: "Template created", template });
      } catch (e) {
        return fail(id, { code: "CREATE_TEMPLATE_ERROR", message: e.message });
      }
    }

    if (name === "update_template") {
      try {
        const template = await updateTemplate(ctx, Number(args.template_id), args.body || {});
        return ok(id, { message: "Template updated", template });
      } catch (e) {
        return fail(id, { code: "UPDATE_TEMPLATE_ERROR", message: e.message });
      }
    }

    if (name === "trash_template") {
      try {
        const result = await trashTemplate(ctx, Number(args.template_id));
        return ok(id, result);
      } catch (e) {
        return fail(id, { code: "TRASH_TEMPLATE_ERROR", message: e.message });
      }
    }

    if (name === "create_project_construction") {
      try {
        const construction = await createProjectConstruction(ctx, Number(args.template_id), args.body || {});
        return ok(id, { message: "Project construction created", construction });
      } catch (e) {
        return fail(id, { code: "CREATE_PROJECT_CONSTRUCTION_ERROR", message: e.message });
      }
    }

    if (name === "get_project_construction") {
      try {
        const construction = await getProjectConstruction(ctx, Number(args.template_id), Number(args.construction_id));
        return ok(id, { construction });
      } catch (e) {
        return fail(id, { code: "GET_PROJECT_CONSTRUCTION_ERROR", message: e.message });
      }
    }

    if (name === "get_dock_tool") {
      try {
        const p = await projectByName(ctx, args.project);
        const toolResult = await getDockTool(ctx, p.id, Number(args.tool_id));
        return ok(id, { project: { id: p.id, name: p.name }, tool: toolResult });
      } catch (e) {
        return fail(id, { code: "GET_DOCK_TOOL_ERROR", message: e.message });
      }
    }

    if (name === "create_dock_tool") {
      try {
        const p = await projectByName(ctx, args.project);
        const toolResult = await createDockTool(ctx, p.id, args.body || {});
        return ok(id, { message: "Dock tool created", project: { id: p.id, name: p.name }, tool: toolResult });
      } catch (e) {
        return fail(id, { code: "CREATE_DOCK_TOOL_ERROR", message: e.message });
      }
    }

    if (name === "update_dock_tool") {
      try {
        const p = await projectByName(ctx, args.project);
        const toolResult = await updateDockTool(ctx, p.id, Number(args.tool_id), args.body || {});
        return ok(id, { message: "Dock tool updated", project: { id: p.id, name: p.name }, tool: toolResult });
      } catch (e) {
        return fail(id, { code: "UPDATE_DOCK_TOOL_ERROR", message: e.message });
      }
    }

    if (name === "enable_dock_tool") {
      try {
        const p = await projectByName(ctx, args.project);
        const toolResult = await enableDockTool(ctx, p.id, Number(args.recording_id), args.body || {});
        return ok(id, { message: "Dock tool enabled", project: { id: p.id, name: p.name }, tool: toolResult });
      } catch (e) {
        return fail(id, { code: "ENABLE_DOCK_TOOL_ERROR", message: e.message });
      }
    }

    if (name === "move_dock_tool") {
      try {
        const p = await projectByName(ctx, args.project);
        const toolResult = await moveDockTool(ctx, p.id, Number(args.recording_id), args.body || {});
        return ok(id, { message: "Dock tool moved", project: { id: p.id, name: p.name }, tool: toolResult });
      } catch (e) {
        return fail(id, { code: "MOVE_DOCK_TOOL_ERROR", message: e.message });
      }
    }

    if (name === "disable_dock_tool") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await disableDockTool(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "DISABLE_DOCK_TOOL_ERROR", message: e.message });
      }
    }

    if (name === "trash_dock_tool") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await trashDockTool(ctx, p.id, Number(args.tool_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "TRASH_DOCK_TOOL_ERROR", message: e.message });
      }
    }

    if (name === "create_lineup_marker") {
      try {
        const marker = await createLineupMarker(ctx, args.body || {});
        return ok(id, { marker });
      } catch (e) {
        return fail(id, { code: "CREATE_LINEUP_MARKER_ERROR", message: e.message });
      }
    }

    if (name === "update_lineup_marker") {
      try {
        const marker = await updateLineupMarker(ctx, Number(args.marker_id), args.body || {});
        return ok(id, { marker });
      } catch (e) {
        return fail(id, { code: "UPDATE_LINEUP_MARKER_ERROR", message: e.message });
      }
    }

    if (name === "delete_lineup_marker") {
      try {
        const result = await deleteLineupMarker(ctx, Number(args.marker_id));
        return ok(id, result);
      } catch (e) {
        return fail(id, { code: "DELETE_LINEUP_MARKER_ERROR", message: e.message });
      }
    }

    if (name === "list_todolist_groups") {
      try {
        const p = await projectByName(ctx, args.project);
        const groups = await listTodolistGroups(ctx, p.id, Number(args.todolist_id));
        return ok(id, { project: { id: p.id, name: p.name }, groups, count: groups.length });
      } catch (e) {
        return fail(id, { code: "LIST_TODOLIST_GROUPS_ERROR", message: e.message });
      }
    }

    if (name === "get_todolist_group") {
      try {
        const p = await projectByName(ctx, args.project);
        const group = await getTodolistGroup(ctx, p.id, Number(args.group_id));
        return ok(id, { project: { id: p.id, name: p.name }, group });
      } catch (e) {
        return fail(id, { code: "GET_TODOLIST_GROUP_ERROR", message: e.message });
      }
    }

    if (name === "create_todolist_group") {
      try {
        const p = await projectByName(ctx, args.project);
        const group = await createTodolistGroup(ctx, p.id, Number(args.todolist_id), args.body || {});
        return ok(id, { message: "Todolist group created", project: { id: p.id, name: p.name }, group });
      } catch (e) {
        return fail(id, { code: "CREATE_TODOLIST_GROUP_ERROR", message: e.message });
      }
    }

    if (name === "reposition_todolist_group") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await repositionTodolistGroup(ctx, p.id, Number(args.group_id), Number(args.position));
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        return fail(id, { code: "REPOSITION_TODOLIST_GROUP_ERROR", message: e.message });
      }
    }

    if (name === "get_todoset") {
      try {
        const p = await projectByName(ctx, args.project);
        const todoset = await getTodoset(ctx, p.id, Number(args.todoset_id));
        return ok(id, { project: { id: p.id, name: p.name }, todoset });
      } catch (e) {
        return fail(id, { code: "GET_TODOSET_ERROR", message: e.message });
      }
    }

    if (name === "get_todolist") {
      try {
        const p = await projectByName(ctx, args.project);
        const todolist = await getTodoList(ctx, p.id, Number(args.todolist_id));
        return ok(id, { project: { id: p.id, name: p.name }, todolist });
      } catch (e) {
        return fail(id, { code: "GET_TODOLIST_ERROR", message: e.message });
      }
    }

    if (name === "create_todolist") {
      try {
        const p = await projectByName(ctx, args.project);
        const todolist = await createTodoList(ctx, p.id, Number(args.todoset_id), args.body || {});
        return ok(id, { message: "Todolist created", project: { id: p.id, name: p.name }, todolist });
      } catch (e) {
        return fail(id, { code: "CREATE_TODOLIST_ERROR", message: e.message });
      }
    }

    if (name === "update_todolist") {
      try {
        const p = await projectByName(ctx, args.project);
        const todolist = await updateTodoList(ctx, p.id, Number(args.todolist_id), args.body || {});
        return ok(id, { message: "Todolist updated", project: { id: p.id, name: p.name }, todolist });
      } catch (e) {
        return fail(id, { code: "UPDATE_TODOLIST_ERROR", message: e.message });
      }
    }

    if (name === "get_schedule") {
      try {
        const p = await projectByName(ctx, args.project);
        const schedule = await getSchedule(ctx, p.id, Number(args.schedule_id));
        return ok(id, { project: { id: p.id, name: p.name }, schedule });
      } catch (e) {
        return fail(id, { code: "GET_SCHEDULE_ERROR", message: e.message });
      }
    }

    if (name === "update_schedule") {
      try {
        const p = await projectByName(ctx, args.project);
        const schedule = await updateSchedule(ctx, p.id, Number(args.schedule_id), args.body || {});
        return ok(id, { message: "Schedule updated", project: { id: p.id, name: p.name }, schedule });
      } catch (e) {
        return fail(id, { code: "UPDATE_SCHEDULE_ERROR", message: e.message });
      }
    }

    if (name === "get_schedule_entry") {
      try {
        const p = await projectByName(ctx, args.project);
        const entry = await getScheduleEntry(ctx, p.id, Number(args.entry_id));
        return ok(id, { project: { id: p.id, name: p.name }, entry });
      } catch (e) {
        return fail(id, { code: "GET_SCHEDULE_ENTRY_ERROR", message: e.message });
      }
    }

    if (name === "create_schedule_entry") {
      try {
        const p = await projectByName(ctx, args.project);
        const entry = await createScheduleEntry(ctx, p.id, Number(args.schedule_id), args.body || {});
        return ok(id, { message: "Schedule entry created", project: { id: p.id, name: p.name }, entry });
      } catch (e) {
        return fail(id, { code: "CREATE_SCHEDULE_ENTRY_ERROR", message: e.message });
      }
    }

    if (name === "update_schedule_entry") {
      try {
        const p = await projectByName(ctx, args.project);
        const entry = await updateScheduleEntry(ctx, p.id, Number(args.entry_id), args.body || {});
        return ok(id, { message: "Schedule entry updated", project: { id: p.id, name: p.name }, entry });
      } catch (e) {
        return fail(id, { code: "UPDATE_SCHEDULE_ENTRY_ERROR", message: e.message });
      }
    }

    if (name === "get_card_table") {
      try {
        const p = await projectByName(ctx, args.project);
        const table = await getCardTable(ctx, p.id, Number(args.card_table_id));
        return ok(id, { project: { id: p.id, name: p.name }, card_table: table });
      } catch (e) {
        return fail(id, { code: "GET_CARD_TABLE_ERROR", message: e.message });
      }
    }

    if (name === "get_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        const column = await getCardTableColumn(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, column });
      } catch (e) {
        return fail(id, { code: "GET_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "create_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        const column = await createCardTableColumn(ctx, p.id, Number(args.card_table_id), args.body || {});
        return ok(id, { message: "Card table column created", project: { id: p.id, name: p.name }, column });
      } catch (e) {
        return fail(id, { code: "CREATE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "update_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        const column = await updateCardTableColumn(ctx, p.id, Number(args.column_id), args.body || {});
        return ok(id, { message: "Card table column updated", project: { id: p.id, name: p.name }, column });
      } catch (e) {
        return fail(id, { code: "UPDATE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "move_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        const column = await moveCardTableColumn(ctx, p.id, Number(args.card_table_id), args.body || {});
        return ok(id, { message: "Card table column moved", project: { id: p.id, name: p.name }, column });
      } catch (e) {
        return fail(id, { code: "MOVE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "subscribe_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await subscribeCardTableColumn(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        return fail(id, { code: "SUBSCRIBE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "unsubscribe_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await unsubscribeCardTableColumn(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "UNSUBSCRIBE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "create_card_table_on_hold") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await createCardTableOnHold(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        return fail(id, { code: "CREATE_CARD_TABLE_ON_HOLD_ERROR", message: e.message });
      }
    }

    if (name === "delete_card_table_on_hold") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await deleteCardTableOnHold(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "DELETE_CARD_TABLE_ON_HOLD_ERROR", message: e.message });
      }
    }

    if (name === "update_card_table_column_color") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await updateCardTableColumnColor(ctx, p.id, Number(args.column_id), args.body || {});
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        return fail(id, { code: "UPDATE_CARD_TABLE_COLUMN_COLOR_ERROR", message: e.message });
      }
    }

    if (name === "get_card") {
      try {
        const p = await projectByName(ctx, args.project);
        const card = await getCard(ctx, p.id, Number(args.card_id));
        return ok(id, { project: { id: p.id, name: p.name }, card });
      } catch (e) {
        return fail(id, { code: "GET_CARD_ERROR", message: e.message });
      }
    }

    if (name === "update_card") {
      try {
        const p = await projectByName(ctx, args.project);
        const card = await updateCard(ctx, p.id, Number(args.card_id), args.body || {});
        return ok(id, { message: "Card updated", project: { id: p.id, name: p.name }, card });
      } catch (e) {
        return fail(id, { code: "UPDATE_CARD_ERROR", message: e.message });
      }
    }

    // ===== NEW SEARCH ENDPOINTS =====
    if (name === "search_recordings") {
      try {
        const results = await searchRecordings(ctx, args.query, { bucket_id: args.bucket });
        
        // INTELLIGENT CHAINING: Enrich search results with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, args.query);
        const enricher = intelligent.createEnricher(ctx_intel);
        
        let enrichedResults = results;
        if (Array.isArray(results)) {
          enrichedResults = await Promise.all(
            results.map(r => enricher.enrich(r, {
              getPerson: (id) => ctx_intel.getPerson(id),
              getProject: (id) => ctx_intel.getProject(id)
            }))
          );
        }
        
        return ok(id, { 
          query: args.query, 
          results: enrichedResults, 
          count: enrichedResults.length,
          metrics: ctx_intel.getMetrics()
        });
      } catch (e) {
        console.error(`[search_recordings] Error:`, e.message);
        // Fallback to non-enriched search
        try {
          const results = await searchRecordings(ctx, args.query, { bucket_id: args.bucket });
          return ok(id, { query: args.query, results, count: results.length, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "SEARCH_RECORDINGS_ERROR", message: fbErr.message });
        }
      }
    }

    // Raw
    if (name === "basecamp_request" || name === "basecamp_raw") {
      const data = await api(ctx, args.path, { method: args.method || "GET", body: args.body });
      return ok(id, data);
    }

    return fail(id, { code: "UNKNOWN_TOOL", message: "Unknown tool name" });
  } catch (e) {
    console.error(`[MCP] Error in tool call:`, { name: params?.name, error: e.message, code: e?.code, stack: e?.stack });
    
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

