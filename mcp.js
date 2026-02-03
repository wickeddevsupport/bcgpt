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
import fs from "fs";
import path from "path";
import { basecampFetch, basecampFetchAll } from "./basecamp.js";
import { resolveByName, resolveBestEffort } from "./resolvers.js";
import { indexSearchItem, searchIndex, getIdempotencyResponse, setIdempotencyResponse } from "./db.js";
import { getTools } from "./mcp/tools.js";

// Intelligent chaining modules
import { RequestContext } from './intelligent-executor.js';
import * as intelligent from './intelligent-integration.js';

// ---------- JSON-RPC helpers ----------
function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function fail(id, error) { return { jsonrpc: "2.0", id, error: normalizeErrorPayload(error) }; }
function logDebug(...args) {
  if (!process?.env?.DEBUG) return;
  console.log(...args);
}
function logCommentDebug(...args) {
  if (!process?.env?.DEBUG && !process?.env?.COMMENT_DEBUG) return;
  console.log(...args);
}
function logPeopleDebug(...args) {
  if (!process?.env?.DEBUG && !process?.env?.PEOPLE_DEBUG) return;
  console.log(...args);
}

function normalizeIdempotencyPath(pathOrUrl) {
  const raw = String(pathOrUrl || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.pathname}${url.search || ""}`;
  } catch {
    return raw;
  }
}

function extractIdempotencyKey(opts = {}) {
  const fromOpts = firstDefined(
    opts.idempotencyKey,
    opts.idempotency_key,
    opts.request_id,
    opts.requestId
  );
  if (fromOpts) return String(fromOpts).trim();
  const fromHeader = opts.headers?.["X-Request-Id"] || opts.headers?.["Idempotency-Key"];
  if (fromHeader) return String(fromHeader).trim();
  const body = opts.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    const fromBody = firstDefined(body.idempotency_key, body.request_id, body.requestId);
    if (fromBody) return String(fromBody).trim();
  }
  return null;
}

function stripIdempotencyKeys(body) {
  if (!body || typeof body !== "object" || Buffer.isBuffer(body) || body instanceof Uint8Array) return body;
  const cloned = { ...body };
  delete cloned.idempotency_key;
  delete cloned.request_id;
  delete cloned.requestId;
  return cloned;
}

function withIdempotency(body, args) {
  if (!body || typeof body !== "object" || Buffer.isBuffer(body) || body instanceof Uint8Array) return body;
  const key = firstDefined(args?.idempotency_key, args?.request_id, args?.requestId);
  if (!key) return body;
  return { ...body, idempotency_key: key };
}

// Large payload cache (in-memory, short-lived)
const largePayloadCache = new Map();
const LARGE_CACHE_LIMIT = 10;
const LARGE_EXPORT_DIR = path.join(process.cwd(), "exports");
const DEFAULT_INLINE_LIMIT = 200;
const DEFAULT_CHUNK_SIZE = 50;

function cacheCollection(collectionKey, items, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  const key = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(chunkSize) || 1);
  const chunks = chunkArray(list, size);
  largePayloadCache.set(key, { chunks, createdAt: Date.now(), collectionKey });
  // simple eviction
  if (largePayloadCache.size > LARGE_CACHE_LIMIT) {
    const oldest = [...largePayloadCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) largePayloadCache.delete(oldest[0]);
  }
  return { key, chunkCount: chunks.length, firstChunk: chunks[0] || [] };
}

function putLargePayload(payload, { chunkSizeBoards = 1 } = {}) {
  const boards = Array.isArray(payload?.card_tables) ? payload.card_tables : [];
  return cacheCollection("card_tables", boards, { chunkSize: chunkSizeBoards });
}

function getLargePayloadChunk(key, index = 0) {
  const entry = largePayloadCache.get(key);
  if (!entry) return { chunk: [], next_index: null, done: true };
  const idx = Math.max(0, Number(index) || 0);
  const chunk = entry.chunks[idx] || [];
  const next_index = idx + 1 < entry.chunks.length ? idx + 1 : null;
  return {
    collection_key: entry.collectionKey,
    chunk,
    next_index,
    done: next_index == null,
    total_chunks: entry.chunks.length
  };
}

function exportLargePayloadToFile(key) {
  const entry = largePayloadCache.get(key);
  if (!entry) return null;
  if (!fs.existsSync(LARGE_EXPORT_DIR)) fs.mkdirSync(LARGE_EXPORT_DIR, { recursive: true });
  const allItems = entry.chunks.flat();
  const payload = { [entry.collectionKey || "items"]: allItems };
  const filePath = path.join(LARGE_EXPORT_DIR, `${entry.collectionKey || "items"}_${key}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  const sizeBytes = fs.statSync(filePath).size;
  return { file_path: filePath, size_bytes: sizeBytes, item_count: allItems.length, collection_key: entry.collectionKey || "items" };
}

function maybeCacheCollectionResult(collectionKey, items, {
  inlineLimit = DEFAULT_INLINE_LIMIT,
  chunkSize = DEFAULT_CHUNK_SIZE,
  forceCache = false
} = {}) {
  const list = Array.isArray(items) ? items : [];
  const shouldCache = forceCache || list.length > inlineLimit;
  if (!shouldCache) {
    return { items: list, cached: false, total: list.length };
  }
  const cached = cacheCollection(collectionKey, list, { chunkSize });
  const exported = exportLargePayloadToFile(cached.key);
  return {
    items: cached.firstChunk,
    cached: true,
    total: list.length,
    payload_key: cached.key,
    chunk_count: cached.chunkCount,
    export: exported
  };
}

function unwrapItemsWithMeta(input) {
  if (!input) return { items: [], meta: undefined };
  if (Array.isArray(input)) {
    return { items: input, meta: input._meta || input.meta };
  }
  if (typeof input === "object") {
    if (Array.isArray(input.items)) return { items: input.items, meta: input._meta || input.meta };
    if (Array.isArray(input.data)) return { items: input.data, meta: input._meta || input.meta };
  }
  return { items: [], meta: undefined };
}

function coverageFromMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const pages = Number(meta.pages ?? meta.page_count ?? meta.pageCount);
  const perPage = Number(meta.per_page ?? meta.perPage);
  const total = Number(meta.total_items ?? meta.total ?? meta.totalItems);
  const maxPages = Number(meta.max_pages ?? meta.maxPages);
  const nextUrl = meta.next_url ?? meta.nextUrl ?? null;
  const truncated = meta.truncated === true || (Number.isFinite(maxPages) && Number.isFinite(pages) && pages >= maxPages && !!nextUrl);
  return {
    pages_fetched: Number.isFinite(pages) ? pages : null,
    per_page: Number.isFinite(perPage) ? perPage : null,
    total_items: Number.isFinite(total) ? total : null,
    max_pages: Number.isFinite(maxPages) ? maxPages : null,
    next_url: nextUrl,
    truncated
  };
}

function buildListPayload(collectionKey, items, options = {}) {
  const unwrapped = unwrapItemsWithMeta(items);
  const cached = maybeCacheCollectionResult(collectionKey, unwrapped.items, options);
  const payload = {
    [collectionKey]: cached.items,
    count: cached.total,
    cached: cached.cached,
    payload_key: cached.payload_key,
    cache_key: cached.payload_key,
    chunk_count: cached.chunk_count,
    export: cached.export
  };
  const meta = options.meta || unwrapped.meta;
  if (meta) payload._meta = meta;
  const coverage = options.coverage || coverageFromMeta(meta) || {
    items_returned: cached.total,
    truncated: null
  };
  if (coverage) payload.coverage = coverage;
  return payload;
}

function attachCachedCollection(target, collectionKey, items, options = {}) {
  const unwrapped = unwrapItemsWithMeta(items);
  const cached = maybeCacheCollectionResult(collectionKey, unwrapped.items, options);
  target[collectionKey] = cached.items;
  target[`${collectionKey}_count`] = cached.total;
  target[`${collectionKey}_cached`] = cached.cached;
  target[`${collectionKey}_payload_key`] = cached.payload_key;
  target[`${collectionKey}_chunk_count`] = cached.chunk_count;
  target[`${collectionKey}_export`] = cached.export;
  if (unwrapped.meta) target[`${collectionKey}_meta`] = unwrapped.meta;
  const coverage = options.coverage || coverageFromMeta(unwrapped.meta) || {
    items_returned: cached.total,
    truncated: null
  };
  if (coverage) target[`${collectionKey}_coverage`] = coverage;
  return target;
}

const ERROR_TAXONOMY = {
  NOT_AUTHENTICATED: { category: "auth", retryable: false, action: "reauth" },
  NO_ACCOUNT_ID: { category: "config", retryable: false },
  BASECAMP_API_ERROR: { category: "api" },
  BASECAMP_FETCH_FAILED: { category: "network", retryable: true },
  BASECAMP_REQUEST_FAILED: { category: "network", retryable: true },
  CIRCUIT_OPEN: { category: "resilience", retryable: true, action: "retry_later" },
  RESPONSE_TOO_LARGE: { category: "payload", retryable: true, action: "chunk" },
  TOOL_NOT_ENABLED: { category: "feature", retryable: false },
  TOOL_UNAVAILABLE: { category: "feature", retryable: false },
  RESOURCE_NOT_FOUND: { category: "data", retryable: false },
  NO_MATCH: { category: "input", retryable: false },
  BAD_REQUEST: { category: "input", retryable: false },
  INVALID_INPUT: { category: "input", retryable: false },
  TOOL_ERROR: { category: "internal", retryable: false },
};

function normalizeErrorPayload(error) {
  if (!error) return { code: "UNKNOWN_ERROR", message: "Unknown error", category: "unknown", retryable: false };
  if (typeof error === "string") return { code: "ERROR", message: error, category: "unknown", retryable: false };
  if (error.error && typeof error.error === "object") return normalizeErrorPayload(error.error);

  const code = error.code || "UNKNOWN_ERROR";
  const message = error.message || String(error);
  const taxonomy = ERROR_TAXONOMY[code] || {};

  let retryable = taxonomy.retryable;
  if (code === "BASECAMP_API_ERROR") {
    retryable = [429, 500, 502, 503, 504].includes(error.status);
  }
  if (retryable == null) retryable = false;

  const payload = {
    code,
    message,
    category: taxonomy.category || "unknown",
    retryable,
  };
  if (taxonomy.action) payload.action = taxonomy.action;
  if (error.status != null) payload.status = error.status;
  if (error.retry_after_ms != null) payload.retry_after_ms = error.retry_after_ms;
  if (error.details) payload.details = error.details;

  for (const [key, value] of Object.entries(error)) {
    if (key === "message" || key === "code") continue;
    if (payload[key] == null) payload[key] = value;
  }

  return payload;
}

function toolError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function extractContent(args) {
  if (!args) return undefined;
  if (typeof args === "string") return args;
  if (typeof args.content === "string") return args.content;
  if (typeof args.html === "string") return args.html;
  if (typeof args.text === "string") return args.text;
  if (typeof args.message === "string") return args.message;
  if (typeof args.body === "string") return args.body;
  if (args.body && typeof args.body === "object") {
    return extractContent(args.body);
  }
  return undefined;
}

function normalizeMessageBody(args = {}, { defaultStatus = null } = {}) {
  const body = (args.body && typeof args.body === "object" && !Array.isArray(args.body)) ? { ...args.body } : {};
  const subject = firstDefined(args.subject, body.subject, args.title, body.title);
  if (subject != null) body.subject = subject;
  const content = firstDefined(extractContent(body), extractContent(args));
  if (content != null) body.content = content;
  const status = firstDefined(args.status, body.status);
  if (status != null) body.status = status;
  if (defaultStatus && body.status == null) body.status = defaultStatus;
  return body;
}

function isApiError(e, status = null) {
  if (!e || e.code !== "BASECAMP_API_ERROR") return false;
  return status == null ? true : e.status === status;
}

function toolNoticeResult(id, e, { tool, project, empty }) {
  if (!e) return null;
  const code = e.code;
  if (code !== "TOOL_NOT_ENABLED" && code !== "TOOL_UNAVAILABLE" && code !== "RESOURCE_NOT_FOUND") return null;
  const notice = {
    tool: e.tool || tool || null,
    reason: code,
    message: e.message,
    hint: e.hint || null,
    status: e.status || null,
  };
  const payload = { ...(empty || {}), notice };
  if (project) payload.project = { id: project.id, name: project.name };
  return ok(id, payload);
}

function toolFailResult(id, e) {
  if (!e) return null;
  const code = e.code;
  if (code !== "TOOL_NOT_ENABLED" && code !== "TOOL_UNAVAILABLE" && code !== "RESOURCE_NOT_FOUND") return null;
  return fail(id, {
    code,
    message: e.message,
    tool: e.tool || null,
    hint: e.hint || null,
    status: e.status || null,
  });
}

function inferToolFromName(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("message")) return "message_boards";
  if (n.includes("document") || n.includes("vault")) return "documents";
  if (n.includes("schedule")) return "schedule";
  if (n.includes("card")) return "card_tables";
  if (n.includes("campfire") || n.includes("chatbot") || n.includes("chat")) return "campfire";
  if (n.includes("hill")) return "hill_charts";
  return null;
}

function emptyPayloadForToolName(name) {
  const n = String(name || "").toLowerCase();
  if (n === "get_hill_chart") return { hill_chart: null };
  if (n.includes("list_message_boards")) return { message_boards: [], count: 0 };
  if (n.includes("list_messages")) return { messages: [], count: 0 };
  if (n.includes("list_documents")) return { documents: [], count: 0 };
  if (n.includes("list_schedule_entries")) return { schedule_entries: [], count: 0 };
  if (n.includes("list_card_tables")) return { card_tables: [], count: 0 };
  if (n.includes("list_card_table_columns")) return { columns: [], count: 0 };
  if (n.includes("list_card_table_cards")) return { cards: [], count: 0 };
  if (n.includes("list_card_steps")) return { steps: [], count: 0 };
  if (n.includes("list_campfires")) return { campfires: [], count: 0 };
  if (n.includes("list_chatbots")) return { chatbots: [], count: 0 };
  if (n.includes("search_recordings")) return { results: [], count: 0 };
  if (n.includes("search_project")) return { results: [], count: 0 };
  return null;
}

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
async function api(ctx, pathOrUrl, opts = {}) {
  const method = String(opts.method || "GET").toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const idempotencyKey = extractIdempotencyKey(opts);
  const idempotencyPath = idempotencyKey ? normalizeIdempotencyPath(pathOrUrl) : null;
  const ttl = Number(process.env.IDEMPOTENCY_TTL_SEC || 86400);

  if (isWrite && idempotencyKey && idempotencyPath) {
    const cached = getIdempotencyResponse(idempotencyKey, {
      method,
      path: idempotencyPath,
      userKey: ctx.userKey,
      maxAgeSec: ttl
    });
    if (cached) return cached;
  }

  const headers = { ...(opts.headers || {}) };
  if (idempotencyKey) {
    if (!headers["X-Request-Id"]) headers["X-Request-Id"] = idempotencyKey;
    if (!headers["Idempotency-Key"]) headers["Idempotency-Key"] = idempotencyKey;
  }
  const body = idempotencyKey ? stripIdempotencyKeys(opts.body) : opts.body;
  const requestOpts = { ...opts, headers, body };

  const fetcher = typeof ctx?.basecampFetch === "function"
    ? ctx.basecampFetch
    : (path, options) => basecampFetch(ctx.TOKEN, path, { ...options, accountId: ctx.accountId, ua: ctx.ua });

  console.log(`[api] Using ${typeof ctx?.basecampFetch === "function" ? "ctx.basecampFetch" : "standalone basecampFetch"} for:`, pathOrUrl);
  const result = await fetcher(pathOrUrl, requestOpts);

  if (isWrite && idempotencyKey && idempotencyPath) {
    setIdempotencyResponse(idempotencyKey, result, {
      method,
      path: idempotencyPath,
      userKey: ctx.userKey
    });
  }

  return result;
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

function apiAllWithMeta(ctx, pathOrUrl, opts = {}) {
  return apiAll(ctx, pathOrUrl, { ...opts, includeMeta: true });
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
  const result = await apiAllWithMeta(ctx, `/projects.json?${qs.toString()}`);
  const { items, meta } = unwrapItemsWithMeta(result);
  let data = items;
  
  if (!Array.isArray(data)) {
    console.error("[listProjects] apiAll did not return array:", typeof data, data);
    data = [];
  }
  if (meta) data._meta = meta;

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
  if (data._meta) out._meta = data._meta;

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

function dockFindAll(dock, names) {
  const list = Array.isArray(names) ? names : [names];
  const hits = [];
  for (const n of list) {
    for (const d of (dock || [])) {
      if (d?.name === n && d?.enabled !== false) hits.push(d);
    }
  }
  return hits;
}

async function requireDockTool(ctx, projectId, names, toolKey, { allowId = true } = {}) {
  const dock = await getDock(ctx, projectId);
  const tool = dockFind(dock, names);
  if (!tool || (!tool.url && (!allowId || !tool.id))) {
    throw toolError("TOOL_NOT_ENABLED", `${toolKey} tool is not enabled for this project.`, {
      tool: toolKey,
      projectId,
      hint: "Enable the tool in the project’s Basecamp settings.",
      status: 404,
    });
  }
  return { dock, tool };
}

async function getProject(ctx, projectId) {
  // account-scoped
  return api(ctx, `/projects/${projectId}.json`);
}

async function createProject(ctx, body) {
  return api(ctx, `/projects.json`, { method: "POST", body: withIdempotency(body, body) });
}

async function updateProject(ctx, projectId, body) {
  return api(ctx, `/projects/${projectId}.json`, { method: "PUT", body: withIdempotency(body, body) });
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
  return api(ctx, `/buckets/${projectId}/todosets/${todosetId}/todolists.json`, {
    method: "POST",
    body: withIdempotency(body, body)
  });
}

async function updateTodoList(ctx, projectId, todolistId, body) {
  return api(ctx, `/buckets/${projectId}/todolists/${todolistId}.json`, {
    method: "PUT",
    body: withIdempotency(body, body)
  });
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

function summarizeTodoGroups(groups) {
  const summary = {
    lists_total: Array.isArray(groups) ? groups.length : 0,
    todos_total: 0,
    todos_open: 0,
    todos_completed: 0
  };
  for (const g of groups || []) {
    for (const t of g.todos || []) {
      summary.todos_total += 1;
      if (t.completed || t.completed_at) summary.todos_completed += 1;
      else summary.todos_open += 1;
    }
  }
  return summary;
}

function capTodoGroups(groups, maxTodos) {
  const limit = Number(maxTodos);
  if (!Number.isFinite(limit) || limit <= 0) return groups || [];
  let remaining = limit;
  const out = [];
  for (const g of (groups || [])) {
    if (remaining <= 0) break;
    const todos = (g?.todos || []).slice(0, remaining);
    remaining -= todos.length;
    if (todos.length) out.push({ ...g, todos });
  }
  return out;
}

function normalizeQuery(q) {
  return String(q || "").trim();
}

function normalizeNameMatch(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-'.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreNameMatch(name, query) {
  if (!name || !query) return 0;
  if (name === query) return 3;
  if (name.startsWith(query)) return 2;
  if (name.includes(query)) return 1;
  return 0;
}

function findNameMatches(items, query, { limit = 5, nameKey = "name" } = {}) {
  const q = normalizeNameMatch(query);
  if (!q || q.length < 2) return [];
  const scored = [];
  for (const item of (items || [])) {
    const rawName = item?.[nameKey] ?? item?.name ?? item?.title ?? "";
    const n = normalizeNameMatch(rawName);
    const score = scoreNameMatch(n, q);
    if (!score) continue;
    scored.push({ item, score, nameLen: n.length });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.nameLen - b.nameLen));
  return scored.slice(0, Math.max(1, Number(limit) || 5)).map((s) => s.item);
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

  return api(ctx, `/buckets/${projectId}/todos/${todoId}.json`, {
    method: "PUT",
    body: withIdempotency(body, updates)
  });
}

async function getTodo(ctx, projectId, todoId) {
  return api(ctx, `/buckets/${projectId}/todos/${todoId}.json`);
}

async function listTodosForListById(ctx, projectId, todolistId) {
  try {
    const list = await getTodoList(ctx, projectId, todolistId);
    return await listTodosForList(ctx, projectId, list);
  } catch (e) {
    if (isApiError(e, 404)) {
      const lists = await listTodoLists(ctx, projectId);
      const match = (lists || []).find((l) => String(l.id) === String(todolistId));
      if (match) return await listTodosForList(ctx, projectId, match);
    }
    throw e;
  }
}

async function completeTodo(ctx, projectId, todoId) {
  await api(ctx, `/buckets/${projectId}/todos/${todoId}/completion.json`, { method: "POST" });
  return { message: "Todo completed", todo_id: todoId };
}

async function uncompleteTodo(ctx, projectId, todoId) {
  await api(ctx, `/buckets/${projectId}/todos/${todoId}/completion.json`, { method: "DELETE" });
  return { message: "Todo marked incomplete", todo_id: todoId };
}

async function repositionTodo(ctx, projectId, todoId, position) {
  await api(ctx, `/buckets/${projectId}/todos/${todoId}/position.json`, { method: "PUT", body: { position } });
  return { message: "Todo repositioned", todo_id: todoId, position };
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

async function listAllOpenTodos(ctx, { archivedProjects = false, maxProjects = 0 } = {}) {
  const max = Number(maxProjects);
  const cap = Number.isFinite(max) && max > 0 ? max : null;
  const cacheKey = `openTodos:${ctx.accountId}:${archivedProjects}:${cap ?? "all"}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const projects = await listProjects(ctx, { archived: archivedProjects });
  const use = cap ? (projects || []).slice(0, cap) : (projects || []);

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
async function assignmentReport(ctx, projectName, { maxTodos = 0 } = {}) {
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
      if (maxTodos > 0 && open.length >= maxTodos) break;
    }
    if (maxTodos > 0 && open.length >= maxTodos) break;
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
    capped: maxTodos > 0 && open.length >= maxTodos,
    by_assignee,
  };
}

// ---------- Card Tables ----------
async function resolveCardTableFromDock(ctx, projectId) {
  const dock = await getDock(ctx, projectId);
  const card = dockFind(dock, ["card_table", "card_tables", "kanban", "kanban_board"]);
  if (!card) return null;

  if (card.url) {
    const obj = await api(ctx, card.url);
    if (Array.isArray(obj)) return obj[0] || null;
    return obj || null;
  }

  if (card.id) {
    return await api(ctx, `/buckets/${projectId}/card_tables/${card.id}.json`);
  }

  return null;
}

async function listCardTables(ctx, projectId, { includeArchived = false, onSource } = {}) {
  const emit = (source, count) => {
    if (typeof onSource === "function") onSource({ source, count });
    logDebug("[listCardTables] source=" + source + " count=", count);
  };

  // 1) Try the canonical list endpoint first (returns all tables when available).
  try {
    const tables = await apiAll(ctx, `/buckets/${projectId}/card_tables.json`);
    if (Array.isArray(tables) && tables.length) {
      emit("card_tables.json", tables.length);
      return tables;
    }
  } catch (e) {
    if (!isApiError(e, 404) && !isApiError(e, 403)) throw e;
    // fall through to dock/recordings strategy
  }

  // 2) Dock-first fallback (may return a single table).
  const dock = await getDock(ctx, projectId);
  const cards = dockFindAll(dock, ["card_table", "card_tables", "kanban", "kanban_board"]);
  const results = [];

  if (cards.length) {
    try {
      const fetched = await mapLimit(cards, 2, async (card) => {
        if (card.url) {
          const obj = await api(ctx, card.url);
          return Array.isArray(obj) ? obj : [obj];
        }
        if (card.id) {
          const obj = await api(ctx, `/buckets/${projectId}/card_tables/${card.id}.json`);
          return obj ? [obj] : [];
        }
        return [];
      });
      for (const batch of fetched) {
        if (Array.isArray(batch)) results.push(...batch);
      }
      if (results.length) emit("dock", results.length);
    } catch (inner) {
      if (isApiError(inner, 404) || isApiError(inner, 403)) {
        throw toolError("TOOL_UNAVAILABLE", "Card tables tool is not accessible for this project.", {
          tool: "card_tables",
          projectId,
          hint: "Enable Card Tables in the project's tools.",
          status: inner.status,
        });
      }
      throw inner;
    }
  }

  // 3) Use recordings list to discover boards.
  try {
    const base = `/projects/recordings.json?type=${encodeURIComponent("Kanban::Board")}&bucket=${projectId}`;
    const recs = await apiAll(ctx, includeArchived ? `${base}&status=archived` : base);
    const boards = Array.isArray(recs) ? recs : [];
    if (boards.length) {
      const fetched = await mapLimit(boards, 2, async (r) => {
        if (r?.url) return api(ctx, r.url);
        return null;
      });
      for (const b of fetched) {
        if (b) results.push(b);
      }
      if (results.length) emit(includeArchived ? "recordings:archived" : "recordings", results.length);
    }
  } catch (e) {
    if (!results.length && (isApiError(e, 404) || isApiError(e, 403))) {
      throw toolError("TOOL_NOT_ENABLED", "card_tables tool is not enabled for this project.", {
        tool: "card_tables",
        projectId,
        hint: "Enable Card Tables in the project's tools.",
        status: e.status,
      });
    }
  }

  // Dedupe by id.
  const seen = new Set();
  const deduped = [];
  for (const t of results) {
    const id = t?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(t);
  }

  emit("deduped", deduped.length);
  return deduped;
}

async function getCardTable(ctx, projectId, cardTableId) {
  return api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}.json`);
}

async function listCardTableColumns(ctx, projectId, cardTableId) {
  try {
    const table = await api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}.json`);
    return Array.isArray(table?.lists) ? table.lists : [];
  } catch (e) {
    if (isApiError(e, 404)) {
      try {
        const table = await resolveCardTableFromDock(ctx, projectId);
        if (table?.lists) return table.lists;
      } catch {
        // ignore dock fallback errors
      }
      try {
        await requireDockTool(ctx, projectId, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
      } catch (dockErr) {
        throw dockErr;
      }
      throw toolError("RESOURCE_NOT_FOUND", `Card table ${cardTableId} not found in this project.`, {
        tool: "card_tables",
        projectId,
        hint: "Call list_card_tables to get valid card table IDs.",
        status: 404,
      });
    }
    throw e;
  }
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

// Fetch cards from all columns in a card table (truncated per column for safety)
async function listCardTableCards(ctx, projectId, cardTableId, {
  maxCardsPerColumn = 0,
  includeDetails = false
} = {}) {
  try {
    // If no id provided, use dock to resolve the active card table.
    let resolvedTableId = cardTableId;
    let cardTable = null;

    if (resolvedTableId) {
      cardTable = await api(ctx, `/buckets/${projectId}/card_tables/${resolvedTableId}.json`);
    } else {
      cardTable = await resolveCardTableFromDock(ctx, projectId);
      resolvedTableId = cardTable?.id || null;
    }

    if (!cardTable?.lists) return { cards: [], columns: [], truncated: false };

    const summary = await summarizeCardTable(ctx, projectId, cardTable, {
      includeCards: true,
      maxCardsPerColumn
    });

    const cards = [];
    for (const col of summary.columns || []) {
      for (const c of col.cards || []) {
        cards.push(includeDetails ? c : {
          id: c.id,
          title: c.title,
          status: c.status,
          due_on: c.due_on,
          app_url: c.app_url
        });
      }
    }

    return { cards, columns: summary.columns || [], truncated: summary.truncated };
  } catch (e) {
    if (isApiError(e, 404)) {
      // Retry via dock if the provided card table id is stale/wrong
      try {
        const cardTable = await resolveCardTableFromDock(ctx, projectId);
        if (cardTable?.lists) {
          const summary = await summarizeCardTable(ctx, projectId, cardTable, {
            includeCards: true,
            maxCardsPerColumn
          });
          const cards = [];
          for (const col of summary.columns || []) {
            for (const c of col.cards || []) {
              cards.push(includeDetails ? c : {
                id: c.id,
                title: c.title,
                status: c.status,
                due_on: c.due_on,
                app_url: c.app_url
              });
            }
          }
          return { cards, columns: summary.columns || [], truncated: summary.truncated };
        }
      } catch {
        // ignore dock fallback errors
      }
      try {
        await requireDockTool(ctx, projectId, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
      } catch (dockErr) {
        throw dockErr;
      }
      throw toolError("RESOURCE_NOT_FOUND", `Card table ${cardTableId} not found in this project.`, {
        tool: "card_tables",
        projectId,
        hint: "Call list_card_tables to get valid card table IDs.",
        status: 404,
      });
    }
    console.error(`[listCardTableCards] Error fetching cards for card table ${cardTableId}:`, e.message);
    return { cards: [], columns: [], truncated: false };
  }
}

async function summarizeCardTable(ctx, projectId, table, {
  includeCards = false,
  maxCardsPerColumn = 0
} = {}) {
  let full = table;
  if (!full?.lists && full?.url) {
    full = await api(ctx, full.url);
  } else if (!full?.lists && full?.id) {
    full = await api(ctx, `/buckets/${projectId}/card_tables/${full.id}.json`);
  }

  const columns = (full?.lists || []).map((col) => ({
    id: col.id,
    title: col.title,
    type: col.type,
    cards_count: col.cards_count ?? null,
    cards: []
  }));

  let truncated = false;
  if (includeCards) {
    for (const col of columns) {
      const colUrl = (full?.lists || []).find((c) => c.id === col.id)?.cards_url;
      if (!colUrl) continue;
      const cards = await apiAll(ctx, colUrl);
      const arr = Array.isArray(cards) ? cards : [];
      const limit = Number(maxCardsPerColumn);
      if (Number.isFinite(limit) && limit > 0) {
        if (arr.length > limit) truncated = true;
        col.cards = arr.slice(0, limit);
      } else {
        col.cards = arr;
      }
    }
  }

  return {
    id: full?.id,
    title: full?.title,
    status: full?.status,
    type: full?.type,
    total_columns: columns.length,
    total_cards: columns.reduce((sum, c) => sum + (Number(c.cards_count) || 0), 0),
    columns,
    truncated
  };
}

async function listProjectCardTableContents(ctx, projectId, {
  includeDetails = false,
  includeCards = true,
  maxCardsPerColumn = 0,
  cursor = 0,
  maxBoards = 2,
  autoAll = false,
  maxBoardsTotal = 0,
  cacheOutput = false,
  cacheChunkBoards = 1
} = {}) {
  const tables = await listCardTables(ctx, projectId);
  const start = Math.max(0, Number(cursor) || 0);
  const count = Math.max(1, Number(maxBoards) || 1);
  const limitValue = Number(maxBoardsTotal);
  const capActive = Number.isFinite(limitValue) && limitValue > 0;
  const limit = capActive ? limitValue : (tables || []).length;

  const boards = [];
  let idx = start;
  let done = false;

  while (!done) {
    const slice = autoAll ? tables.slice(idx, idx + count) : tables.slice(start, start + count);
    if (!slice.length) {
      done = true;
      break;
    }

    for (const t of slice) {
      const summary = await summarizeCardTable(ctx, projectId, t, {
        includeCards,
        maxCardsPerColumn
      });
      if (!includeDetails) {
        summary.columns = (summary.columns || []).map((col) => ({
          id: col.id,
          title: col.title,
          type: col.type,
          cards_count: col.cards_count,
          cards: (col.cards || []).map((c) => ({
            id: c.id,
            title: c.title,
            status: c.status,
            due_on: c.due_on,
            app_url: c.app_url
          }))
        }));
      }
      boards.push(summary);
      if (boards.length >= limit) {
        done = true;
        break;
      }
    }

    if (!autoAll) break;
    idx += slice.length;
    if (idx >= tables.length) done = true;
  }

  const next_cursor = autoAll
    ? (idx < tables.length && boards.length < limit ? idx : null)
    : (start + count < tables.length ? start + count : null);

  const totalCards = boards.reduce((sum, b) => sum + (Number(b.total_cards) || 0), 0);
  const boardSummaries = boards.map((b) => ({
    id: b.id,
    title: b.title,
    status: b.status,
    total_columns: b.total_columns,
    total_cards: b.total_cards,
    truncated: b.truncated
  }));
  const coverage = {
    total_boards: Array.isArray(tables) ? tables.length : 0,
    boards_returned: boards.length,
    cards_total: totalCards,
    include_details: !!includeDetails,
    include_cards: !!includeCards,
    max_cards_per_column: Number(maxCardsPerColumn) || 0,
    cursor: autoAll ? idx : start,
    next_cursor,
    truncated: capActive && boards.length >= limit
  };
  const shouldCache = !!cacheOutput || !!autoAll || !!includeDetails || totalCards > DEFAULT_INLINE_LIMIT;
  if (shouldCache) {
    const payload = { card_tables: boards };
    const cached = putLargePayload(payload, { chunkSizeBoards: cacheChunkBoards });
    const exported = exportLargePayloadToFile(cached.key);
    return {
      payload_key: cached.key,
      chunk_count: cached.chunkCount,
      first_chunk: cached.firstChunk,
      export: exported,
      summary: { boards: boardSummaries, total_boards: coverage.total_boards, total_cards: totalCards },
      coverage,
      total: tables.length,
      total_cards: totalCards,
      next_cursor,
      cursor: autoAll ? idx : start,
      truncated: capActive && boards.length >= limit
    };
  }

  return {
    boards,
    summary: { boards: boardSummaries, total_boards: coverage.total_boards, total_cards: totalCards },
    coverage,
    next_cursor,
    total: tables.length,
    cursor: autoAll ? idx : start,
    truncated: capActive && boards.length >= limit
  };
}

async function listCardTableSummaries(ctx, projectId, {
  includeCards = false,
  maxCardsPerColumn = 0,
  includeArchived = false
} = {}) {
  const tables = await listCardTables(ctx, projectId, { includeArchived });
  return mapLimit(tables || [], 1, (t) =>
    summarizeCardTable(ctx, projectId, t, { includeCards, maxCardsPerColumn })
  );
}

async function listCardTableSummariesIter(ctx, projectId, {
  includeCards = false,
  maxCardsPerColumn = 0,
  includeArchived = false,
  cursor = 0
} = {}) {
  const tables = await listCardTables(ctx, projectId, { includeArchived });
  const total = Array.isArray(tables) ? tables.length : 0;
  const index = Math.max(0, Number(cursor) || 0);
  if (!total || index >= total) {
    return { done: true, cursor: null, total, card_table: null };
  }

  const cardTable = await summarizeCardTable(ctx, projectId, tables[index], {
    includeCards,
    maxCardsPerColumn
  });
  const nextCursor = index + 1 < total ? index + 1 : null;

  return { done: nextCursor == null, cursor: nextCursor, total, card_table: cardTable };
}

async function getCard(ctx, projectId, cardId) {
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`);
}

async function resolveCardRecordingId(ctx, projectId, cardId) {
  const card = await getCard(ctx, projectId, cardId);
  const recordingId = card?.recording?.id || card?.recording_id || null;
  return { card, recording_id: recordingId };
}

async function createCard(ctx, projectId, cardTableId, { title, content, description, column_id, due_on, position, idempotency_key } = {}) {
  const body = { title };
  const cardContent = firstDefined(content, description);
  if (cardContent) body.content = cardContent;
  if (due_on) body.due_on = due_on;
  if (position != null) body.position = position;
  // Note: column_id is the list/column to create the card in
  // If column_id not provided, fall back to the first available column
  let targetColumnId = column_id;
  if (!targetColumnId) {
    const table = await api(ctx, `/buckets/${projectId}/card_tables/${cardTableId}.json`);
    const lists = Array.isArray(table?.lists) ? table.lists : [];
    const fallback = lists.find((l) => l.type === "Kanban::Triage")
      || lists.find((l) => l.type === "Kanban::Column")
      || lists[0];
    targetColumnId = fallback?.id || null;
  }
  if (!targetColumnId) throw new Error("column_id (list/column ID) is required to create a card");
  return api(ctx, `/buckets/${projectId}/card_tables/lists/${targetColumnId}/cards.json`, {
    method: "POST",
    body: withIdempotency(body, { idempotency_key })
  });
}

async function updateCard(ctx, projectId, cardId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`, {
    method: "PUT",
    body: withIdempotency(body, body)
  });
}

async function moveCard(ctx, projectId, cardId, { column_id, position, idempotency_key } = {}) {
  const body = {};
  if (column_id) body.column_id = column_id;
  if (position != null) body.position = position;
  // Move endpoint: POST /buckets/{id}/card_tables/cards/{id}/moves.json
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}/moves.json`, {
    method: "POST",
    body: withIdempotency(body, { idempotency_key })
  });
}

async function archiveCard(ctx, projectId, cardId) {
  const resolved = await resolveCardRecordingId(ctx, projectId, cardId);
  if (!resolved.recording_id) throw new Error("Card recording id not found.");
  return archiveRecording(ctx, projectId, resolved.recording_id);
}

async function unarchiveCard(ctx, projectId, cardId) {
  const resolved = await resolveCardRecordingId(ctx, projectId, cardId);
  if (!resolved.recording_id) throw new Error("Card recording id not found.");
  return unarchiveRecording(ctx, projectId, resolved.recording_id);
}

async function trashCard(ctx, projectId, cardId) {
  const resolved = await resolveCardRecordingId(ctx, projectId, cardId);
  if (!resolved.recording_id) throw new Error("Card recording id not found.");
  return trashRecording(ctx, projectId, resolved.recording_id);
}

// ---------- Hill Charts ----------
async function getHillChartFromDock(ctx, projectId) {
  const { tool: hill } = await requireDockTool(ctx, projectId, ["hill_chart", "hill_charts"], "hill_charts");
  if (hill.url) return api(ctx, hill.url);
  if (hill.id) return api(ctx, `/buckets/${projectId}/hill_charts/${hill.id}.json`);
  throw toolError("TOOL_UNAVAILABLE", "Hill chart tool is enabled but missing a usable URL.", {
    tool: "hill_charts",
    projectId,
  });
}

// ---------- Messages / Docs / Schedule (dock-driven) ----------
async function listMessageBoards(ctx, projectId) {
  const { tool: mb } = await requireDockTool(ctx, projectId, ["message_board", "message_boards"], "message_boards");
  if (!mb?.url) {
    throw toolError("TOOL_UNAVAILABLE", "Message boards tool is enabled but missing a usable URL.", {
      tool: "message_boards",
      projectId,
    });
  }
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
  const msgs = await apiAllWithMeta(ctx, board.messages_url);
  const { items, meta } = unwrapItemsWithMeta(msgs);
  const arr = Array.isArray(items) ? items : [];
  if (meta) arr._meta = meta;
  
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
  if (arr._meta) mapped._meta = arr._meta;
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
  return api(ctx, `/buckets/${projectId}/message_boards/${boardId}/messages.json`, {
    method: "POST",
    body: withIdempotency(body, body)
  });
}

async function updateMessage(ctx, projectId, messageId, body) {
  return api(ctx, `/buckets/${projectId}/messages/${messageId}.json`, {
    method: "PUT",
    body: withIdempotency(body, body)
  });
}

async function listDocuments(ctx, projectId, { limit } = {}) {
  const { tool: vault } = await requireDockTool(ctx, projectId, ["vault", "documents"], "documents");
  if (!vault?.url) {
    throw toolError("TOOL_UNAVAILABLE", "Documents tool is enabled but missing a usable URL.", {
      tool: "documents",
      projectId,
    });
  }
  const vaultObj = await api(ctx, vault.url);
  // Many vault payloads include a documents_url.
  const docsUrl = vaultObj?.documents_url || vaultObj?.documents?.url || vaultObj?.documents;
  if (!docsUrl) throw new Error("Could not locate documents_url on vault payload.");
  const docs = await apiAllWithMeta(ctx, docsUrl);
  const { items, meta } = unwrapItemsWithMeta(docs);
  const arr = Array.isArray(items) ? items : [];
  if (meta) arr._meta = meta;
  
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
  if (arr._meta) mapped._meta = arr._meta;
  if (limit != null) return mapped.slice(0, Math.max(0, Number(limit) || 0));
  return mapped;
}

async function getDocument(ctx, projectId, documentId) {
  return api(ctx, `/buckets/${projectId}/documents/${documentId}.json`);
}

async function createDocument(ctx, projectId, vaultId, body) {
  if (!vaultId) throw new Error("vault_id is required to create a document.");
  return api(ctx, `/buckets/${projectId}/vaults/${vaultId}/documents.json`, {
    method: "POST",
    body: withIdempotency(body, body)
  });
}

async function updateDocument(ctx, projectId, documentId, body) {
  return api(ctx, `/buckets/${projectId}/documents/${documentId}.json`, {
    method: "PUT",
    body: withIdempotency(body, body)
  });
}

async function listScheduleEntries(ctx, projectId, { limit } = {}) {
  const { tool: schedule } = await requireDockTool(ctx, projectId, ["schedule", "schedules"], "schedule");
  if (!schedule?.url) {
    throw toolError("TOOL_UNAVAILABLE", "Schedule tool is enabled but missing a usable URL.", {
      tool: "schedule",
      projectId,
    });
  }
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
  return api(ctx, `/buckets/${projectId}/schedules/${scheduleId}/entries.json`, {
    method: "POST",
    body: withIdempotency(body, body)
  });
}

async function updateScheduleEntry(ctx, projectId, entryId, body) {
  return api(ctx, `/buckets/${projectId}/schedule_entries/${entryId}.json`, {
    method: "PUT",
    body: withIdempotency(body, body)
  });
}

// ========== PEOPLE ENDPOINTS ==========
function normalizePerson(p) {
  if (!p || typeof p !== "object") return p;
  return {
    id: p.id,
    name: p.name,
    email: p.email_address || p.email || null,
    title: p.title,
    admin: p.admin,
    owner: p.owner,
    client: p.client,
    employee: p.employee,
    avatar_url: p.avatar_url,
    app_url: p.app_url,
  };
}

function normalizeSearchTokens(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9@\s.\-_+]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function personMatchesQuery(person, query) {
  const tokens = normalizeSearchTokens(query);
  if (!tokens.length) return true;
  const name = String(person?.name || "").toLowerCase();
  const email = String(person?.email || "").toLowerCase();
  return tokens.every(t => name.includes(t) || email.includes(t));
}

async function searchPeople(ctx, query, { include_archived_projects = false, deepScan = true } = {}) {
  const initial = await listAllPeople(ctx, { deepScan: false });
  let matches = (initial || []).filter((p) => personMatchesQuery(p, query));
  let deepScanUsed = false;
  let archivedScanUsed = false;

  if (!matches.length && deepScan) {
    deepScanUsed = true;
    const full = await listAllPeople(ctx, { deepScan: true, include_archived_projects });
    matches = (full || []).filter((p) => personMatchesQuery(p, query));
  }

  if (!matches.length && deepScan && !include_archived_projects) {
    archivedScanUsed = true;
    const fullArchived = await listAllPeople(ctx, { deepScan: true, include_archived_projects: true });
    matches = (fullArchived || []).filter((p) => personMatchesQuery(p, query));
  }

  return { people: matches, deep_scan: deepScanUsed, archived_scan: archivedScanUsed };
}

async function searchEntities(ctx, query, {
  project = null,
  include_archived_projects = false,
  include_recordings = true,
  include_todos = true,
  include_people = true,
  include_projects = true,
  include_cards = true,
  limit = 20
} = {}) {
  const q = String(query || "").trim();
  if (!q) return { query: q, results: {} };

  let projectId = null;
  let projectObj = null;
  if (project) {
    try {
      const p = await projectByName(ctx, project);
      projectId = p?.id || null;
      projectObj = p ? { id: p.id, name: p.name } : null;
    } catch (_) {
      projectId = null;
    }
  }

  const results = {};
  const sources = {};

  if (include_people) {
    const peopleResult = await searchPeople(ctx, q, { include_archived_projects, deepScan: true });
    results.people = (peopleResult.people || []).slice(0, limit);
    sources.people = {
      count: results.people.length,
      deep_scan: peopleResult.deep_scan,
      archived_scan: peopleResult.archived_scan === true
    };
  }

  if (include_projects) {
    const projResult = await searchProjects(ctx, q, { include_archived_projects, limit });
    results.projects = projResult.projects || [];
    sources.projects = {
      count: results.projects.length,
      total_scanned: projResult.coverage?.total_scanned ?? null,
      archived_scan: projResult.coverage?.archived_scan ?? false
    };
  }

  if (include_recordings) {
    try {
      const recordings = await searchRecordings(ctx, q, { bucket_id: projectId });
      results.recordings = (recordings || []).slice(0, limit);
      sources.recordings = { count: results.recordings.length, scoped: !!projectId };
    } catch (e) {
      sources.recordings = { count: 0, error: e?.message || String(e) };
    }
  }

  if (include_todos) {
    try {
      const todos = await searchRecordings(ctx, q, { bucket_id: projectId, type: "todo" });
      results.todos = (todos || []).slice(0, limit);
      sources.todos = { count: results.todos.length, scoped: !!projectId };
    } catch (e) {
      sources.todos = { count: 0, error: e?.message || String(e) };
    }
  }

  if (include_cards) {
    const cardResult = await searchCards(ctx, q, {
      project: projectObj?.name || project || null,
      include_archived_projects,
      limit
    });
    results.cards = cardResult.cards || [];
    sources.cards = { count: results.cards.length, ...cardResult.coverage };
  }

  return {
    query: q,
    project: projectObj,
    sources,
    results
  };
}

function mergePeopleLists(primary, secondary) {
  const out = [];
  const seen = new Map();
  for (const p of primary || []) {
    if (!p) continue;
    const key = p.id != null ? `id:${p.id}` : (p.email ? `email:${p.email}` : `name:${p.name}`);
    seen.set(key, { ...p });
    out.push(seen.get(key));
  }
  for (const p of secondary || []) {
    if (!p) continue;
    const key = p.id != null ? `id:${p.id}` : (p.email ? `email:${p.email}` : `name:${p.name}`);
    if (seen.has(key)) {
      const existing = seen.get(key);
      for (const [k, v] of Object.entries(p)) {
        if (existing[k] == null && v != null) existing[k] = v;
      }
      continue;
    }
    const cloned = { ...p };
    seen.set(key, cloned);
    out.push(cloned);
  }
  return out;
}

async function listPeopleFromProjects(ctx, { include_archived = false } = {}) {
  const cacheKey = `people:deep:${ctx.accountId}:${include_archived ? "archived" : "active"}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const projects = await listProjects(ctx, { archived: !!include_archived, compact: true });
  logPeopleDebug("[listPeopleFromProjects] projects", {
    accountId: ctx?.accountId ?? null,
    include_archived: !!include_archived,
    count: Array.isArray(projects) ? projects.length : 0
  });
  const peopleMap = new Map();

  for (const project of projects || []) {
    if (!project?.id) continue;
    let projectPeople = [];
    try {
      projectPeople = await listProjectPeople(ctx, project.id);
    } catch (e) {
      continue;
    }
    for (const person of projectPeople || []) {
      const norm = normalizePerson(person);
      const key = norm?.id != null ? `id:${norm.id}` : (norm?.email ? `email:${norm.email}` : `name:${norm?.name || ""}`);
      if (!peopleMap.has(key)) {
        peopleMap.set(key, { ...norm, project_ids: [project.id] });
      } else {
        const existing = peopleMap.get(key);
        if (!existing.project_ids) existing.project_ids = [];
        existing.project_ids.push(project.id);
      }
    }
  }

  const list = Array.from(peopleMap.values());
  logPeopleDebug("[listPeopleFromProjects] people", {
    accountId: ctx?.accountId ?? null,
    include_archived: !!include_archived,
    count: list.length
  });
  cacheSet(cacheKey, list);
  return list;
}

async function listAllPeople(ctx, { deepScan = false, include_archived_projects = false } = {}) {
  const people = await apiAllWithMeta(ctx, `/people.json`, { maxPages: 200 });
  let arr = [];
  let meta = null;
  if (Array.isArray(people)) {
    arr = people;
  } else if (people && Array.isArray(people.items)) {
    arr = people.items;
    meta = people._meta || null;
  } else if (people && Array.isArray(people.people)) {
    arr = people.people;
  } else if (people && Array.isArray(people.data)) {
    arr = people.data;
  }
  let source = "people";

  if (!arr.length) {
    try {
      const pingable = await apiAllWithMeta(ctx, `/circles/people.json`, { maxPages: 200 });
      let parr = [];
      let pmeta = null;
      if (Array.isArray(pingable)) {
        parr = pingable;
      } else if (pingable && Array.isArray(pingable.items)) {
        parr = pingable.items;
        pmeta = pingable._meta || null;
      } else if (pingable && Array.isArray(pingable.people)) {
        parr = pingable.people;
      } else if (pingable && Array.isArray(pingable.data)) {
        parr = pingable.data;
      }
      if (parr.length) {
        arr = parr;
        meta = pmeta || meta;
        source = "circles";
      }
    } catch (e) {
      // ignore fallback errors, we'll just return empty
    }
  }

  logPeopleDebug("[listAllPeople] result", {
    accountId: ctx?.accountId ?? null,
    source,
    count: arr.length,
    meta: meta || null
  });

  let normalized = arr.map(normalizePerson);

  if (deepScan) {
    try {
      const projectPeople = await listPeopleFromProjects(ctx, { include_archived: include_archived_projects });
      if (Array.isArray(projectPeople) && projectPeople.length) {
        normalized = mergePeopleLists(normalized, projectPeople);
        source = source === "people" ? "people+projects" : `${source}+projects`;
      }
    } catch (e) {
      // ignore deep scan errors
    }
  }

  if (meta) {
    normalized._meta = meta;
  }
  return normalized;
}

async function listPingablePeople(ctx) {
  const people = await apiAllWithMeta(ctx, `/circles/people.json`, { maxPages: 200 });
  let arr = [];
  let meta = null;
  if (Array.isArray(people)) {
    arr = people;
  } else if (people && Array.isArray(people.items)) {
    arr = people.items;
    meta = people._meta || null;
  } else if (people && Array.isArray(people.people)) {
    arr = people.people;
  } else if (people && Array.isArray(people.data)) {
    arr = people.data;
  }
  const normalized = arr.map(normalizePerson);
  if (meta) {
    normalized._meta = meta;
  }
  return normalized;
}

async function searchProjects(ctx, query, { include_archived_projects = false, limit = 20 } = {}) {
  const projects = await listProjects(ctx, { archived: include_archived_projects, compact: true });
  let matches = findNameMatches(projects, query, { limit });
  let archivedScanUsed = false;

  if (!matches.length && !include_archived_projects) {
    archivedScanUsed = true;
    const archived = await listProjects(ctx, { archived: true, compact: true });
    matches = findNameMatches(archived, query, { limit });
  }

  return {
    projects: matches,
    coverage: {
      total_scanned: Array.isArray(projects) ? projects.length : 0,
      archived_scan: archivedScanUsed
    }
  };
}

function normalizeCardHit(card, { projectId = null, cardTableId = null, columnId = null, columnTitle = null } = {}) {
  if (!card) return null;
  return {
    id: card.id,
    title: card.title || card.name || card.content || null,
    content: card.content || card.description || null,
    status: card.status || null,
    bucket_id: card.bucket?.id || card.bucket_id || projectId || null,
    project_id: projectId || card.bucket?.id || card.bucket_id || null,
    card_table_id: cardTableId || card.card_table_id || null,
    column_id: columnId || card.column_id || null,
    column_title: columnTitle || null,
    app_url: card.app_url || card.url || null,
    url: card.url || card.app_url || null
  };
}

function cardMatchesQuery(card, query) {
  const tokens = normalizeSearchTokens(query);
  if (!tokens.length) return true;
  const title = String(card?.title || card?.name || card?.content || "").toLowerCase();
  const content = String(card?.content || card?.description || "").toLowerCase();
  return tokens.every((t) => title.includes(t) || content.includes(t));
}

async function searchCards(ctx, query, {
  project = null,
  include_archived_projects = false,
  limit = 20,
  max_cards_per_column = 0
} = {}) {
  const q = String(query || "").trim();
  if (!q) return { cards: [], coverage: { reason: "MISSING_QUERY" } };

  let projectId = null;
  let projectObj = null;
  if (project) {
    try {
      const p = await projectByName(ctx, project);
      projectId = p?.id || null;
      projectObj = p ? { id: p.id, name: p.name } : null;
    } catch (_) {
      projectId = null;
    }
  }

  if (/^\d+$/.test(q) && projectId) {
    const byId = await findCardInProjectById(ctx, projectId, q);
    if (byId) {
      return {
        cards: [normalizeCardHit(byId, { projectId })],
        project: projectObj,
        coverage: { source: "id_lookup", project_scoped: true }
      };
    }
  }

  const indexHits = searchIndex(q, { type: "card", projectId, limit: Math.max(50, limit), userKey: ctx.userKey });
  if (Array.isArray(indexHits) && indexHits.length) {
    const mapped = indexHits.map((hit) => ({
      id: Number(hit.object_id),
      title: hit.title,
      content: hit.content || null,
      project_id: hit.project_id || projectId || null,
      app_url: hit.url || null,
      source: "index"
    }));
    return {
      cards: mapped.slice(0, limit),
      project: projectObj,
      coverage: {
        source: "index",
        index_hits: indexHits.length,
        project_scoped: !!projectId
      }
    };
  }

  if (!projectId) {
    return {
      cards: [],
      project: null,
      coverage: {
        source: "index",
        project_scoped: false,
        reason: "PROJECT_REQUIRED"
      }
    };
  }

  const tables = await listCardTables(ctx, projectId);
  let matches = [];
  let cardsScanned = 0;
  let tablesScanned = 0;
  let truncated = false;

  for (const table of tables || []) {
    tablesScanned += 1;
    let summary;
    try {
      summary = await summarizeCardTable(ctx, projectId, table, {
        includeCards: true,
        maxCardsPerColumn: max_cards_per_column
      });
    } catch {
      continue;
    }
    for (const col of summary.columns || []) {
      for (const card of col.cards || []) {
        cardsScanned += 1;
        if (cardMatchesQuery(card, q)) {
          const normalized = normalizeCardHit(card, {
            projectId,
            cardTableId: summary.id,
            columnId: col.id,
            columnTitle: col.title
          });
          if (normalized) matches.push(normalized);
          if (matches.length >= limit) break;
        }
      }
      if (matches.length >= limit) break;
    }
    if (summary.truncated) truncated = true;
    if (matches.length >= limit) break;
  }

  return {
    cards: matches,
    project: projectObj,
    coverage: {
      source: "scan",
      project_scoped: true,
      tables_scanned: tablesScanned,
      cards_scanned: cardsScanned,
      truncated
    }
  };
}

async function resolvePersonQuery(ctx, personQuery, { include_archived_projects = false } = {}) {
  const raw = String(personQuery ?? "").trim();
  if (!raw) return { person: null, matches: [] };
  if (/^\d+$/.test(raw)) {
    try {
      const person = await getPerson(ctx, Number(raw));
      return { person, matches: [person] };
    } catch (_) {
      // fall through to search
    }
  }
  const result = await searchPeople(ctx, raw, { include_archived_projects, deepScan: true });
  const matches = result.people || [];
  if (matches.length === 1) return { person: matches[0], matches };
  return { person: null, matches };
}

async function listPersonProjects(ctx, personQuery, { include_archived_projects = false } = {}) {
  const resolved = await resolvePersonQuery(ctx, personQuery, { include_archived_projects });
  if (!resolved.person) {
    return { person: null, matches: resolved.matches || [] };
  }

  const people = await listPeopleFromProjects(ctx, { include_archived: include_archived_projects });
  const targetId = resolved.person.id;
  const targetEmail = String(resolved.person.email || "").toLowerCase();
  const targetName = String(resolved.person.name || "").toLowerCase();
  const match = (people || []).find((p) => {
    if (targetId != null && p.id === targetId) return true;
    if (targetEmail && String(p.email || "").toLowerCase() === targetEmail) return true;
    return targetName && String(p.name || "").toLowerCase() === targetName;
  });

  const projectIds = Array.isArray(match?.project_ids) ? match.project_ids : [];
  const projects = await listProjects(ctx, { archived: include_archived_projects, compact: true });
  const projectMap = new Map((projects || []).map((p) => [p.id, p]));
  const mapped = projectIds
    .map((id) => projectMap.get(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: p.name, status: p.status || null, app_url: p.app_url || null }));

  return {
    person: resolved.person,
    projects: mapped,
    coverage: {
      projects_scanned: Array.isArray(projects) ? projects.length : 0,
      include_archived_projects: !!include_archived_projects
    }
  };
}

async function auditPerson(ctx, personQuery, {
  include_archived_projects = false,
  include_assignments = true,
  include_activity = true,
  activity_limit = 50
} = {}) {
  const resolved = await resolvePersonQuery(ctx, personQuery, { include_archived_projects });
  if (!resolved.person) {
    return { person: null, matches: resolved.matches || [] };
  }

  const personId = Number(resolved.person.id);
  const projectsResult = await listPersonProjects(ctx, String(resolved.person.id), { include_archived_projects });
  const projects = projectsResult.projects || [];

  let assignments = null;
  if (include_assignments && Number.isFinite(personId)) {
    try {
      assignments = await reportTodosAssignedPerson(ctx, personId);
    } catch (e) {
      assignments = { error: e?.message || String(e) };
    }
  }

  let activity = null;
  if (include_activity) {
    try {
      const activityResult = await listPersonActivity(ctx, String(resolved.person.id), {
        include_archived_projects,
        limit: Number.isFinite(Number(activity_limit)) ? Number(activity_limit) : 50
      });
      activity = activityResult?.events || activityResult || null;
    } catch (e) {
      activity = { error: e?.message || String(e) };
    }
  }

  return {
    person: resolved.person,
    projects,
    assignments,
    activity,
    coverage: {
      projects_scanned: projectsResult.coverage?.projects_scanned ?? null,
      include_archived_projects: !!include_archived_projects,
      assignments_included: !!include_assignments,
      activity_included: !!include_activity
    }
  };
}

async function listPersonActivity(ctx, personQuery, {
  project = null,
  query = "",
  include_archived_projects = false,
  limit = 50
} = {}) {
  const resolved = await resolvePersonQuery(ctx, personQuery, { include_archived_projects });
  if (!resolved.person) {
    return { person: null, matches: resolved.matches || [] };
  }

  let projectId = null;
  if (project) {
    try {
      const p = await projectByName(ctx, project);
      projectId = p?.id || null;
    } catch {
      projectId = null;
    }
  }

  let arr = [];
  let source = "user_timeline";
  try {
    const events = await userTimeline(ctx, Number(resolved.person.id), query || "");
    arr = Array.isArray(events) ? events : [];
  } catch (e) {
    if (query) {
      source = "search_recordings";
      const recordings = await searchRecordings(ctx, query, { bucket_id: projectId, creator_id: resolved.person.id });
      arr = Array.isArray(recordings) ? recordings : [];
    } else {
      throw e;
    }
  }
  if (projectId) {
    arr = arr.filter((e) => {
      const bucketId = e?.bucket?.id || e?.project?.id || e?.bucket_id || e?.project_id;
      return Number(bucketId) === Number(projectId);
    });
  }
  if (query && arr.length === 0) {
    const recordings = await searchRecordings(ctx, query, { bucket_id: projectId, creator_id: resolved.person.id });
    arr = Array.isArray(recordings) ? recordings : [];
    source = "search_recordings";
  }
  if (Number.isFinite(Number(limit)) && arr.length > Number(limit)) {
    arr = arr.slice(0, Number(limit));
  }

  return {
    person: resolved.person,
    project_id: projectId,
    events: arr,
    coverage: {
      source,
      project_scoped: !!projectId,
      events_returned: arr.length
    }
  };
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
  const people = await apiAllWithMeta(ctx, `/projects/${projectId}/people.json`);
  const { items, meta } = unwrapItemsWithMeta(people);
  const arr = Array.isArray(items) ? items : [];
  if (meta) arr._meta = meta;
  const mapped = arr.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email_address,
    title: p.title,
    avatar_url: p.avatar_url,
    app_url: p.app_url,
  }));
  if (arr._meta) mapped._meta = arr._meta;
  return mapped;
}

async function updateProjectPeople(ctx, projectId, body) {
  return api(ctx, `/projects/${projectId}/people/users.json`, {
    method: "PUT",
    body: withIdempotency(body, body)
  });
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
            // Not a recording or a todo — try card lookup first
            try {
              const cardJson = await api(ctx, `/buckets/${projectId}/card_tables/cards/${recordingId}.json`);
              console.log(`[listComments] Found ID ${recordingId} as a card — fetching its comments`);
              meta.resolvedType = "card";
              meta.usedRecordingId = recordingId;
              meta.matchedTitle = cardJson?.title || null;
              const cardRecordingId = cardJson?.recording?.id || cardJson?.recording_id || null;
              commentsUrl = cardJson?.comments_url
                || (cardRecordingId ? `/buckets/${projectId}/recordings/${cardRecordingId}/comments.json` : null)
                || `/buckets/${projectId}/card_tables/cards/${recordingId}/comments.json`;
              commentsCount = typeof cardJson?.comments_count === 'number' ? cardJson.comments_count : null;
              recordingJson = cardJson;
            } catch (cardErr) {
              // ignore and try search below
            }

            if (!commentsUrl) {
              // Not a recording, todo, or card — try fuzzy search by ID
              console.log(`[listComments] ID ${recordingId} not found as recording or todo — attempting search`);
              
              let results = await searchRecordings(ctx, recordingId, { bucket_id: projectId });
              let arr = Array.isArray(results) ? results : [];
              if (!arr.length) {
                try {
                  results = await searchRecordings(ctx, recordingId);
                  arr = Array.isArray(results) ? results : [];
                } catch (_) {
                  arr = [];
                }
              }
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
                console.warn(`[listComments] ID ${recordingId} not found as recording, todo, card, or search result in project ${projectId}`);
                return { comments: [], _meta: { ...meta, error: "NOT_FOUND", message: `Recording, todo, or card with ID ${recordingId} not found in project ${projectId}` } };
              }
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
      if (meta.resolvedType !== "card") {
        try {
          const cardCommentsUrl = `/buckets/${projectId}/card_tables/cards/${recordingId}/comments.json`;
          const cardComments = await apiAll(ctx, cardCommentsUrl);
          const arr = Array.isArray(cardComments) ? cardComments : [];
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
          return { comments: mapped, _meta: { ...meta, resolvedType: "card", comments_supported: true, comments_count: arr.length } };
        } catch (cardErr) {
          // fall through to empty result
        }
      }
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

async function resolveRecordingForComment(ctx, recordingId, projectId) {
  const idStr = String(recordingId ?? "").trim();
  if (!idStr) return null;
  let results = [];
  try {
    results = await searchRecordings(ctx, idStr, { bucket_id: projectId });
  } catch (_) {
    results = [];
  }
  let match = (results || []).find(r => String(r.id) === idStr);
  if (match) return match;
  try {
    results = await searchRecordings(ctx, idStr);
  } catch (_) {
    results = [];
  }
  match = (results || []).find(r => String(r.id) === idStr);
  return match || null;
}

async function resolveRecordingByQuery(ctx, query, projectId) {
  const q = String(query ?? "").trim();
  if (!q) return null;
  let results = [];
  try {
    results = await searchRecordings(ctx, q, { bucket_id: projectId });
  } catch (_) {
    results = [];
  }
  if (!results.length) {
    try {
      results = await searchRecordings(ctx, q);
    } catch (_) {
      results = [];
    }
  }
  const candidates = (results || []).map((r) => ({
    id: r.id,
    name: r.title || r.content || r.plain_text_content || "",
    raw: r
  }));
  const best = resolveBestEffort(candidates, q) || candidates[0];
  return best?.raw || null;
}

async function findCardInProjectById(ctx, projectId, cardId) {
  const idStr = String(cardId ?? "").trim();
  if (!idStr) return null;
  let tables = [];
  try {
    tables = await listCardTables(ctx, projectId);
  } catch (_) {
    tables = [];
  }
  if (!Array.isArray(tables) || !tables.length) return null;
  for (const t of tables) {
    try {
      const summary = await summarizeCardTable(ctx, projectId, t, {
        includeCards: true,
        maxCardsPerColumn: 0
      });
      for (const col of summary.columns || []) {
        const hit = (col.cards || []).find((c) => String(c.id) === idStr);
        if (hit) return hit;
      }
    } catch (_) {
      // ignore and keep scanning tables
    }
  }
  return null;
}

function parseBasecampUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw || !raw.includes("basecamp.com")) return null;

  const cleaned = raw.replace(/[)>.,]+$/, "");
  const accountMatch = cleaned.match(/basecamp\.com\/(\d+)/i);
  const accountId = accountMatch ? accountMatch[1] : null;

  const patterns = [
    { type: "comment", re: /\/buckets\/(\d+)\/recordings\/(\d+)\/comments\/(\d+)/i, map: (m) => ({ bucket_id: m[1], recording_id: m[2], comment_id: m[3] }) },
    { type: "comment", re: /\/buckets\/(\d+)\/todos\/(\d+)\/comments\/(\d+)/i, map: (m) => ({ bucket_id: m[1], todo_id: m[2], comment_id: m[3] }) },
    { type: "comment", re: /\/buckets\/(\d+)\/card_tables\/cards\/(\d+)\/comments\/(\d+)/i, map: (m) => ({ bucket_id: m[1], card_id: m[2], comment_id: m[3] }) },
    { type: "card", re: /\/buckets\/(\d+)\/card_tables\/cards\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "card_table", re: /\/buckets\/(\d+)\/card_tables\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "card_column", re: /\/buckets\/(\d+)\/card_tables\/columns\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "card_column", re: /\/buckets\/(\d+)\/card_tables\/lists\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "todo", re: /\/buckets\/(\d+)\/todos\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "todolist", re: /\/buckets\/(\d+)\/todolists\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "todolist_group", re: /\/buckets\/(\d+)\/todolist_groups\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "recording", re: /\/buckets\/(\d+)\/recordings\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "message", re: /\/buckets\/(\d+)\/message_boards\/(\d+)\/messages\/(\d+)/i, map: (m) => ({ bucket_id: m[1], message_board_id: m[2], id: m[3] }) },
    { type: "message", re: /\/buckets\/(\d+)\/messages\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "message_board", re: /\/buckets\/(\d+)\/message_boards\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "document", re: /\/buckets\/(\d+)\/vaults\/(\d+)\/documents\/(\d+)/i, map: (m) => ({ bucket_id: m[1], vault_id: m[2], id: m[3] }) },
    { type: "document", re: /\/buckets\/(\d+)\/documents\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "upload", re: /\/buckets\/(\d+)\/vaults\/(\d+)\/uploads\/(\d+)/i, map: (m) => ({ bucket_id: m[1], vault_id: m[2], id: m[3] }) },
    { type: "upload", re: /\/buckets\/(\d+)\/uploads\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "inbox_reply", re: /\/buckets\/(\d+)\/inbox_forwards\/(\d+)\/replies\/(\d+)/i, map: (m) => ({ bucket_id: m[1], forward_id: m[2], reply_id: m[3] }) },
    { type: "inbox_forward", re: /\/buckets\/(\d+)\/inbox_forwards\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "inbox", re: /\/buckets\/(\d+)\/inboxes\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "client_correspondence", re: /\/buckets\/(\d+)\/client\/correspondences\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "client_approval", re: /\/buckets\/(\d+)\/client\/approvals\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "question_answer", re: /\/buckets\/(\d+)\/questions\/(\d+)\/answers\/(\d+)/i, map: (m) => ({ bucket_id: m[1], question_id: m[2], id: m[3] }) },
    { type: "question", re: /\/buckets\/(\d+)\/questions\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "questionnaire", re: /\/buckets\/(\d+)\/questionnaires\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "webhook", re: /\/buckets\/(\d+)\/webhooks\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "lineup_marker", re: /\/lineup\/markers\/(\d+)/i, map: (m) => ({ id: m[1] }) },
    { type: "template_construction", re: /\/templates\/(\d+)\/constructions\/(\d+)/i, map: (m) => ({ template_id: m[1], id: m[2] }) },
    { type: "template", re: /\/templates\/(\d+)/i, map: (m) => ({ id: m[1] }) },
    { type: "schedule_entry", re: /\/buckets\/(\d+)\/schedule_entries\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "schedule", re: /\/buckets\/(\d+)\/schedules\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "campfire", re: /\/buckets\/(\d+)\/chats\/(\d+)/i, map: (m) => ({ bucket_id: m[1], id: m[2] }) },
    { type: "project", re: /\/projects\/(\d+)/i, map: (m) => ({ project_id: m[1], bucket_id: m[1], id: m[1] }) },
    { type: "project", re: /\/buckets\/(\d+)/i, map: (m) => ({ project_id: m[1], bucket_id: m[1], id: m[1] }) },
    { type: "person", re: /\/people\/(\d+)/i, map: (m) => ({ id: m[1] }) },
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern.re);
    if (match) {
      const payload = pattern.map(match);
      return {
        type: pattern.type,
        account_id: accountId ? Number(accountId) : null,
        bucket_id: payload.bucket_id ? Number(payload.bucket_id) : null,
        project_id: payload.project_id ? Number(payload.project_id) : (payload.bucket_id ? Number(payload.bucket_id) : null),
        id: payload.id ? Number(payload.id) : null,
        ...payload,
        url: cleaned
      };
    }
  }

  return null;
}

function parseRecordingUrl(input) {
  const parsed = parseBasecampUrl(input);
  if (!parsed) return null;
  if (parsed.type === "card" || parsed.type === "todo" || parsed.type === "recording") {
    return { type: parsed.type, bucketId: parsed.bucket_id, id: parsed.id };
  }
  return null;
}

function extractRecordingUrlFromText(text) {
  const raw = String(text ?? "");
  const m = raw.match(/https?:\/\/[^\s)]+basecamp\.com\/[^\s)]+/i);
  return m ? parseRecordingUrl(m[0]) : null;
}

async function postCardComment(ctx, projectId, cardId, text, opts = {}) {
  logCommentDebug("[postCardComment] start", {
    projectId,
    cardId,
    content_len: String(text || "").length
  });
  let card;
  try {
    card = await api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`);
  } catch (err) {
    // fallback to direct comments endpoint if card fetch fails
    logCommentDebug("[postCardComment] card fetch failed, fallback to card comments endpoint", {
      projectId,
      cardId,
      error: err?.message || String(err)
    });
    return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}/comments.json`, {
      method: "POST",
      body: withIdempotency({ content: text }, opts),
    });
  }
  const cardRecordingId = card?.recording?.id || card?.recording_id || null;
  const commentsUrl = card?.comments_url
    || (cardRecordingId ? `/buckets/${projectId}/recordings/${cardRecordingId}/comments.json` : null)
    || `/buckets/${projectId}/card_tables/cards/${cardId}/comments.json`;
  logCommentDebug("[postCardComment] resolved comments url", {
    projectId,
    cardId,
    cardRecordingId: cardRecordingId || null,
    commentsUrl
  });
  try {
    return api(ctx, commentsUrl, {
      method: "POST",
      body: withIdempotency({ content: text }, opts),
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (!msg.includes("404")) throw err;
    logCommentDebug("[postCardComment] comments url 404, trying recording/card fallbacks", {
      projectId,
      cardId,
      cardRecordingId: cardRecordingId || null
    });
    const recordingId = card?.recording?.id || card?.recording_id || card?.id;
    if (recordingId) {
      try {
        return api(ctx, `/buckets/${projectId}/recordings/${recordingId}/comments.json`, {
          method: "POST",
          body: withIdempotency({ content: text }, opts),
        });
      } catch (recErr) {
        const recMsg = String(recErr?.message || "");
        if (!recMsg.includes("404")) throw recErr;
        logCommentDebug("[postCardComment] recording comments 404, trying /comments without .json", {
          projectId,
          recordingId
        });
        // Some Basecamp web endpoints accept /comments without .json
        return api(ctx, `/buckets/${projectId}/recordings/${recordingId}/comments`, {
          method: "POST",
          body: { content: text },
        });
      }
    }
    try {
      logCommentDebug("[postCardComment] trying card comments without .json", {
        projectId,
        cardId
      });
      return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}/comments`, {
        method: "POST",
        body: { content: text },
      });
    } catch (cardHtmlErr) {
      throw err;
    }
  }
}

async function postCommentViaParent(ctx, projectId, commentId, text, opts = {}) {
  const commentBody = withIdempotency({ content: text }, opts);
  const comment = await api(ctx, `/buckets/${projectId}/comments/${commentId}.json`);
  const parent = comment?.parent || {};
  const commentsUrl = parent?.comments_url || parent?.comments_url_raw;
  if (commentsUrl) {
    return api(ctx, commentsUrl, { method: "POST", body: commentBody });
  }
  const parentId = parent?.id;
  const parentType = String(parent?.type || "").toLowerCase();
  if (parentId && parentType.includes("todo")) {
    return api(ctx, `/buckets/${projectId}/todos/${parentId}/comments.json`, {
      method: "POST",
      body: commentBody,
    });
  }
  if (parentId && (parentType.includes("card") || parentType.includes("kanban"))) {
    return postCardComment(ctx, projectId, parentId, text, opts);
  }
  if (parentId) {
    return api(ctx, `/buckets/${projectId}/recordings/${parentId}/comments.json`, {
      method: "POST",
      body: commentBody,
    });
  }
  throw new Error("COMMENT_PARENT_NOT_FOUND");
}

async function createComment(ctx, projectId, recordingId, content, opts = {}) {
  const text = String(content ?? "").trim();
  if (!text) throw new Error("Missing comment content.");
  const commentBody = withIdempotency({ content: text }, opts);
  logCommentDebug("[createComment] start", {
    projectId,
    recordingId,
    recordingQuery: opts?.recordingQuery || null,
    content_len: text.length
  });
  let c;
  let parsed = parseRecordingUrl(recordingId);
  if (!parsed) {
    parsed = extractRecordingUrlFromText(text);
  }
  if (parsed?.bucketId && parsed?.id) {
    logCommentDebug("[createComment] parsed URL", parsed);
    projectId = parsed.bucketId;
    recordingId = parsed.id;
    if (parsed.type === "card") {
      c = await postCardComment(ctx, projectId, recordingId, text, opts);
    } else if (parsed.type === "todo") {
      c = await api(ctx, `/buckets/${projectId}/todos/${recordingId}/comments.json`, {
        method: "POST",
        body: commentBody,
      });
    } else {
      c = await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/comments.json`, {
        method: "POST",
        body: commentBody,
      });
    }
    return {
      id: c.id,
      created_at: c.created_at,
      content: c.content,
      creator: c.creator?.name,
      creator_id: c.creator?.id,
      app_url: c.app_url,
    };
  }

  const numericId = /^\d+$/.test(String(recordingId ?? ""));
  if (numericId) {
    try {
      logCommentDebug("[createComment] numeric id -> postCommentViaParent", { projectId, recordingId });
      c = await postCommentViaParent(ctx, projectId, recordingId, text, opts);
      return {
        id: c.id,
        created_at: c.created_at,
        content: c.content,
        creator: c.creator?.name,
        creator_id: c.creator?.id,
        app_url: c.app_url,
      };
    } catch (_) {
      // fall through to other strategies
      logCommentDebug("[createComment] postCommentViaParent failed, falling through", { projectId, recordingId });
    }
  }
  const idStr = String(recordingId ?? "").trim();
  if (idStr && !/^\d+$/.test(idStr)) {
    const resolved = await resolveRecordingByQuery(ctx, idStr, projectId);
    if (resolved) {
      logCommentDebug("[createComment] resolved by query", {
        projectId,
        query: idStr,
        resolved_id: resolved?.id,
        resolved_type: resolved?.type || null
      });
      const bucketId = resolved.bucket_id || resolved.bucket?.id || projectId;
      const type = String(resolved.type || "").toLowerCase();
      const url = String(resolved.url || resolved.app_url || "");
      if (url.includes("/card_tables/cards/") || type.includes("kanban::card")) {
        c = await postCardComment(ctx, bucketId, resolved.id, text, opts);
      } else if (type.includes("todo")) {
        c = await api(ctx, `/buckets/${bucketId}/todos/${resolved.id}/comments.json`, {
          method: "POST",
          body: commentBody,
        });
      } else {
        c = await api(ctx, `/buckets/${bucketId}/recordings/${resolved.id}/comments.json`, {
          method: "POST",
          body: commentBody,
        });
      }
      return {
        id: c.id,
        created_at: c.created_at,
        content: c.content,
        creator: c.creator?.name,
        creator_id: c.creator?.id,
        app_url: c.app_url,
      };
    }
  }

  try {
    logCommentDebug("[createComment] trying recording comments", { projectId, recordingId });
    c = await api(ctx, `/buckets/${projectId}/recordings/${recordingId}/comments.json`, {
      method: "POST",
      body: commentBody,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (!msg.includes("404")) throw err;
    try {
      logCommentDebug("[createComment] recording comments 404, trying todo comments", { projectId, recordingId });
      c = await api(ctx, `/buckets/${projectId}/todos/${recordingId}/comments.json`, {
        method: "POST",
        body: commentBody,
      });
    } catch (todoErr) {
      const todoMsg = String(todoErr?.message || "");
      if (!todoMsg.includes("404")) throw todoErr;
      try {
        logCommentDebug("[createComment] todo comments 404, trying card comments", { projectId, recordingId });
        c = await postCardComment(ctx, projectId, recordingId, text, opts);
      } catch (cardErr) {
        const cardMsg = String(cardErr?.message || "");
        if (!cardMsg.includes("404")) throw cardErr;
        logCommentDebug("[createComment] card comments 404, attempting resolveRecordingForComment", {
          projectId,
          recordingId,
          recordingQuery: opts?.recordingQuery || null
        });
        let resolved = await resolveRecordingForComment(ctx, recordingId, projectId);
        if (!resolved && opts?.recordingQuery) {
          resolved = await resolveRecordingByQuery(ctx, opts.recordingQuery, projectId);
        }
        if (!resolved && /^\d+$/.test(String(recordingId ?? ""))) {
          const card = await findCardInProjectById(ctx, projectId, recordingId);
          if (card) {
            c = await postCardComment(ctx, projectId, card.id, text, opts);
            return {
              id: c.id,
              created_at: c.created_at,
              content: c.content,
              creator: c.creator?.name,
              creator_id: c.creator?.id,
              app_url: c.app_url,
            };
          }
        }
        if (!resolved) throw cardErr;
        const bucketId = resolved.bucket_id || resolved.bucket?.id || projectId;
        const type = String(resolved.type || "").toLowerCase();
        const url = String(resolved.url || resolved.app_url || "");
        if (url.includes("/card_tables/cards/") || type.includes("kanban::card")) {
          c = await postCardComment(ctx, bucketId, resolved.id, text, opts);
        } else if (type.includes("todo")) {
          c = await api(ctx, `/buckets/${bucketId}/todos/${resolved.id}/comments.json`, {
            method: "POST",
            body: commentBody,
          });
        } else {
          c = await api(ctx, `/buckets/${bucketId}/recordings/${resolved.id}/comments.json`, {
            method: "POST",
            body: commentBody,
          });
        }
      }
    }
  }
  return {
    id: c.id,
    created_at: c.created_at,
    content: c.content,
    creator: c.creator?.name,
    creator_id: c.creator?.id,
    app_url: c.app_url,
  };
}

async function updateComment(ctx, projectId, commentId, content, opts = {}) {
  const text = String(content ?? "").trim();
  if (!text) throw new Error("Missing comment content.");
  const c = await api(ctx, `/buckets/${projectId}/comments/${commentId}.json`, {
    method: "PUT",
    body: withIdempotency({ content: text }, opts)
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

  const uploads = await apiAllWithMeta(ctx, `/buckets/${projectId}/vaults/${useVaultId}/uploads.json`);
  const { items, meta } = unwrapItemsWithMeta(uploads);
  const arr = Array.isArray(items) ? items : [];
  if (meta) arr._meta = meta;

  // Index uploads in search database
  try {
    for (const u of arr) {
      indexSearchItem("upload", u.id, {
        title: u.title || u.filename || "",
        content: u.description || "",
        url: u.app_url || u.url,
        created_at: u.created_at,
        updated_at: u.updated_at,
        userKey: ctx.userKey,
      });
    }
  } catch (e) {
    console.error(`[listUploads] Error indexing uploads:`, e.message);
  }

  const mapped = arr.map((u) => ({
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
  if (arr._meta) mapped._meta = arr._meta;
  return mapped;
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
  return api(ctx, `/buckets/${projectId}/vaults/${vaultId}/uploads.json`, {
    method: "POST",
    body: withIdempotency(body, body)
  });
}

async function updateUpload(ctx, projectId, uploadId, body) {
  return api(ctx, `/buckets/${projectId}/uploads/${uploadId}.json`, {
    method: "PUT",
    body: withIdempotency(body, body)
  });
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

async function getVault(ctx, projectId, vaultId) {
  return api(ctx, `/buckets/${projectId}/vaults/${vaultId}.json`);
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

async function listInboxes(ctx, projectId) {
  const dock = await getDock(ctx, projectId);
  const inboxDock = dockFind(dock, ["inbox", "inboxes"]);
  if (inboxDock?.url) return apiAllWithMeta(ctx, inboxDock.url);
  return apiAllWithMeta(ctx, `/buckets/${projectId}/inboxes.json`);
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
  try {
    const card = await api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}.json`);
    return Array.isArray(card?.steps) ? card.steps : [];
  } catch (e) {
    if (isApiError(e, 404)) {
      try {
        await requireDockTool(ctx, projectId, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
      } catch (dockErr) {
        throw dockErr;
      }
      throw toolError("RESOURCE_NOT_FOUND", `Card ${cardId} not found in this project.`, {
        tool: "card_tables",
        projectId,
        hint: "Call list_card_table_cards to get valid card IDs.",
        status: 404,
      });
    }
    throw e;
  }
}

async function createCardStep(ctx, projectId, cardId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/cards/${cardId}/steps.json`, {
    method: "POST",
    body: withIdempotency(body, body)
  });
}

async function updateCardStep(ctx, projectId, stepId, body) {
  return api(ctx, `/buckets/${projectId}/card_tables/steps/${stepId}.json`, {
    method: "PUT",
    body: withIdempotency(body, body)
  });
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
async function searchRecordings(ctx, query, { bucket_id = null, type = null, creator_id = null, file_type = null, exclude_chat = null } = {}) {
  // Coerce query to string and validate - prevents TypeError when non-strings (e.g., numeric ids) are passed
  const rawQuery = (typeof query === "string" ? query : String(query || "")).trim();
  if (!rawQuery) throw new Error("Search query is required");

  // Build the search endpoint with proper query parameters
  let path = `/search.json?q=${encodeURIComponent(rawQuery)}`;

  // Add optional filters
  if (bucket_id) path += `&bucket_id=${encodeURIComponent(bucket_id)}`;
  if (type) path += `&type=${encodeURIComponent(type)}`;
  if (creator_id) path += `&creator_id=${encodeURIComponent(creator_id)}`;
  if (file_type) path += `&file_type=${encodeURIComponent(file_type)}`;
  if (exclude_chat != null) path += `&exclude_chat=${exclude_chat ? "true" : "false"}`;

  // Pagination: per_page and page will be added by apiAll/basecampFetchAll
  // Force pagination with per_page=100, page=1
  path += `&per_page=100&page=1`;

  console.log(`[searchRecordings] Searching with endpoint: ${path}`);

  // apiAll will automatically follow pagination and aggregate all pages
  const results = await apiAllWithMeta(ctx, path);
  const { items, meta } = unwrapItemsWithMeta(results);
  const arr = Array.isArray(items) ? items : [];

  console.log(`[searchRecordings] Found ${arr.length} results for query: "${rawQuery}"`);

  const mapped = arr.map((r) => ({
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
  if (meta) mapped._meta = meta;
  return mapped;
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
  return apiAllWithMeta(ctx, `/buckets/${projectId}/recordings/${recordingId}/events.json`);
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
  return apiAllWithMeta(ctx, path);
}

async function projectTimesheet(ctx, projectId, query) {
  const path = query ? `/projects/${projectId}/timesheet.json?${query}` : `/projects/${projectId}/timesheet.json`;
  return apiAllWithMeta(ctx, path);
}

async function recordingTimesheet(ctx, projectId, recordingId, query) {
  const path = query ? `/projects/${projectId}/recordings/${recordingId}/timesheet.json?${query}` : `/projects/${projectId}/recordings/${recordingId}/timesheet.json`;
  return apiAllWithMeta(ctx, path);
}

// ========== INBOXES / FORWARDS / REPLIES ==========
async function getInbox(ctx, projectId, inboxId) {
  return api(ctx, `/buckets/${projectId}/inboxes/${inboxId}.json`);
}

async function listInboxForwards(ctx, projectId, inboxId) {
  return apiAllWithMeta(ctx, `/buckets/${projectId}/inboxes/${inboxId}/forwards.json`);
}

async function getInboxForward(ctx, projectId, forwardId) {
  return api(ctx, `/buckets/${projectId}/inbox_forwards/${forwardId}.json`);
}

async function listInboxReplies(ctx, projectId, forwardId) {
  return apiAllWithMeta(ctx, `/buckets/${projectId}/inbox_forwards/${forwardId}/replies.json`);
}

async function getInboxReply(ctx, projectId, forwardId, replyId) {
  return api(ctx, `/buckets/${projectId}/inbox_forwards/${forwardId}/replies/${replyId}.json`);
}

// ========== QUESTIONNAIRES / QUESTIONS / ANSWERS ==========
async function getQuestionnaire(ctx, projectId, questionnaireId) {
  return api(ctx, `/buckets/${projectId}/questionnaires/${questionnaireId}.json`);
}

async function listQuestions(ctx, projectId, questionnaireId) {
  return apiAllWithMeta(ctx, `/buckets/${projectId}/questionnaires/${questionnaireId}/questions.json`);
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
  return apiAllWithMeta(ctx, `/buckets/${projectId}/questions/${questionId}/answers.json`);
}

async function listQuestionAnswersBy(ctx, projectId, questionId) {
  return apiAllWithMeta(ctx, `/buckets/${projectId}/questions/${questionId}/answers/by.json`);
}

async function listQuestionAnswersByPerson(ctx, projectId, questionId, personId) {
  return apiAllWithMeta(ctx, `/buckets/${projectId}/questions/${questionId}/answers/by/${personId}.json`);
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

async function listLineupMarkers(ctx) {
  return apiAllWithMeta(ctx, `/lineup/markers.json`);
}

// ========== TODO LIST GROUPS / TODOSETS ==========
async function listTodolistGroups(ctx, projectId, todolistId) {
  return apiAll(ctx, `/buckets/${projectId}/todolists/${todolistId}/groups.json`);
}

async function getTodolistGroup(ctx, projectId, groupId) {
  return api(ctx, `/buckets/${projectId}/todolists/${groupId}.json`);
}

async function createTodolistGroup(ctx, projectId, todolistId, body) {
  return api(ctx, `/buckets/${projectId}/todolists/${todolistId}/groups.json`, {
    method: "POST",
    body: withIdempotency(body, body)
  });
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

    // mcp_call: proxy to any MCP tool by name
    if (name === "mcp_call") {
      try {
        const toolName = String(firstDefined(args.tool, args.name, args.operation) || "").trim();
        if (!toolName) return fail(id, { code: "MISSING_TOOL", message: "Missing tool name." });
        if (toolName === "mcp_call") return fail(id, { code: "INVALID_TOOL", message: "Nested mcp_call is not allowed." });

        const toolList = getTools().map(t => t.name);
        if (!toolList.includes(toolName)) {
          return fail(id, { code: "UNKNOWN_TOOL", message: `Unknown tool: ${toolName}` });
        }

        const toolArgs = (args.args && typeof args.args === "object")
          ? args.args
          : (args.arguments && typeof args.arguments === "object" ? args.arguments : {});

        const nested = await handleMCP({
          jsonrpc: "2.0",
          id: `${id || "mcp"}:mcp_call`,
          method: "tools/call",
          params: { name: toolName, arguments: toolArgs }
        }, ctx);

        if (nested?.error) {
          return fail(id, {
            code: nested.error.code || "MCP_CALL_ERROR",
            message: nested.error.message || "Tool error",
            details: nested.error
          });
        }

        return ok(id, { tool: toolName, forwarded: true, result: nested?.result ?? nested });
      } catch (e) {
        return fail(id, { code: "MCP_CALL_ERROR", message: e.message });
      }
    }

    // Everything else requires auth
    if (!TOKEN?.access_token) {
      return fail(id, { code: "NOT_AUTHENTICATED", message: "Not connected. Run /startbcgpt to get the auth link." });
    }

    if (name === "list_accounts") return ok(id, buildListPayload("accounts", authAccounts || []));

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
      return ok(id, buildListPayload("projects", projects));
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
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const project = await createProject(ctx, body);
        return ok(id, { message: "Project created", project });
      } catch (e) {
        return fail(id, { code: "CREATE_PROJECT_ERROR", message: e.message });
      }
    }

    if (name === "update_project") {
      try {
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const project = await updateProject(ctx, Number(args.project_id), body);
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
          metrics: ctx_intel.getMetrics(),
          ...buildListPayload("groups", enrichedGroups)
        });
      } catch (e) {
        console.error(`[list_todos_for_project] Error:`, e.message);
        // Fallback to non-enriched list
        try {
          const p = await projectByName(ctx, args.project);
          const groups = await listTodosForProject(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("groups", groups) });
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
        const rows = await listAllOpenTodos(ctx);
        const result = await intelligent.executeDailyReport(ctx, date, rows);

        const payload = {
          date,
          totals: result.totals,
          metrics: result._metadata
        };
        attachCachedCollection(payload, "perProject", result.perProject);
        attachCachedCollection(payload, "dueToday", result.dueToday);
        attachCachedCollection(payload, "overdue", result.overdue);
        return ok(id, payload);
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

          const payload = {
            date,
            totals: {
              projects: new Set(rows.map((r) => r.projectId)).size,
              dueToday: dueToday.length,
              overdue: overdue.length
            },
            fallback: true
          };
          attachCachedCollection(payload, "perProject", perProjectArr);
          attachCachedCollection(payload, "dueToday", dueToday);
          attachCachedCollection(payload, "overdue", overdue);
          return ok(id, payload);
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
        const groups = await listTodosForProject(ctx, p.id);
        const result = await intelligent.executeTimeline(ctx, p.id, date, endDate, groups);

        // Format results with overdue indicator
        const formattedTodos = result.todos.map(group => ({
          ...group,
          todos: (group.todos || []).map(t => ({
            ...t,
            overdue: !!(t.due_on && t.due_on < date)
          }))
        }));

        const payload = {
          project: p.name,
          date_range: { start: date, end: endDate },
          count: result.count,
          metrics: result._metadata
        };
        attachCachedCollection(payload, "todos", formattedTodos);
        return ok(id, payload);
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

          const payload = { date, count: todos.length, fallback: true };
          attachCachedCollection(payload, "todos", todos);
          return ok(id, payload);
        } catch (fbErr) {
          return fail(id, { code: "LIST_TODOS_DUE_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "search_todos") {
      const q = String(args.query || "").trim();
      if (!q) {
        const payload = { query: "", count: 0 };
        attachCachedCollection(payload, "todos", [], { inlineLimit: Number(process.env.SEARCH_INLINE_LIMIT || 1000) });
        return ok(id, payload);
      }

      const cacheKey = `search:${ctx.accountId}:${q}`;
      const cached = cacheGet(cacheKey);
      if (cached) {
        const payload = { cached: true, ...cached };
        attachCachedCollection(payload, "todos", cached.todos || [], { inlineLimit: Number(process.env.SEARCH_INLINE_LIMIT || 1000) });
        return ok(id, payload);
      }

      try {
        // INTELLIGENT CHAINING: Search with automatic enrichment
        // Detects assignee_ids and automatically fetches person objects
        const result = await intelligent.executeIntelligentSearch(ctx, q);

        const response = cacheSet(cacheKey, {
          query: args.query,
          count: result.count,
          todos: result.items
        });

        // If intelligent layer returns empty or made no API calls, fall back to API search
        if (!result?.count || (result?._metadata && result._metadata.apiCallsMade === 0)) {
          try {
            const apiResults = await searchRecordings(ctx, q, { type: "todo" });
            let todos = apiResults.map((r) => ({
              id: r.id,
              title: r.title,
              content: r.title,
              type: "todo",
              bucket: r.bucket,
              app_url: r.app_url
            }));
            if (!todos.length) {
              const rows = await listAllOpenTodos(ctx);
              const needle = q.toLowerCase();
              todos = rows
                .filter(r => {
                  const text = todoText(r.raw || {}).toLowerCase();
                  const desc = String(r.raw?.description || "").toLowerCase();
                  return text.includes(needle) || desc.includes(needle);
                })
                .map(r => ({
                  id: r.todoId,
                  title: r.content,
                  content: r.raw?.description || "",
                  type: "todo",
                  bucket: { id: r.projectId, name: r.project },
                  app_url: r.url || null,
                  source: "scan"
                }));
            }
            const cachedApi = cacheSet(cacheKey, { query: args.query, count: todos.length, todos });
            const payload = { ...cachedApi, source: "fallback_search" };
            attachCachedCollection(payload, "todos", todos, { inlineLimit: Number(process.env.SEARCH_INLINE_LIMIT || 1000) });
            return ok(id, payload);
          } catch (fallbackErr) {
            // Final fallback: local DB index
            try {
              const hits = searchIndex(q, { type: "todo", userKey: ctx.userKey });
              const todos = (hits || []).map((h) => ({
                id: h.object_id,
                title: h.title,
                content: h.content,
                type: "todo",
                bucket: { id: h.project_id },
                app_url: h.url,
                source: "db"
              }));
              const cachedDb = cacheSet(cacheKey, { query: args.query, count: todos.length, todos });
              const payload = { ...cachedDb, source: "db_fallback", error: fallbackErr.message };
              attachCachedCollection(payload, "todos", todos, { inlineLimit: Number(process.env.SEARCH_INLINE_LIMIT || 1000) });
              return ok(id, payload);
            } catch (dbErr) {
              console.error(`[search_todos] Fallback also failed:`, dbErr.message);
              return ok(id, { query: args.query, count: 0, todos: [], error: dbErr.message });
            }
          }
        }

        const payload = { ...response, source: "intelligent_api", metrics: result._metadata };
        attachCachedCollection(payload, "todos", response.todos || [], { inlineLimit: Number(process.env.SEARCH_INLINE_LIMIT || 1000) });
        return ok(id, payload);
      } catch (e) {
        console.error(`[search_todos] Intelligent search failed:`, e.message);
        
        // Fallback: Traditional search without enrichment
        try {
          const results = await searchRecordings(ctx, q, { type: "todo" });
          const todos = results.map((r) => ({
            id: r.id,
            title: r.title,
            content: r.title,
            type: "todo",
            bucket: r.bucket,
            app_url: r.app_url
          }));
          const response = cacheSet(cacheKey, { query: args.query, count: todos.length, todos });
          const payload = { ...response, source: "fallback_search" };
          attachCachedCollection(payload, "todos", todos, { inlineLimit: Number(process.env.SEARCH_INLINE_LIMIT || 1000) });
          return ok(id, payload);
        } catch (fallbackErr) {
          console.error(`[search_todos] Fallback also failed:`, fallbackErr.message);
          const payload = { query: args.query, count: 0, todos: [], error: fallbackErr.message };
          attachCachedCollection(payload, "todos", [], { inlineLimit: Number(process.env.SEARCH_INLINE_LIMIT || 1000) });
          return ok(id, payload);
        }
      }
    }

    if (name === "assignment_report") {
      try {
        const maxTodos = args.max_todos == null ? 0 : Number(args.max_todos);
        const p = await projectByName(ctx, args.project);
        const groups = capTodoGroups(await listTodosForProject(ctx, p.id), maxTodos);
        
        // INTELLIGENT CHAINING: Use specialized executor for assignment pattern
        // Automatically groups by assignee, enriches with person details, aggregates stats
        const result = await intelligent.executeAssignmentReport(ctx, p.id, maxTodos, groups);

        const payload = {
          project: p.name,
          project_id: p.id,
          summary: {
            total_todos: result.total_todos,
            total_people: result.by_person.length,
            metrics: result._metadata
          }
        };
        attachCachedCollection(payload, "by_person", result.by_person);
        return ok(id, payload);
      } catch (e) {
        console.error(`[assignment_report] Error:`, e.message);
        // Fallback to original implementation
        try {
          const result = await assignmentReport(ctx, args.project, { maxTodos: args.max_todos });
          const payload = { ...result, fallback: true };
          attachCachedCollection(payload, "by_assignee", result.by_assignee || []);
          return ok(id, payload);
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
          metrics: ctx_intel.getMetrics(),
          ...buildListPayload("todos", enriched)
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
            fallback: true,
            metrics: ctx_intel.getMetrics(),
            ...buildListPayload("todos", enriched)
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
          metrics: ctx_intel.getMetrics(),
          ...buildListPayload("todos", enriched)
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
            fallback: true,
            metrics: ctx_intel.getMetrics(),
            ...buildListPayload("todos", enriched)
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

        const body = withIdempotency({ content: taskText }, args);
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
          starts_on: args.starts_on,
          idempotency_key: args.idempotency_key
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

    if (name === "get_todo") {
      try {
        const p = await projectByName(ctx, args.project);
        const todo = await getTodo(ctx, p.id, Number(args.todo_id));
        return ok(id, { project: { id: p.id, name: p.name }, todo });
      } catch (e) {
        return fail(id, { code: "GET_TODO_ERROR", message: e.message });
      }
    }

    if (name === "list_todos_for_list") {
      try {
        const p = await projectByName(ctx, args.project);
        const todos = await listTodosForListById(ctx, p.id, Number(args.todolist_id));
        return ok(id, { project: { id: p.id, name: p.name }, todolist_id: Number(args.todolist_id), ...buildListPayload("todos", todos) });
      } catch (e) {
        return fail(id, { code: "LIST_TODOS_FOR_LIST_ERROR", message: e.message });
      }
    }

    if (name === "complete_todo") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await completeTodo(ctx, p.id, Number(args.todo_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "COMPLETE_TODO_ERROR", message: e.message });
      }
    }

    if (name === "uncomplete_todo") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await uncompleteTodo(ctx, p.id, Number(args.todo_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "UNCOMPLETE_TODO_ERROR", message: e.message });
      }
    }

    if (name === "reposition_todo") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await repositionTodo(ctx, p.id, Number(args.todo_id), Number(args.position));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        return fail(id, { code: "REPOSITION_TODO_ERROR", message: e.message });
      }
    }

    if (name === "smart_action") {
      const query = normalizeQuery(args.query);
      if (!query) return fail(id, { code: "BAD_REQUEST", message: "Missing query." });

      const callTool = async (toolName, toolArgs) => {
        const res = await handleMCP({ jsonrpc: "2.0", id, method: "tools/call", params: { name: toolName, arguments: toolArgs } }, ctx);
        const payload = res?.result ?? res;
        if (res?.error || payload?.error) {
          const err = payload?.error || res?.error;
          throw toolError(err?.code || "TOOL_ERROR", err?.message || "Tool error", { tool: toolName, data: err });
        }
        return payload;
      };

      const computeConfidence = ({ analysis, hasProject, hasResources, hasConstraints, keywordBoost }) => {
        let score = 0.2;
        if (analysis?.pattern && analysis.pattern !== "generic") score += 0.25;
        if (hasProject) score += 0.3;
        if (hasResources) score += 0.1;
        if (hasConstraints) score += 0.1;
        if (keywordBoost) score += 0.1;
        return Math.min(1, Math.max(0, score));
      };

      const extractProjectHints = (raw) => {
        const hints = [];
        const quoted = String(raw || "").match(/\"([^\"]+)\"/g) || [];
        for (const q of quoted) {
          const t = q.replace(/^\"|\"$/g, "").trim();
          if (t) hints.push(t);
        }
        const projMatch = String(raw || "").match(/project\\s+([^,.;]+)/i);
        if (projMatch?.[1]) hints.push(projMatch[1].trim());
        return hints;
      };

      const resolveProjectBestEffort = (rawQuery, projects = []) => {
        if (!projects.length) return { project: null, candidates: [] };
        const lower = String(rawQuery || "").toLowerCase();
        const direct = projects.filter(p => p?.name && lower.includes(String(p.name).toLowerCase()));
        if (direct.length === 1) return { project: direct[0], candidates: direct };
        if (direct.length > 1) {
          const ranked = [...direct].sort((a, b) => (String(b.name || "").length - String(a.name || "").length));
          return { project: ranked[0], candidates: ranked, ambiguous: true };
        }
        const hints = extractProjectHints(rawQuery);
        for (const hint of hints) {
          const picked = resolveBestEffort(projects, hint);
          if (picked) return { project: picked, candidates: [picked] };
        }
        const fallback = resolveBestEffort(projects, rawQuery);
        if (fallback) return { project: fallback, candidates: [fallback], ambiguous: true };
        return { project: null, candidates: [] };
      };

      const extractSearchQuery = (raw) => {
        const stop = [
          "find", "show", "search", "lookup", "first", "latest", "recent", "containing", "with", "about",
          "comment", "comments", "message", "messages", "todo", "todos", "task", "tasks",
          "document", "documents", "file", "files", "schedule", "event", "events", "card", "cards"
        ];
        const tokens = String(raw || "")
          .toLowerCase()
          .replace(/[^a-z0-9\\s]/g, " ")
          .split(/\\s+/)
          .filter(Boolean)
          .filter(t => !stop.includes(t));
        return tokens.join(" ").trim();
      };

      const extractPersonId = (raw) => {
        const match = String(raw || "").match(/\b(?:user|person)?\s*id[:#]?\s*(\d{4,})\b/i);
        return match?.[1] ? Number(match[1]) : null;
      };

      const pickPersonCandidate = (analysis, raw) => {
        if (analysis?.personNames?.length) {
          const sorted = [...analysis.personNames].sort((a, b) => b.length - a.length);
          return sorted[0];
        }
        const id = extractPersonId(raw);
        return id != null ? String(id) : null;
      };

      const wantsMembership = (raw) => {
        const s = String(raw || "").toLowerCase();
        return /project/.test(s) && /(member|membership|belongs|access|on|in)/.test(s);
      };

      const wantsAssignments = (raw) => {
        const s = String(raw || "").toLowerCase();
        return /(assigned|todos|tasks)/.test(s);
      };

      const wantsActivity = (raw) => {
        const s = String(raw || "").toLowerCase();
        return /(activity|recent|comment|comments|timeline)/.test(s);
      };

      const searchLocalIndex = (q, { projectId = null, type = null, limit = 50 } = {}) => {
        if (!q) return [];
        const hits = searchIndex(q, { type, projectId, limit, userKey: ctx.userKey });
        return (hits || []).map((h) => ({
          id: h.object_id,
          type: h.type,
          title: h.title,
          content: h.content,
          url: h.url,
          project_id: h.project_id,
          updated_at: h.updated_at,
          source: "db"
        }));
      };

      try {
        const analysis = intelligent.analyzeQuery(query);
        const lower = query.toLowerCase();
        const searchQuery = extractSearchQuery(query) || query;
        const wantsComments = /comment(s)?/.test(lower);
        const keywordBoost = /(summarize|summary|dump|list all|everything|full|all cards|all todos|all messages)/i.test(query);
        const wantsSummary = /(summarize|summary|overview|status report|project report)/i.test(query);
        const ctx_intel = new RequestContext(ctx, `smart_action: ${query}`);
        await ctx_intel.preloadEssentials({ loadPeople: true, loadProjects: true });

        let project = null;
        let dock = null;
        let projectResolution = { project: null, candidates: [] };
        if (args.project) {
          project = await projectByName(ctx, args.project);
          dock = await getDock(ctx, project.id);
          projectResolution = { project, candidates: [project], ambiguous: false, source: "arg" };
        } else {
          const projects = Object.values(ctx_intel.cache.projects || {});
          projectResolution = resolveProjectBestEffort(query, projects);
          if (projectResolution?.project) {
            project = projectResolution.project;
            dock = await getDock(ctx, project.id);
          }
        }

        const confidence = computeConfidence({
          analysis,
          hasProject: !!project,
          hasResources: (analysis?.resources || []).length > 0,
          hasConstraints: Boolean(analysis?.constraints?.dueDate || analysis?.constraints?.dateRange || analysis?.constraints?.status),
          keywordBoost
        });

        // Quick intent rules
        if (lower.includes("daily report")) {
          const date = analysis.constraints.dueDate || new Date().toISOString().slice(0, 10);
          const result = await intelligent.executeDailyReport(ctx, date);
          return ok(id, { query, action: "daily_report", confidence, result });
        }

        if (wantsSummary && project) {
          const [cardTables, todoGroups] = await Promise.all([
            listProjectCardTableContents(ctx, project.id, {
              includeDetails: false,
              includeCards: false,
              maxCardsPerColumn: 0,
              cursor: 0,
              maxBoards: 2,
              autoAll: true,
              cacheOutput: true,
              cacheChunkBoards: 1
            }),
            listTodosForProject(ctx, project.id)
          ]);
          const todoSummary = summarizeTodoGroups(todoGroups);
          return ok(id, {
            query,
            action: "project_summary",
            confidence,
            project: { id: project.id, name: project.name },
            summary: {
              card_tables: cardTables.summary || null,
              todos: todoSummary
            },
            coverage: {
              card_tables: cardTables.coverage || null,
              todos: todoSummary
            },
            payload_key: cardTables.payload_key || null,
            chunk_count: cardTables.chunk_count || null,
            export: cardTables.export || null,
            note: cardTables.payload_key ? "Full data cached; export available." : undefined
          });
        }

        if (lower.includes("assigned to me") || lower.includes("my todos")) {
          const result = await callTool("list_assigned_to_me", { project: args.project });
          return ok(id, { query, action: "list_assigned_to_me", confidence, result });
        }

        if (analysis.personNames.length || extractPersonId(query)) {
          const person = pickPersonCandidate(analysis, query);
          const personId = extractPersonId(query);

          if (wantsSummary && person) {
            const result = await callTool("audit_person", {
              person,
              include_archived_projects: false,
              include_assignments: true,
              include_activity: true,
              activity_limit: 50
            });
            return ok(id, { query, action: "audit_person", confidence, result });
          }

          if ((wantsMembership(query) || wantsAssignments(query) || wantsActivity(query)) && person) {
            let projectsResult = null;
            let assignmentsResult = null;
            let activityResult = null;

            if (wantsMembership(query)) {
              projectsResult = await callTool("list_person_projects", {
                person,
                include_archived_projects: false
              });
            }

            const resolvedPersonId =
              personId ||
              projectsResult?.person?.id ||
              projectsResult?.result?.person?.id ||
              null;

            if (wantsAssignments(query) && resolvedPersonId) {
              assignmentsResult = await callTool("report_todos_assigned_person", {
                person_id: Number(resolvedPersonId)
              });
            }

            if (wantsActivity(query)) {
              activityResult = await callTool("list_person_activity", {
                person,
                project: args.project || null
              });
            }

            return ok(id, {
              query,
              action: "person_audit",
              confidence,
              result: {
                projects: projectsResult,
                assignments: assignmentsResult,
                activity: activityResult
              }
            });
          }

          if (/activity|recent|timeline/.test(lower) && person) {
            const result = await callTool("list_person_activity", {
              person,
              project: args.project || null
            });
            return ok(id, { query, action: "list_person_activity", confidence, result });
          }
          if (/project/.test(lower) && /(on|member|access|projects?)/.test(lower) && person) {
            const result = await callTool("list_person_projects", {
              person,
              include_archived_projects: false
            });
            return ok(id, { query, action: "list_person_projects", confidence, result });
          }
        }

        if (analysis.pattern === "person_finder" && (analysis.personNames.length || extractPersonId(query))) {
          const person = pickPersonCandidate(analysis, query);
          if (args.project) {
            const result = await callTool("get_person_assignments", { project: args.project, person });
            return ok(id, { query, action: "get_person_assignments", confidence, result });
          }
          const result = await callTool("search_people", { query: person });
          return ok(id, { query, action: "search_people", confidence, result });
        }

        if (/project/.test(lower) && /(find|search|lookup)/.test(lower)) {
          const result = await callTool("search_projects", { query: searchQuery || query, include_archived_projects: false });
          return ok(id, { query, action: "search_projects", confidence, result });
        }

        if (/card|kanban/.test(lower) && /(find|search|lookup|show)/.test(lower)) {
          const result = await callTool("search_cards", {
            query: searchQuery || query,
            project: args.project || null
          });
          return ok(id, { query, action: "search_cards", confidence, result });
        }

        if (analysis.constraints.dueDate) {
          if (args.project) {
            const result = await callTool("list_todos_due", { date: analysis.constraints.dueDate, include_overdue: lower.includes("overdue"), project: args.project });
            return ok(id, { query, action: "list_todos_due", confidence, result });
          }
          const rows = await listAllOpenTodos(ctx);
          const todos = rows.filter(r => r.due_on === analysis.constraints.dueDate).map(r => r.raw).filter(Boolean);
          return ok(id, { query, action: "list_todos_due_fallback", confidence, date: analysis.constraints.dueDate, todos, count: todos.length });
        }

        if (analysis.pattern === "assignment" && args.project) {
          const result = await callTool("assignment_report", { project: args.project });
          return ok(id, { query, action: "assignment_report", confidence, result });
        }

        if (confidence < 0.45 && !project) {
          const result = await callTool("search_recordings", { query: searchQuery, type: wantsComments ? "comment" : undefined });
          return ok(id, {
            query,
            action: "search_recordings_low_confidence",
            confidence,
            ambiguous: true,
            candidates: (projectResolution.candidates || []).map(p => ({ id: p.id, name: p.name })),
            result,
            note: "Ambiguous request; performed global search fallback."
          });
        }

        if (args.project && (lower.includes("kanban") || lower.includes("card table") || lower.includes("card tables") || lower.includes("cards"))) {
          const wantsCards = /contents|all cards|everything|list all|full|titles/.test(lower);
          const maxCardsPerColumn = wantsCards ? 0 : 0;
          const maxBoardsTotal = wantsCards ? 0 : 0;
          const maxTotal = maxBoardsTotal > 0 ? maxBoardsTotal : Number.POSITIVE_INFINITY;

          const project = await projectByName(ctx, args.project);
          const tables = [];
          let cursor = 0;
          let next = 0;

          while (next != null && tables.length < maxTotal) {
            const step = await listProjectCardTableContents(ctx, project.id, {
              includeDetails: wantsCards,
              includeCards: true,
              maxCardsPerColumn,
              cursor: next,
              maxBoards: 2,
              autoAll: true,
              maxBoardsTotal,
              cacheOutput: wantsCards,
              cacheChunkBoards: 1
            });
            if (step?.payload_key) {
              const exported = exportLargePayloadToFile(step.payload_key);
              return ok(id, {
                query,
                action: "list_project_card_table_contents",
                confidence,
                result: {
                  project: { id: project.id, name: project.name },
                  payload_key: step.payload_key,
                  chunk_count: step.chunk_count,
                  total_cards: step.total_cards,
                  count: step.total,
                  summary: step.summary,
                  coverage: step.coverage,
                  export: exported || null,
                  first_chunk: step.first_chunk || []
                },
                note: "Full details cached; export available."
              });
            }
            if (Array.isArray(step?.boards)) tables.push(...step.boards);
            cursor = step.cursor ?? cursor;
            next = step.next_cursor ?? null;
          }

          return ok(id, {
            query,
            action: "list_project_card_table_contents",
            confidence,
            result: {
              project: { id: project.id, name: project.name },
              card_tables: tables,
              count: tables.length,
              next_cursor: next ?? null
            }
          });
        }

        const searchTodosInProject = async (projectId) => {
          const groups = await listTodosForProject(ctx, projectId);
          const needle = searchQuery.toLowerCase();
          const todos = [];
          for (const g of groups || []) {
            for (const t of g.todos || []) {
              const text = todoText(t).toLowerCase();
              const desc = String(t.description || "").toLowerCase();
              if (text.includes(needle) || desc.includes(needle)) {
                todos.push({
                  id: t.id,
                  title: todoText(t),
                  content: t.description || "",
                  type: "todo",
                  todolist: g.todolist,
                  todolist_id: g.todolistId,
                  bucket: t.bucket || { id: projectId },
                  app_url: t.app_url || t.url || null
                });
              }
            }
          }
          return todos;
        };

        if (analysis.pattern === "search_enrich" || lower.includes("search") || lower.includes("find")) {
          if (project) {
            const result = await callTool("search_recordings", { query: searchQuery, bucket: project.id, type: wantsComments ? "comment" : undefined });
            if ((result?.results || []).length === 0) {
              if (!wantsComments) {
                const todos = await searchTodosInProject(project.id);
                if (todos.length) {
                  return ok(id, { query, action: "search_todos_fallback", confidence, project: { id: project.id, name: project.name }, todos, count: todos.length, dock });
                }
              }
              const local = searchLocalIndex(searchQuery, { projectId: project.id });
              if (local.length) {
                return ok(id, { query, action: "search_index_fallback", confidence, project: { id: project.id, name: project.name }, results: local, count: local.length, dock });
              }
            }
            return ok(id, { query, action: "search_recordings", confidence, result, project: { id: project.id, name: project.name }, dock });
          }
          const result = await callTool("search_recordings", { query: searchQuery, type: wantsComments ? "comment" : undefined });
          if ((result?.results || []).length === 0) {
            const local = searchLocalIndex(searchQuery);
            if (local.length) {
              return ok(id, { query, action: "search_index_fallback", confidence, results: local, count: local.length });
            }
            const entities = await callTool("search_entities", { query: searchQuery, limit: 10 });
            const hasEntities =
              (entities?.results?.people || []).length ||
              (entities?.results?.projects || []).length ||
              (entities?.results?.recordings || []).length ||
              (entities?.results?.todos || []).length ||
              (entities?.results?.cards || []).length;
            if (hasEntities) {
              return ok(id, { query, action: "search_entities", confidence, result: entities });
            }
          }
          return ok(id, { query, action: "search_recordings", confidence, result });
        }

        // Default: global search
        const result = await callTool("search_recordings", { query: searchQuery, type: wantsComments ? "comment" : undefined });
        if ((result?.results || []).length === 0) {
          const local = searchLocalIndex(searchQuery);
          if (local.length) {
            return ok(id, { query, action: "search_index_fallback", confidence, results: local, count: local.length });
          }
        }
        return ok(id, { query, action: "search_recordings", confidence, result });
      } catch (e) {
        console.error(`[smart_action] Error:`, e.message);
        try {
          const safeQuery = extractSearchQuery(query) || query;
          const result = await callTool("search_recordings", { query: safeQuery });
          return ok(id, { query, action: "search_recordings", result, fallback: true });
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
        const sources = [];
        const includeColumns = !!args.include_columns;
        const tables = await listCardTables(ctx, p.id, {
          includeArchived: !!args.include_archived,
          onSource: (s) => sources.push(s)
        });

        const normalizedTables = (tables || []).map((t) => {
          if (!t || typeof t !== "object") return t;
          const base = { ...t };
          const lists = Array.isArray(t.lists) ? t.lists : [];
          if (includeColumns) {
            base.lists = lists.map((c) => ({
              id: c.id,
              title: c.title,
              status: c.status,
              type: c.type,
              position: c.position,
              cards_count: c.cards_count,
              comment_count: c.comment_count,
              url: c.url,
              app_url: c.app_url,
              parent: c.parent
                ? {
                    id: c.parent.id,
                    title: c.parent.title,
                    type: c.parent.type,
                    url: c.parent.url,
                    app_url: c.parent.app_url
                  }
                : undefined
            }));
          } else {
            delete base.lists;
          }
          return base;
        });

        // INTELLIGENT CHAINING: Enrich card tables with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `card tables for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);
        const enrichedTables = await Promise.all(
          (normalizedTables || []).map(t => enricher.enrich({ ...t, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        const coverage = {
          total_boards: Array.isArray(enrichedTables) ? enrichedTables.length : 0,
          include_columns: !!includeColumns,
          sources: sources.map(s => s.source)
        };
        return ok(id, {
          project: { id: p.id, name: p.name },
          metrics: ctx_intel.getMetrics(),
          sources: args.debug ? sources : undefined,
          ...buildListPayload("card_tables", enrichedTables, { coverage })
        });
      } catch (e) {
        console.error(`[list_card_tables] Error:`, e.message);
        // Tool disabled / unavailable -> return empty with notice
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "card_tables",
            project: p,
            empty: { card_tables: [], count: 0 }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        // Fallback to non-enriched card tables
        try {
          const p = await projectByName(ctx, args.project);
          const includeColumns = !!args.include_columns;
          const tables = await listCardTables(ctx, p.id);
          const normalizedTables = (tables || []).map((t) => {
            if (!t || typeof t !== "object") return t;
            const base = { ...t };
            const lists = Array.isArray(t.lists) ? t.lists : [];
            if (includeColumns) {
              base.lists = lists.map((c) => ({
                id: c.id,
                title: c.title,
                status: c.status,
                type: c.type,
                position: c.position,
                cards_count: c.cards_count,
                comment_count: c.comment_count,
                url: c.url,
                app_url: c.app_url,
                parent: c.parent
                  ? {
                      id: c.parent.id,
                      title: c.parent.title,
                      type: c.parent.type,
                      url: c.parent.url,
                      app_url: c.parent.app_url
                    }
                  : undefined
              }));
            } else {
              delete base.lists;
            }
            return base;
          });
          const coverage = {
            total_boards: Array.isArray(normalizedTables) ? normalizedTables.length : 0,
            include_columns: !!includeColumns
          };
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("card_tables", normalizedTables, { coverage }) });
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

        const coverage = { columns_total: Array.isArray(enrichedCols) ? enrichedCols.length : 0 };
        return ok(id, { project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics(), ...buildListPayload("columns", enrichedCols, { coverage }) });
      } catch (e) {
        console.error(`[list_card_table_columns] Error:`, e.message);
        // Tool disabled / table not found -> return empty with notice
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "card_tables",
            project: p,
            empty: { columns: [], count: 0 }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        // Fallback to non-enriched columns
        try {
          const p = await projectByName(ctx, args.project);
          const cols = await listCardTableColumns(ctx, p.id, Number(args.card_table_id));
          const coverage = { columns_total: Array.isArray(cols) ? cols.length : 0 };
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("columns", cols, { coverage }) });
        } catch (fbErr) {
          return fail(id, { code: "LIST_CARD_TABLE_COLUMNS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_card_table_cards") {
      try {
        const p = await projectByName(ctx, args.project);
        const tableId = args.card_table_id ? Number(args.card_table_id) : null;
        const maxCardsPerColumn = args.max_cards_per_column == null ? 0 : Number(args.max_cards_per_column);
        const includeDetails = !!args.include_details;

        if (!tableId) {
          const result = await listProjectCardTableContents(ctx, p.id, {
            includeDetails,
            includeCards: true,
            maxCardsPerColumn,
            cursor: args.cursor,
            maxBoards: Number(args.max_boards || 2),
            autoAll: true,
            cacheOutput: true,
            cacheChunkBoards: 1
          });
          return ok(id, {
            project: { id: p.id, name: p.name },
            payload_key: result.payload_key,
            chunk_count: result.chunk_count,
            export: result.export,
            summary: result.summary,
            coverage: result.coverage,
            total_cards: result.total_cards,
            count: result.total,
            next_cursor: result.next_cursor ?? null,
            truncated: !!result.truncated,
            first_chunk: result.first_chunk || []
          });
        }

        const result = await listCardTableCards(ctx, p.id, tableId, {
          maxCardsPerColumn,
          includeDetails
        });

        // INTELLIGENT CHAINING: Enrich cards with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `card table ${tableId || "dock"}`);
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedCards = await Promise.all(
          (result.cards || []).map(c => enricher.enrich({ ...c, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );
        const cardsTotal = (result.columns || []).reduce((sum, col) => sum + (Number(col.cards_count) || 0), 0);
        const coverage = {
          columns_total: Array.isArray(result.columns) ? result.columns.length : 0,
          cards_total: cardsTotal,
          cards_returned: enrichedCards.length,
          include_details: !!includeDetails,
          max_cards_per_column: maxCardsPerColumn || 0,
          truncated: !!result.truncated
        };

        return ok(id, {
          project: { id: p.id, name: p.name },
          card_table_id: tableId,
          columns: result.columns || [],
          truncated: !!result.truncated,
          coverage,
          metrics: ctx_intel.getMetrics(),
          ...buildListPayload("cards", enrichedCards, { forceCache: includeDetails })
        });
      } catch (e) {
        console.error(`[list_card_table_cards] Error:`, e.message);
        // Tool disabled / table not found -> return empty with notice
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "card_tables",
            project: p,
            empty: { cards: [], count: 0 }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        // Fallback to non-enriched cards
        try {
          const p = await projectByName(ctx, args.project);
          const tableId = args.card_table_id ? Number(args.card_table_id) : null;
          const maxCardsPerColumn = args.max_cards_per_column == null ? 0 : Number(args.max_cards_per_column);
          const includeDetails = !!args.include_details;
          if (!tableId) {
            const result = await listProjectCardTableContents(ctx, p.id, {
              includeDetails,
              includeCards: true,
              maxCardsPerColumn,
              cursor: args.cursor,
              maxBoards: Number(args.max_boards || 2),
              autoAll: true,
              cacheOutput: true,
              cacheChunkBoards: 1
            });
            return ok(id, {
              project: { id: p.id, name: p.name },
              payload_key: result.payload_key,
              chunk_count: result.chunk_count,
              export: result.export,
              summary: result.summary,
              coverage: result.coverage,
              total_cards: result.total_cards,
              count: result.total,
              next_cursor: result.next_cursor ?? null,
              truncated: !!result.truncated,
              first_chunk: result.first_chunk || [],
              fallback: true
            });
          }
          const result = await listCardTableCards(ctx, p.id, tableId, {
            maxCardsPerColumn,
            includeDetails
          });
          const cardsTotal = (result.columns || []).reduce((sum, col) => sum + (Number(col.cards_count) || 0), 0);
          const coverage = {
            columns_total: Array.isArray(result.columns) ? result.columns.length : 0,
            cards_total: cardsTotal,
            cards_returned: (result.cards || []).length,
            include_details: !!includeDetails,
            max_cards_per_column: maxCardsPerColumn || 0,
            truncated: !!result.truncated
          };
          return ok(id, {
            project: { id: p.id, name: p.name },
            columns: result.columns || [],
            truncated: !!result.truncated,
            coverage,
            fallback: true,
            ...buildListPayload("cards", result.cards || [], { forceCache: includeDetails })
          });
        } catch (fbErr) {
          return fail(id, { code: "LIST_CARD_TABLE_CARDS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_card_table_summaries") {
      try {
        const p = await projectByName(ctx, args.project);
        const summaries = await listCardTableSummaries(ctx, p.id, {
          includeCards: !!args.include_cards,
          maxCardsPerColumn: args.max_cards_per_column == null ? 0 : Number(args.max_cards_per_column),
          includeArchived: !!args.include_archived
        });
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("card_tables", summaries) });
      } catch (e) {
        console.error(`[list_card_table_summaries] Error:`, e.message);
        return fail(id, { code: "LIST_CARD_TABLE_SUMMARIES_ERROR", message: e.message });
      }
    }

    if (name === "list_card_table_summaries_iter") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await listCardTableSummariesIter(ctx, p.id, {
          includeCards: !!args.include_cards,
          maxCardsPerColumn: args.max_cards_per_column == null ? 0 : Number(args.max_cards_per_column),
          includeArchived: !!args.include_archived,
          cursor: args.cursor
        });
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        console.error(`[list_card_table_summaries_iter] Error:`, e.message);
        return fail(id, { code: "LIST_CARD_TABLE_SUMMARIES_ITER_ERROR", message: e.message });
      }
    }

    if (name === "list_project_card_table_contents") {
      try {
        const p = await projectByName(ctx, args.project);
        const autoAll = args.auto_all == null ? true : !!args.auto_all;
        const includeDetails = !!args.include_details;
        const includeCards = args.include_cards == null ? true : !!args.include_cards;
        const fullDump = !!args.full_dump;
        const cacheOutput = args.cache_output == null ? (autoAll || includeDetails || fullDump) : !!args.cache_output;
        const result = await listProjectCardTableContents(ctx, p.id, {
          includeDetails: includeDetails || fullDump,
          includeCards: includeCards || fullDump,
          maxCardsPerColumn: args.max_cards_per_column == null ? 0 : Number(args.max_cards_per_column),
          cursor: args.cursor,
          maxBoards: Number(args.max_boards || 2),
          autoAll: fullDump ? true : autoAll,
          maxBoardsTotal: args.max_boards_total == null ? 0 : Number(args.max_boards_total),
          cacheOutput,
          cacheChunkBoards: Number(args.cache_chunk_boards || 1)
        });
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        console.error(`[list_project_card_table_contents] Error:`, e.message);
        return fail(id, { code: "LIST_PROJECT_CARD_TABLE_CONTENTS_ERROR", message: e.message });
      }
    }

    if (name === "get_cached_payload_chunk") {
      try {
        const payloadKey = args.payload_key;
        const result = getLargePayloadChunk(payloadKey, args.index);
        return ok(id, { payload_key: payloadKey, ...result });
      } catch (e) {
        console.error(`[get_cached_payload_chunk] Error:`, e.message);
        return fail(id, { code: "GET_CACHED_PAYLOAD_CHUNK_ERROR", message: e.message });
      }
    }

    if (name === "export_cached_payload") {
      try {
        const payloadKey = args.payload_key;
        const result = exportLargePayloadToFile(payloadKey);
        if (!result) return fail(id, { code: "CACHE_MISS", message: "Payload not found in cache." });
        return ok(id, { payload_key: payloadKey, ...result });
      } catch (e) {
        console.error(`[export_cached_payload] Error:`, e.message);
        return fail(id, { code: "EXPORT_CACHED_PAYLOAD_ERROR", message: e.message });
      }
    }

    if (name === "create_card") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const card = await createCard(ctx, p.id, Number(args.card_table_id), {
          title: args.title,
          content: args.content,
          description: args.description,
          column_id: args.column_id,
          due_on: args.due_on,
          position: args.position,
          idempotency_key: args.idempotency_key
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
        const known = toolFailResult(id, e);
        if (known) return known;
        // Fallback to non-enriched card
        try {
          const p = await projectByName(ctx, args.project);
          await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
          const card = await createCard(ctx, p.id, Number(args.card_table_id), {
            title: args.title,
            content: args.content,
            description: args.description,
            column_id: args.column_id,
            due_on: args.due_on,
            position: args.position,
            idempotency_key: args.idempotency_key
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
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const card = await moveCard(ctx, p.id, Number(args.card_id), {
          column_id: args.column_id,
          position: args.position,
          idempotency_key: args.idempotency_key
        });

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
        const known = toolFailResult(id, e);
        if (known) return known;
        // Fallback to non-enriched card
        try {
          const p = await projectByName(ctx, args.project);
          await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
          const card = await moveCard(ctx, p.id, Number(args.card_id), {
            column_id: args.column_id,
            position: args.position,
            idempotency_key: args.idempotency_key
          });
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
        return ok(id, { project: { id: p.id, name: p.name }, card_id: Number(args.card_id), ...buildListPayload("steps", steps) });
      } catch (e) {
        console.error(`[list_card_steps] Error:`, e.message);
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "card_tables",
            project: p,
            empty: { steps: [], count: 0, card_id: Number(args.card_id) }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        return ok(id, { fallback: true, ...buildListPayload("steps", []) });
      }
    }

    if (name === "create_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const step = await createCardStep(ctx, p.id, Number(args.card_id), body);
        return ok(id, { message: "Card step created", project: { id: p.id, name: p.name }, step });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_CARD_STEP_ERROR", message: e.message });
      }
    }

    if (name === "update_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const step = await updateCardStep(ctx, p.id, Number(args.step_id), body);
        return ok(id, { message: "Card step updated", project: { id: p.id, name: p.name }, step });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "UPDATE_CARD_STEP_ERROR", message: e.message });
      }
    }

    if (name === "complete_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const result = await completeCardStep(ctx, p.id, Number(args.step_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "COMPLETE_CARD_STEP_ERROR", message: e.message });
      }
    }

    if (name === "uncomplete_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const result = await uncompleteCardStep(ctx, p.id, Number(args.step_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "UNCOMPLETE_CARD_STEP_ERROR", message: e.message });
      }
    }

    if (name === "reposition_card_step") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const result = await repositionCardStep(ctx, p.id, Number(args.card_id), Number(args.step_id), Number(args.position));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "REPOSITION_CARD_STEP_ERROR", message: e.message });
      }
    }

    // Hill charts
    if (name === "get_hill_chart") {
      try {
        const p = await projectByName(ctx, args.project);
        const hill = await getHillChartFromDock(ctx, p.id);

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
        // Tool disabled / unavailable -> return empty with notice
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "hill_charts",
            project: p,
            empty: { hill_chart: null }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        // Fallback to non-enriched hill chart
        try {
          const p = await projectByName(ctx, args.project);
          const hill = await getHillChartFromDock(ctx, p.id);
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

        return ok(id, { project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics(), ...buildListPayload("message_boards", enrichedBoards) });
      } catch (e) {
        console.error(`[list_message_boards] Error:`, e.message);
        // Tool disabled / unavailable -> return empty with notice
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "message_boards",
            project: p,
            empty: { message_boards: [], count: 0 }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        // Fallback to non-enriched message boards
        try {
          const p = await projectByName(ctx, args.project);
          const boards = await listMessageBoards(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("message_boards", boards) });
        } catch (fbErr) {
          return fail(id, { code: "LIST_MESSAGE_BOARDS_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "list_messages") {
      try {
        const p = await projectByName(ctx, args.project);
        const boardId = firstDefined(args.message_board_id, args.board_id);
        const msgs = await listMessages(ctx, p.id, { board_id: boardId, board_title: args.board_title });

        // INTELLIGENT CHAINING: Enrich messages with person/project details
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `messages for ${p.name}`);
        const enricher = intelligent.createEnricher(ctx_intel);

        const enrichedMessages = await Promise.all(
          msgs.map(m => enricher.enrich({ ...m, bucket: { id: p.id, name: p.name } }, {
            getPerson: (id) => ctx_intel.getPerson(id),
            getProject: (id) => ctx_intel.getProject(id)
          }))
        );

        return ok(id, { project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics(), ...buildListPayload("messages", enrichedMessages) });
      } catch (e) {
        console.error(`[list_messages] Error:`, e.message);
        // Tool disabled / unavailable -> return empty with notice
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "message_boards",
            project: p,
            empty: { messages: [], count: 0 }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        // Fallback to non-enriched messages
        try {
          const p = await projectByName(ctx, args.project);
          const boardId = firstDefined(args.message_board_id, args.board_id);
          const msgs = await listMessages(ctx, p.id, { board_id: boardId, board_title: args.board_title });
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("messages", msgs) });
        } catch (fbErr) {
          return fail(id, { code: "LIST_MESSAGES_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "get_message_board") {
      try {
        const p = await projectByName(ctx, args.project);
        const boardId = firstDefined(args.message_board_id, args.board_id);
        const board = await getMessageBoard(ctx, p.id, Number(boardId));
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
        await requireDockTool(ctx, p.id, ["message_board", "message_boards"], "message_boards");
        let boardId = firstDefined(args.message_board_id, args.board_id);
        if (!boardId) {
          const boards = await listMessageBoards(ctx, p.id);
          boardId = boards?.[0]?.id;
        }
        if (!boardId) throw new Error("No message board found for this project.");
        const body = normalizeMessageBody(args, { defaultStatus: "active" });
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const message = await createMessage(ctx, p.id, Number(boardId), body);
        return ok(id, { message: "Message created", project: { id: p.id, name: p.name }, message });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_MESSAGE_ERROR", message: e.message });
      }
    }

    if (name === "update_message") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["message_board", "message_boards"], "message_boards");
        const body = normalizeMessageBody(args);
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const message = await updateMessage(ctx, p.id, Number(args.message_id), body);
        return ok(id, { message: "Message updated", project: { id: p.id, name: p.name }, message });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "UPDATE_MESSAGE_ERROR", message: e.message });
      }
    }

    if (name === "list_message_types") {
      try {
        const p = await projectByName(ctx, args.project);
        const types = await listMessageTypes(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("types", types) });
      } catch (e) {
        console.error(`[list_message_types] Error:`, e.message);
        return ok(id, { fallback: true, ...buildListPayload("types", []) });
      }
    }

    if (name === "get_message_type") {
      try {
        const p = await projectByName(ctx, args.project);
        const messageTypeId = firstDefined(args.message_type_id, args.category_id);
        const category = await getMessageType(ctx, p.id, Number(messageTypeId));
        return ok(id, { project: { id: p.id, name: p.name }, message_type: category });
      } catch (e) {
        return fail(id, { code: "GET_MESSAGE_TYPE_ERROR", message: e.message });
      }
    }

    if (name === "create_message_type") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["message_board", "message_boards"], "message_boards");
        const category = await createMessageType(ctx, p.id, args.body || {});
        return ok(id, { message: "Message type created", project: { id: p.id, name: p.name }, message_type: category });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_MESSAGE_TYPE_ERROR", message: e.message });
      }
    }

    if (name === "update_message_type") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["message_board", "message_boards"], "message_boards");
        const messageTypeId = firstDefined(args.message_type_id, args.category_id);
        const category = await updateMessageType(ctx, p.id, Number(messageTypeId), args.body || {});
        return ok(id, { message: "Message type updated", project: { id: p.id, name: p.name }, message_type: category });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "UPDATE_MESSAGE_TYPE_ERROR", message: e.message });
      }
    }

    if (name === "delete_message_type") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["message_board", "message_boards"], "message_boards");
        const messageTypeId = firstDefined(args.message_type_id, args.category_id);
        const result = await deleteMessageType(ctx, p.id, Number(messageTypeId));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
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
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("correspondences", items) });
      } catch (e) {
        console.error(`[list_client_correspondences] Error:`, e.message);
        return ok(id, { fallback: true, ...buildListPayload("correspondences", []) });
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
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("approvals", items) });
      } catch (e) {
        console.error(`[list_client_approvals] Error:`, e.message);
        return ok(id, { fallback: true, ...buildListPayload("approvals", []) });
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
        return ok(id, { project: { id: p.id, name: p.name }, recording_id: Number(args.recording_id), ...buildListPayload("replies", items) });
      } catch (e) {
        console.error(`[list_client_replies] Error:`, e.message);
        return ok(id, { fallback: true, ...buildListPayload("replies", []) });
      }
    }

    if (name === "list_inboxes") {
      try {
        const p = await projectByName(ctx, args.project);
        const inboxes = await listInboxes(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("inboxes", inboxes) });
      } catch (e) {
        return fail(id, { code: "LIST_INBOXES_ERROR", message: e.message });
      }
    }

    if (name === "list_inbox_forwards") {
      try {
        const p = await projectByName(ctx, args.project);
        let inboxId = Number(args.inbox_id);
        if (!inboxId) {
          const inboxes = await listInboxes(ctx, p.id);
          inboxId = inboxes?.[0]?.id;
        }
        if (!inboxId) throw new Error("Inbox not found or not enabled.");
        const forwards = await listInboxForwards(ctx, p.id, inboxId);
        return ok(id, { project: { id: p.id, name: p.name }, inbox_id: inboxId, ...buildListPayload("forwards", forwards) });
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
        return ok(id, { project: { id: p.id, name: p.name }, forward_id: Number(args.forward_id), ...buildListPayload("replies", replies) });
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

        return ok(id, { project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics(), ...buildListPayload("documents", enrichedDocs) });
      } catch (e) {
        console.error(`[list_documents] Error:`, e.message);
        // Tool disabled / unavailable -> return empty with notice
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "documents",
            project: p,
            empty: { documents: [], count: 0 }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        // Fallback to non-enriched documents
        try {
          const p = await projectByName(ctx, args.project);
          const docs = await listDocuments(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("documents", docs) });
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
        await requireDockTool(ctx, p.id, ["vault", "documents"], "documents");
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const doc = await createDocument(ctx, p.id, Number(args.vault_id), body);
        return ok(id, { message: "Document created", project: { id: p.id, name: p.name }, document: doc });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_DOCUMENT_ERROR", message: e.message });
      }
    }

    if (name === "update_document") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["vault", "documents"], "documents");
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const doc = await updateDocument(ctx, p.id, Number(args.document_id), body);
        return ok(id, { message: "Document updated", project: { id: p.id, name: p.name }, document: doc });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "UPDATE_DOCUMENT_ERROR", message: e.message });
      }
    }

    if (name === "create_upload") {
      try {
        const p = await projectByName(ctx, args.project);
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const upload = await createUpload(ctx, p.id, Number(args.vault_id), body);
        return ok(id, { message: "Upload created", project: { id: p.id, name: p.name }, upload });
      } catch (e) {
        return fail(id, { code: "CREATE_UPLOAD_ERROR", message: e.message });
      }
    }

    if (name === "update_upload") {
      try {
        const p = await projectByName(ctx, args.project);
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const upload = await updateUpload(ctx, p.id, Number(args.upload_id), body);
        return ok(id, { message: "Upload updated", project: { id: p.id, name: p.name }, upload });
      } catch (e) {
        return fail(id, { code: "UPDATE_UPLOAD_ERROR", message: e.message });
      }
    }

    if (name === "list_child_vaults") {
      try {
        const p = await projectByName(ctx, args.project);
        const vaults = await listChildVaults(ctx, p.id, Number(args.vault_id));
        return ok(id, { project: { id: p.id, name: p.name }, vault_id: Number(args.vault_id), ...buildListPayload("vaults", vaults) });
      } catch (e) {
        console.error(`[list_child_vaults] Error:`, e.message);
        return ok(id, { fallback: true, ...buildListPayload("vaults", []) });
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

        return ok(id, { project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics(), ...buildListPayload("schedule_entries", enrichedEntries) });
      } catch (e) {
        console.error(`[list_schedule_entries] Error:`, e.message);
        // Tool disabled / unavailable -> return empty with notice
        try {
          const p = await projectByName(ctx, args.project);
          const notice = toolNoticeResult(id, e, {
            tool: "schedule",
            project: p,
            empty: { schedule_entries: [], count: 0 }
          });
          if (notice) return notice;
        } catch {
          // ignore resolution failures
        }
        // Fallback to non-enriched schedule entries
        try {
          const p = await projectByName(ctx, args.project);
          const entries = await listScheduleEntries(ctx, p.id, { from: args.from, to: args.to });
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("schedule_entries", entries) });
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
          metrics: ctx_intel.getMetrics(),
          ...buildListPayload("results", enrichedResults)
        });
      } catch (e) {
        console.error(`[search_project] Error:`, e.message);
        // Fallback to non-enriched search
        try {
          const p = await projectByName(ctx, args.project);
          const results = await searchProject(ctx, p.id, { query: args.query });
          return ok(id, { project: { id: p.id, name: p.name }, query: args.query, fallback: true, ...buildListPayload("results", results) });
        } catch (fbErr) {
          return fail(id, { code: "SEARCH_PROJECT_ERROR", message: fbErr.message });
        }
      }
    }

    // ===== NEW PEOPLE ENDPOINTS =====
    if (name === "list_all_people") {
      try {
        const rawQuery = firstDefined(args.query, args.name, args.search, args.q);
        if (rawQuery === undefined || rawQuery === null) {
          return fail(id, {
            code: "MISSING_QUERY",
            message: "Missing query. Provide a name/email in 'query'. Use an empty string to list all people."
          });
        }

        const query = String(rawQuery);
        const deepScanRequested = args.deep_scan === true || args.deep === true;
        const includeArchivedProjects = args.include_archived_projects === true || args.include_archived === true;
        let people = [];
        let deepScanUsed = false;
        let archivedScanUsed = false;
        if (query.trim() === "") {
          people = await listAllPeople(ctx, { deepScan: false });
          if (!people.length || deepScanRequested) {
            deepScanUsed = true;
            people = await listAllPeople(ctx, { deepScan: true, include_archived_projects: includeArchivedProjects });
            if (!people.length && !includeArchivedProjects) {
              archivedScanUsed = true;
              people = await listAllPeople(ctx, { deepScan: true, include_archived_projects: true });
            }
          }
        } else {
          const result = await searchPeople(ctx, query, { include_archived_projects: includeArchivedProjects, deepScan: true });
          people = result.people;
          deepScanUsed = result.deep_scan;
          archivedScanUsed = result.archived_scan === true;
        }

        const inlineLimit = Number(process.env.PEOPLE_INLINE_LIMIT || 1000);

        // INTELLIGENT CHAINING: Provide metrics for consistency
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `list all people`);
        return ok(id, {
          metrics: ctx_intel.getMetrics(),
          query: query || undefined,
          deep_scan: deepScanUsed,
          archived_scan: archivedScanUsed,
          ...buildListPayload("people", people, { inlineLimit })
        });
      } catch (e) {
        console.error(`[list_all_people] Error:`, e.message);
        try {
          const rawQuery = firstDefined(args.query, args.name, args.search, args.q);
          const query = rawQuery == null ? "" : String(rawQuery);
          const includeArchivedProjects = args.include_archived_projects === true || args.include_archived === true;
          let people = [];
          if (query.trim() === "") {
            people = await listAllPeople(ctx, { deepScan: true });
          } else {
            const result = await searchPeople(ctx, query, { include_archived_projects: includeArchivedProjects, deepScan: true });
            people = result.people;
          }
          const inlineLimit = Number(process.env.PEOPLE_INLINE_LIMIT || 1000);
          return ok(id, { fallback: true, query: query || undefined, deep_scan: true, archived_scan: includeArchivedProjects, ...buildListPayload("people", people, { inlineLimit }) });
        } catch (fbErr) {
          return fail(id, { code: "LIST_ALL_PEOPLE_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "search_people") {
      try {
        const query = String(firstDefined(args.query, args.name, args.search, args.q) || "").trim();
        if (!query) {
          return fail(id, { code: "MISSING_QUERY", message: "Missing query. Provide a name/email in 'query'." });
        }
        const includeArchivedProjects = args.include_archived_projects === true || args.include_archived === true;
        const result = await searchPeople(ctx, query, { include_archived_projects: includeArchivedProjects, deepScan: true });
        const inlineLimit = Number(process.env.PEOPLE_INLINE_LIMIT || 1000);
        const ctx_intel = await intelligent.initializeIntelligentContext(ctx, `search people: ${query}`);
        return ok(id, {
          metrics: ctx_intel.getMetrics(),
          query,
          deep_scan: result.deep_scan,
          archived_scan: result.archived_scan === true,
          ...buildListPayload("people", result.people, { inlineLimit })
        });
      } catch (e) {
        console.error(`[search_people] Error:`, e.message);
        return fail(id, { code: "SEARCH_PEOPLE_ERROR", message: e.message });
      }
    }

    if (name === "search_projects") {
      try {
        const query = String(firstDefined(args.query, args.name, args.search, args.q) || "").trim();
        if (!query) {
          return fail(id, { code: "MISSING_QUERY", message: "Missing query. Provide a project name in 'query'." });
        }
        const includeArchivedProjects = args.include_archived_projects === true || args.include_archived === true;
        const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 20;
        const result = await searchProjects(ctx, query, { include_archived_projects: includeArchivedProjects, limit });
        return ok(id, {
          query,
          archived_scan: result.coverage?.archived_scan ?? false,
          ...buildListPayload("projects", result.projects, { coverage: result.coverage })
        });
      } catch (e) {
        console.error(`[search_projects] Error:`, e.message);
        return fail(id, { code: "SEARCH_PROJECTS_ERROR", message: e.message });
      }
    }

    if (name === "search_cards") {
      try {
        const query = String(firstDefined(args.query, args.name, args.search, args.q) || "").trim();
        if (!query) {
          return fail(id, { code: "MISSING_QUERY", message: "Missing query. Provide a card title or ID in 'query'." });
        }
        const includeArchivedProjects = args.include_archived_projects === true || args.include_archived === true;
        const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 20;
        const result = await searchCards(ctx, query, {
          project: args.project || null,
          include_archived_projects: includeArchivedProjects,
          limit,
          max_cards_per_column: Number.isFinite(Number(args.max_cards_per_column)) ? Number(args.max_cards_per_column) : 0
        });
        const payload = {
          query,
          project: result.project || null,
          ...buildListPayload("cards", result.cards || [], { coverage: result.coverage, inlineLimit: limit })
        };
        if (result.coverage?.reason === "PROJECT_REQUIRED") {
          payload.note = "Card search requires a project unless the index already contains cards.";
        }
        return ok(id, payload);
      } catch (e) {
        console.error(`[search_cards] Error:`, e.message);
        return fail(id, { code: "SEARCH_CARDS_ERROR", message: e.message });
      }
    }

    if (name === "list_person_projects") {
      try {
        const person = String(firstDefined(args.person, args.name, args.email) || "").trim();
        if (!person) {
          return fail(id, { code: "MISSING_PERSON", message: "Missing person. Provide name, email, or ID." });
        }
        const includeArchivedProjects = args.include_archived_projects === true || args.include_archived === true;
        const result = await listPersonProjects(ctx, person, { include_archived_projects: includeArchivedProjects });
        if (!result.person) {
          if (Array.isArray(result.matches) && result.matches.length > 1) {
            return fail(id, { code: "AMBIGUOUS_PERSON", message: "Multiple people matched.", matches: result.matches });
          }
          return fail(id, { code: "PERSON_NOT_FOUND", message: "No matching person found.", matches: result.matches || [] });
        }
        return ok(id, {
          person: result.person,
          ...buildListPayload("projects", result.projects || [], { coverage: result.coverage })
        });
      } catch (e) {
        console.error(`[list_person_projects] Error:`, e.message);
        return fail(id, { code: "LIST_PERSON_PROJECTS_ERROR", message: e.message });
      }
    }

    if (name === "list_person_activity") {
      try {
        const person = String(firstDefined(args.person, args.name, args.email) || "").trim();
        if (!person) {
          return fail(id, { code: "MISSING_PERSON", message: "Missing person. Provide name, email, or ID." });
        }
        const includeArchivedProjects = args.include_archived_projects === true || args.include_archived === true;
        const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 50;
        const result = await listPersonActivity(ctx, person, {
          project: args.project || null,
          query: args.query || "",
          include_archived_projects: includeArchivedProjects,
          limit
        });
        if (!result.person) {
          if (Array.isArray(result.matches) && result.matches.length > 1) {
            return fail(id, { code: "AMBIGUOUS_PERSON", message: "Multiple people matched.", matches: result.matches });
          }
          return fail(id, { code: "PERSON_NOT_FOUND", message: "No matching person found.", matches: result.matches || [] });
        }
        return ok(id, {
          person: result.person,
          project_id: result.project_id || null,
          ...buildListPayload("events", result.events || [], { coverage: result.coverage, inlineLimit: limit })
        });
      } catch (e) {
        console.error(`[list_person_activity] Error:`, e.message);
        return fail(id, { code: "LIST_PERSON_ACTIVITY_ERROR", message: e.message });
      }
    }

    if (name === "audit_person") {
      try {
        const person = String(firstDefined(args.person, args.name, args.email) || "").trim();
        if (!person) {
          return fail(id, { code: "MISSING_PERSON", message: "Missing person. Provide name, email, or ID." });
        }
        const includeArchivedProjects = args.include_archived_projects === true || args.include_archived === true;
        const result = await auditPerson(ctx, person, {
          include_archived_projects: includeArchivedProjects,
          include_assignments: args.include_assignments !== false,
          include_activity: args.include_activity !== false,
          activity_limit: Number.isFinite(Number(args.activity_limit)) ? Number(args.activity_limit) : 50
        });
        if (!result.person) {
          if (Array.isArray(result.matches) && result.matches.length > 1) {
            return fail(id, { code: "AMBIGUOUS_PERSON", message: "Multiple people matched.", matches: result.matches });
          }
          return fail(id, { code: "PERSON_NOT_FOUND", message: "No matching person found.", matches: result.matches || [] });
        }
        return ok(id, {
          person: result.person,
          projects: result.projects || [],
          projects_count: Array.isArray(result.projects) ? result.projects.length : 0,
          assignments: result.assignments,
          activity: result.activity,
          coverage: result.coverage
        });
      } catch (e) {
        console.error(`[audit_person] Error:`, e.message);
        return fail(id, { code: "AUDIT_PERSON_ERROR", message: e.message });
      }
    }

    if (name === "resolve_entity_from_url") {
      try {
        const url = String(args.url || "").trim();
        if (!url) {
          return fail(id, { code: "MISSING_URL", message: "Missing url." });
        }
        const parsed = parseBasecampUrl(url);
        if (!parsed) {
          return fail(id, { code: "INVALID_URL", message: "URL is not a recognized Basecamp URL." });
        }
        let details = null;
        let fetch_error = null;
        if (args.fetch === true) {
          try {
            if (parsed.type === "card" && parsed.bucket_id && parsed.id) {
              details = await getCard(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "todo" && parsed.bucket_id && parsed.id) {
              details = await getTodo(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "message" && parsed.bucket_id && parsed.id) {
              details = await getMessage(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "document" && parsed.bucket_id && parsed.id) {
              details = await getDocument(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "upload" && parsed.bucket_id && parsed.id) {
              details = await getUpload(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "project" && parsed.project_id) {
              details = await getProject(ctx, parsed.project_id);
            } else if (parsed.type === "person" && parsed.id) {
              details = await getPerson(ctx, parsed.id);
            } else if (parsed.type === "comment" && parsed.bucket_id && parsed.comment_id) {
              details = await getComment(ctx, parsed.bucket_id, parsed.comment_id);
            } else if (parsed.type === "card_table" && parsed.bucket_id && parsed.id) {
              details = await getCardTable(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "inbox" && parsed.bucket_id && parsed.id) {
              details = await getInbox(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "inbox_forward" && parsed.bucket_id && parsed.id) {
              details = await getInboxForward(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "inbox_reply" && parsed.bucket_id && parsed.forward_id && parsed.reply_id) {
              details = await getInboxReply(ctx, parsed.bucket_id, parsed.forward_id, parsed.reply_id);
            } else if (parsed.type === "client_correspondence" && parsed.bucket_id && parsed.id) {
              details = await getClientCorrespondence(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "client_approval" && parsed.bucket_id && parsed.id) {
              details = await getClientApproval(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "questionnaire" && parsed.bucket_id && parsed.id) {
              details = await getQuestionnaire(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "question" && parsed.bucket_id && parsed.id) {
              details = await getQuestion(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "question_answer" && parsed.bucket_id && parsed.id) {
              details = await getQuestionAnswer(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "webhook" && parsed.bucket_id && parsed.id) {
              details = await getWebhook(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "template" && parsed.id) {
              details = await getTemplate(ctx, parsed.id);
            } else if (parsed.type === "template_construction" && parsed.template_id && parsed.id) {
              details = await getProjectConstruction(ctx, parsed.template_id, parsed.id);
            } else if (parsed.type === "schedule" && parsed.bucket_id && parsed.id) {
              details = await getSchedule(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "schedule_entry" && parsed.bucket_id && parsed.id) {
              details = await getScheduleEntry(ctx, parsed.bucket_id, parsed.id);
            } else if (parsed.type === "lineup_marker" && parsed.id) {
              details = await api(ctx, `/lineup/markers/${parsed.id}.json`);
            }
          } catch (e) {
            fetch_error = e?.message || String(e);
          }
        }
        return ok(id, { ...parsed, details, fetch_error });
      } catch (e) {
        console.error(`[resolve_entity_from_url] Error:`, e.message);
        return fail(id, { code: "RESOLVE_ENTITY_ERROR", message: e.message });
      }
    }

    if (name === "search_entities") {
      try {
        const query = String(firstDefined(args.query, args.name, args.search, args.q) || "").trim();
        if (!query) {
          return fail(id, { code: "MISSING_QUERY", message: "Missing query. Provide a search term in 'query'." });
        }
        const payload = await searchEntities(ctx, query, {
          project: args.project || null,
          include_archived_projects: args.include_archived_projects === true || args.include_archived === true,
          include_people: args.include_people !== false,
          include_projects: args.include_projects !== false,
          include_recordings: args.include_recordings !== false,
          include_todos: args.include_todos !== false,
          include_cards: args.include_cards !== false,
          limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 20
        });
        return ok(id, payload);
      } catch (e) {
        console.error(`[search_entities] Error:`, e.message);
        return fail(id, { code: "SEARCH_ENTITIES_ERROR", message: e.message });
      }
    }

    if (name === "list_pingable_people") {
      try {
        const people = await listPingablePeople(ctx);
        return ok(id, { ...buildListPayload("people", people) });
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

        return ok(id, { project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics(), ...buildListPayload("people", enrichedPeople) });
      } catch (e) {
        console.error(`[list_project_people] Error:`, e.message);
        try {
          const p = await projectByName(ctx, args.project);
          const people = await listProjectPeople(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("people", people) });
        } catch (fbErr) {
          return fail(id, { code: "LIST_PROJECT_PEOPLE_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "update_project_people") {
      try {
        const p = await projectByName(ctx, args.project);
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const result = await updateProjectPeople(ctx, p.id, body);
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
          _meta: result._meta,
          metrics: ctx_intel.getMetrics(),
          ...buildListPayload("comments", enrichedComments)
        });
      } catch (e) {
        console.error(`[list_comments] Error:`, e.message);
        // Fallback to non-enriched comments
        try {
          const p = await projectByName(ctx, args.project);
          const result = await listComments(ctx, p.id, args.recording_id);
          const comments = result.comments || [];
          return ok(id, { project: { id: p.id, name: p.name }, recording_id: args.recording_id, _meta: result._meta, fallback: true, ...buildListPayload("comments", comments) });
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
        const content = extractContent(args);
        const recordingId = firstDefined(
          args.recording_id,
          args.card_id,
          args.card,
          args.recording,
          args.recordingId,
          args.cardId,
          args.recording_url,
          args.card_url,
          args.url
        );
        logCommentDebug("[create_comment] tool input", {
          project: args.project,
          project_id: p?.id,
          recording_id: args.recording_id ?? null,
          card_id: args.card_id ?? null,
          recordingId: args.recordingId ?? null,
          cardId: args.cardId ?? null,
          url: args.url || args.card_url || args.recording_url || null,
          resolved_recording_id: recordingId ?? null,
          content_len: String(content || "").length
        });
        const comment = await createComment(ctx, p.id, recordingId, content, {
          recordingQuery: args.recording_query || args.recording_title || args.query || null,
          idempotency_key: args.idempotency_key
        });

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
          const content = extractContent(args);
          const recordingId = firstDefined(
            args.recording_id,
            args.card_id,
            args.card,
            args.recording,
            args.recordingId,
            args.cardId,
            args.recording_url,
            args.card_url,
            args.url
          );
          logCommentDebug("[create_comment] tool input (fallback)", {
            project: args.project,
            project_id: p?.id,
            recording_id: args.recording_id ?? null,
            card_id: args.card_id ?? null,
            recordingId: args.recordingId ?? null,
            cardId: args.cardId ?? null,
            url: args.url || args.card_url || args.recording_url || null,
            resolved_recording_id: recordingId ?? null,
            content_len: String(content || "").length
          });
          const comment = await createComment(ctx, p.id, recordingId, content, {
            recordingQuery: args.recording_query || args.recording_title || args.query || null,
            idempotency_key: args.idempotency_key
          });
          return ok(id, { message: "Comment created", project: { id: p.id, name: p.name }, comment, fallback: true });
        } catch (fbErr) {
          return fail(id, { code: "CREATE_COMMENT_ERROR", message: fbErr.message });
        }
      }
    }

    if (name === "update_comment") {
      try {
        const p = await projectByName(ctx, args.project);
        const content = extractContent(args);
        const comment = await updateComment(ctx, p.id, args.comment_id, content, { idempotency_key: args.idempotency_key });
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

        return ok(id, { project: { id: p.id, name: p.name }, vault_id: vaultId, metrics: ctx_intel.getMetrics(), ...buildListPayload("uploads", enrichedUploads) });
      } catch (e) {
        console.error(`[list_uploads] Error:`, e.message);
        // Fallback to non-enriched uploads
        try {
          const p = await projectByName(ctx, args.project);
          const vaults = await listVaults(ctx, p.id);
          const vaultId = args.vault_id || (vaults?.[0]?.id);
          if (!vaultId) return fail(id, { code: "NO_VAULT", message: "No vault found for this project." });
          const uploads = await listUploads(ctx, p.id, vaultId);
          return ok(id, { project: { id: p.id, name: p.name }, vault_id: vaultId, fallback: true, ...buildListPayload("uploads", uploads) });
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

        return ok(id, { type: args.type, metrics: ctx_intel.getMetrics(), ...buildListPayload("recordings", enrichedRecordings) });
      } catch (e) {
        console.error(`[get_recordings] Error:`, e.message);
        // Fallback to non-enriched recordings
        try {
          const recordings = await getRecordings(ctx, args.type, { bucket: args.bucket, status: args.status });
          return ok(id, { type: args.type, fallback: true, ...buildListPayload("recordings", recordings) });
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
    if (name === "get_vault") {
      try {
        const p = await projectByName(ctx, args.project);
        const vault = await getVault(ctx, p.id, Number(args.vault_id));
        return ok(id, { project: { id: p.id, name: p.name }, vault });
      } catch (e) {
        return fail(id, { code: "GET_VAULT_ERROR", message: e.message });
      }
    }

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

        return ok(id, { project: { id: p.id, name: p.name }, metrics: ctx_intel.getMetrics(), ...buildListPayload("vaults", enrichedVaults) });
      } catch (e) {
        console.error(`[list_vaults] Error:`, e.message);
        // Fallback to non-enriched vaults
        try {
          const p = await projectByName(ctx, args.project);
          const vaults = await listVaults(ctx, p.id);
          return ok(id, { project: { id: p.id, name: p.name }, fallback: true, ...buildListPayload("vaults", vaults) });
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
          return ok(id, { ...buildListPayload("campfires", chats) });
        }
        const p = await projectByName(ctx, projectName);
        const chats = await listCampfires(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("campfires", chats) });
      } catch (e) {
        console.error(`[list_campfires] Error:`, e.message);
        return ok(id, { fallback: true, ...buildListPayload("campfires", []) });
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
        return ok(id, { project: { id: p.id, name: p.name }, chat_id: Number(args.chat_id), ...buildListPayload("lines", lines) });
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
        await requireDockTool(ctx, p.id, ["chat", "campfire", "campfires"], "campfire");
        const body = (args.body && typeof args.body === "object" && !Array.isArray(args.body)) ? { ...args.body } : {};
        const content = firstDefined(extractContent(body), extractContent(args));
        if (content != null && body.content == null) body.content = content;
        const line = await createCampfireLine(ctx, p.id, Number(args.chat_id), body);
        return ok(id, { message: "Campfire line created", project: { id: p.id, name: p.name }, line });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_CAMPFIRE_LINE_ERROR", message: e.message });
      }
    }

    if (name === "delete_campfire_line") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["chat", "campfire", "campfires"], "campfire");
        const result = await deleteCampfireLine(ctx, p.id, Number(args.chat_id), Number(args.line_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "DELETE_CAMPFIRE_LINE_ERROR", message: e.message });
      }
    }

    if (name === "list_chatbots") {
      try {
        const p = await projectByName(ctx, args.project);
        const bots = await listChatbots(ctx, p.id, Number(args.chat_id));
        return ok(id, { project: { id: p.id, name: p.name }, chat_id: Number(args.chat_id), ...buildListPayload("chatbots", bots) });
      } catch (e) {
        return fail(id, { code: "LIST_CHATBOTS_ERROR", message: e.message });
      }
    }

    if (name === "get_chatbot") {
      try {
        const p = await projectByName(ctx, args.project);
        const chatbotId = firstDefined(args.chatbot_id, args.integration_id);
        const bot = await getChatbot(ctx, p.id, Number(args.chat_id), Number(chatbotId));
        return ok(id, { project: { id: p.id, name: p.name }, chat_id: Number(args.chat_id), chatbot: bot });
      } catch (e) {
        return fail(id, { code: "GET_CHATBOT_ERROR", message: e.message });
      }
    }

    if (name === "create_chatbot") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["chat", "campfire", "campfires"], "campfire");
        const bot = await createChatbot(ctx, p.id, Number(args.chat_id), args.body || {});
        return ok(id, { message: "Chatbot created", project: { id: p.id, name: p.name }, chatbot: bot });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_CHATBOT_ERROR", message: e.message });
      }
    }

    if (name === "update_chatbot") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["chat", "campfire", "campfires"], "campfire");
        const chatbotId = firstDefined(args.chatbot_id, args.integration_id);
        const bot = await updateChatbot(ctx, p.id, Number(args.chat_id), Number(chatbotId), args.body || {});
        return ok(id, { message: "Chatbot updated", project: { id: p.id, name: p.name }, chatbot: bot });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "UPDATE_CHATBOT_ERROR", message: e.message });
      }
    }

    if (name === "delete_chatbot") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["chat", "campfire", "campfires"], "campfire");
        const chatbotId = firstDefined(args.chatbot_id, args.integration_id);
        const result = await deleteChatbot(ctx, p.id, Number(args.chat_id), Number(chatbotId));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "DELETE_CHATBOT_ERROR", message: e.message });
      }
    }

    if (name === "post_chatbot_line") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["chat", "campfire", "campfires"], "campfire");
        const body = (args.body && typeof args.body === "object" && !Array.isArray(args.body)) ? { ...args.body } : {};
        const content = firstDefined(extractContent(body), extractContent(args));
        if (content != null && body.content == null) body.content = content;

        let integrationKey = firstDefined(args.integration_key, args.integrationKey);
        const chatbotId = firstDefined(args.chatbot_id, args.integration_id);

        if (!integrationKey && chatbotId) {
          const bot = await getChatbot(ctx, p.id, Number(args.chat_id), Number(chatbotId));
          if (bot?.lines_url) {
            const line = await api(ctx, bot.lines_url, { method: "POST", body });
            return ok(id, { message: "Chatbot line posted", project: { id: p.id, name: p.name }, line });
          }
          integrationKey = bot?.integration_key || bot?.key || null;
        }

        if (!integrationKey) {
          throw new Error("Missing integration_key or chatbot_id to post chatbot line.");
        }

        const line = await postChatbotLine(ctx, p.id, Number(args.chat_id), integrationKey, body);
        return ok(id, { message: "Chatbot line posted", project: { id: p.id, name: p.name }, line });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "POST_CHATBOT_LINE_ERROR", message: e.message });
      }
    }

    if (name === "list_webhooks") {
      try {
        const p = await projectByName(ctx, args.project);
        const hooks = await listWebhooks(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("webhooks", hooks) });
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
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("events", events) });
      } catch (e) {
        return fail(id, { code: "LIST_RECORDING_EVENTS_ERROR", message: e.message });
      }
    }

    if (name === "list_timesheet_report") {
      try {
        const params = new URLSearchParams();
        if (args.start_date) params.set("start_date", args.start_date);
        if (args.end_date) params.set("end_date", args.end_date);
        if (args.person_id) params.set("person_id", String(args.person_id));
        if (args.bucket_id) params.set("bucket_id", String(args.bucket_id));
        const entries = await reportTimesheet(ctx, params.toString());
        return ok(id, { ...buildListPayload("timesheet_entries", entries) });
      } catch (e) {
        return fail(id, { code: "LIST_TIMESHEET_REPORT_ERROR", message: e.message });
      }
    }

    if (name === "list_project_timesheet") {
      try {
        const p = await projectByName(ctx, args.project);
        const entries = await projectTimesheet(ctx, p.id);
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("timesheet_entries", entries) });
      } catch (e) {
        return fail(id, { code: "LIST_PROJECT_TIMESHEET_ERROR", message: e.message });
      }
    }

    if (name === "list_recording_timesheet") {
      try {
        const p = await projectByName(ctx, args.project);
        const entries = await recordingTimesheet(ctx, p.id, Number(args.recording_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("timesheet_entries", entries) });
      } catch (e) {
        return fail(id, { code: "LIST_RECORDING_TIMESHEET_ERROR", message: e.message });
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
        return ok(id, { ...buildListPayload("overdue", data) });
      } catch (e) {
        return fail(id, { code: "REPORT_TODOS_OVERDUE_ERROR", message: e.message });
      }
    }

    if (name === "report_schedules_upcoming") {
      try {
        const data = await reportSchedulesUpcoming(ctx, args.query || "");
        return ok(id, { ...buildListPayload("upcoming", data) });
      } catch (e) {
        return fail(id, { code: "REPORT_SCHEDULES_UPCOMING_ERROR", message: e.message });
      }
    }

    if (name === "report_timeline") {
      try {
        const data = await reportTimeline(ctx, args.query || "");
        return ok(id, { ...buildListPayload("events", data) });
      } catch (e) {
        return fail(id, { code: "REPORT_TIMELINE_ERROR", message: e.message });
      }
    }

    if (name === "project_timeline") {
      try {
        const data = await projectTimeline(ctx, Number(args.project_id), args.query || "");
        return ok(id, { project_id: Number(args.project_id), ...buildListPayload("events", data) });
      } catch (e) {
        return fail(id, { code: "PROJECT_TIMELINE_ERROR", message: e.message });
      }
    }

    if (name === "user_timeline") {
      try {
        const data = await userTimeline(ctx, Number(args.person_id), args.query || "");
        return ok(id, { person_id: Number(args.person_id), ...buildListPayload("events", data) });
      } catch (e) {
        return fail(id, { code: "USER_TIMELINE_ERROR", message: e.message });
      }
    }

    if (name === "report_timesheet") {
      try {
        const data = await reportTimesheet(ctx, args.query || "");
        return ok(id, { ...buildListPayload("entries", data) });
      } catch (e) {
        return fail(id, { code: "REPORT_TIMESHEET_ERROR", message: e.message });
      }
    }

    if (name === "project_timesheet") {
      try {
        const data = await projectTimesheet(ctx, Number(args.project_id), args.query || "");
        return ok(id, { project_id: Number(args.project_id), ...buildListPayload("entries", data) });
      } catch (e) {
        return fail(id, { code: "PROJECT_TIMESHEET_ERROR", message: e.message });
      }
    }

    if (name === "recording_timesheet") {
      try {
        const data = await recordingTimesheet(ctx, Number(args.project_id), Number(args.recording_id), args.query || "");
        return ok(id, { project_id: Number(args.project_id), recording_id: Number(args.recording_id), ...buildListPayload("entries", data) });
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
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("forwards", forwards) });
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
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("replies", replies) });
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
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("questions", questions) });
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
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("answers", answers) });
      } catch (e) {
        return fail(id, { code: "LIST_QUESTION_ANSWERS_ERROR", message: e.message });
      }
    }

    if (name === "list_question_answers_by") {
      try {
        const p = await projectByName(ctx, args.project);
        const people = await listQuestionAnswersBy(ctx, p.id, Number(args.question_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("people", people) });
      } catch (e) {
        return fail(id, { code: "LIST_QUESTION_ANSWERS_BY_ERROR", message: e.message });
      }
    }

    if (name === "list_question_answers_by_person") {
      try {
        const p = await projectByName(ctx, args.project);
        const answers = await listQuestionAnswersByPerson(ctx, p.id, Number(args.question_id), Number(args.person_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("answers", answers) });
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
        return ok(id, { ...buildListPayload("reminders", reminders) });
      } catch (e) {
        return fail(id, { code: "LIST_QUESTION_REMINDERS_ERROR", message: e.message });
      }
    }

    if (name === "list_templates") {
      try {
        const templates = await listTemplates(ctx);
        return ok(id, { ...buildListPayload("templates", templates) });
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

    if (name === "list_lineup_markers") {
      try {
        const markers = await listLineupMarkers(ctx);
        return ok(id, { ...buildListPayload("markers", markers) });
      } catch (e) {
        return fail(id, { code: "LIST_LINEUP_MARKERS_ERROR", message: e.message });
      }
    }

    if (name === "list_todolist_groups") {
      try {
        const p = await projectByName(ctx, args.project);
        const groups = await listTodolistGroups(ctx, p.id, Number(args.todolist_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...buildListPayload("groups", groups) });
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
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const group = await createTodolistGroup(ctx, p.id, Number(args.todolist_id), body);
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
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const todolist = await createTodoList(ctx, p.id, Number(args.todoset_id), body);
        return ok(id, { message: "Todolist created", project: { id: p.id, name: p.name }, todolist });
      } catch (e) {
        return fail(id, { code: "CREATE_TODOLIST_ERROR", message: e.message });
      }
    }

    if (name === "update_todolist") {
      try {
        const p = await projectByName(ctx, args.project);
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const todolist = await updateTodoList(ctx, p.id, Number(args.todolist_id), body);
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
        await requireDockTool(ctx, p.id, ["schedule", "schedules"], "schedule");
        const schedule = await updateSchedule(ctx, p.id, Number(args.schedule_id), args.body || {});
        return ok(id, { message: "Schedule updated", project: { id: p.id, name: p.name }, schedule });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
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
        await requireDockTool(ctx, p.id, ["schedule", "schedules"], "schedule");
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const entry = await createScheduleEntry(ctx, p.id, Number(args.schedule_id), body);
        return ok(id, { message: "Schedule entry created", project: { id: p.id, name: p.name }, entry });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_SCHEDULE_ENTRY_ERROR", message: e.message });
      }
    }

    if (name === "update_schedule_entry") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["schedule", "schedules"], "schedule");
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const entry = await updateScheduleEntry(ctx, p.id, Number(args.entry_id), body);
        return ok(id, { message: "Schedule entry updated", project: { id: p.id, name: p.name }, entry });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
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
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const column = await createCardTableColumn(ctx, p.id, Number(args.card_table_id), args.body || {});
        return ok(id, { message: "Card table column created", project: { id: p.id, name: p.name }, column });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "update_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const column = await updateCardTableColumn(ctx, p.id, Number(args.column_id), args.body || {});
        return ok(id, { message: "Card table column updated", project: { id: p.id, name: p.name }, column });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "UPDATE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "move_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const column = await moveCardTableColumn(ctx, p.id, Number(args.card_table_id), args.body || {});
        return ok(id, { message: "Card table column moved", project: { id: p.id, name: p.name }, column });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "MOVE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "subscribe_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const result = await subscribeCardTableColumn(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "SUBSCRIBE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "unsubscribe_card_table_column") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const result = await unsubscribeCardTableColumn(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "UNSUBSCRIBE_CARD_TABLE_COLUMN_ERROR", message: e.message });
      }
    }

    if (name === "create_card_table_on_hold") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const result = await createCardTableOnHold(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
        return fail(id, { code: "CREATE_CARD_TABLE_ON_HOLD_ERROR", message: e.message });
      }
    }

    if (name === "delete_card_table_on_hold") {
      try {
        const p = await projectByName(ctx, args.project);
        await requireDockTool(ctx, p.id, ["card_table", "card_tables", "kanban", "kanban_board"], "card_tables");
        const result = await deleteCardTableOnHold(ctx, p.id, Number(args.column_id));
        return ok(id, { project: { id: p.id, name: p.name }, ...result });
      } catch (e) {
        const known = toolFailResult(id, e);
        if (known) return known;
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
        const body = { ...(args.body || {}) };
        if (args.idempotency_key && !body.idempotency_key) body.idempotency_key = args.idempotency_key;
        const card = await updateCard(ctx, p.id, Number(args.card_id), body);
        return ok(id, { message: "Card updated", project: { id: p.id, name: p.name }, card });
      } catch (e) {
        return fail(id, { code: "UPDATE_CARD_ERROR", message: e.message });
      }
    }

    if (name === "archive_card") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await archiveCard(ctx, p.id, Number(args.card_id));
        return ok(id, { ...result, project: { id: p.id, name: p.name } });
      } catch (e) {
        return fail(id, { code: "ARCHIVE_CARD_ERROR", message: e.message });
      }
    }

    if (name === "unarchive_card") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await unarchiveCard(ctx, p.id, Number(args.card_id));
        return ok(id, { ...result, project: { id: p.id, name: p.name } });
      } catch (e) {
        return fail(id, { code: "UNARCHIVE_CARD_ERROR", message: e.message });
      }
    }

    if (name === "trash_card") {
      try {
        const p = await projectByName(ctx, args.project);
        const result = await trashCard(ctx, p.id, Number(args.card_id));
        return ok(id, { ...result, project: { id: p.id, name: p.name } });
      } catch (e) {
        return fail(id, { code: "TRASH_CARD_ERROR", message: e.message });
      }
    }

    // ===== NEW SEARCH ENDPOINTS =====
    if (name === "search_recordings") {
      let bucketId = args.bucket;
      try {
        if (bucketId != null && bucketId !== "") {
          if (!/^\d+$/.test(String(bucketId))) {
            try {
              const p = await projectByName(ctx, String(bucketId));
              bucketId = p?.id;
            } catch {
              return fail(id, { code: "INVALID_BUCKET", message: "bucket must be a project id or resolvable project name." });
            }
          } else {
            bucketId = Number(bucketId);
          }
        }

        const results = await searchRecordings(ctx, args.query, {
          bucket_id: bucketId,
          type: args.type,
          creator_id: args.creator_id,
          file_type: args.file_type,
          exclude_chat: args.exclude_chat
        });

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

        const inlineLimit = Number(process.env.SEARCH_INLINE_LIMIT || 1000);
        const payload = {
          query: args.query,
          metrics: ctx_intel.getMetrics(),
          ...buildListPayload("results", enrichedResults, { inlineLimit })
        };

        if (Array.isArray(enrichedResults) && enrichedResults.length === 0) {
          try {
            const [people, projects] = await Promise.all([
              listAllPeople(ctx),
              listProjects(ctx, { archived: false, compact: true })
            ]);
            const peopleMatches = findNameMatches(people, args.query, { limit: 8 }).map((p) => ({
              id: p.id,
              name: p.name,
              email: p.email_address || p.email || null,
              title: p.title || null,
              app_url: p.app_url || null
            }));
            const projectMatches = findNameMatches(projects, args.query, { limit: 8 }).map((p) => ({
              id: p.id,
              name: p.name,
              status: p.status || null,
              app_url: p.app_url || null
            }));
            if (peopleMatches.length || projectMatches.length) {
              payload.name_matches = {
                people: peopleMatches,
                projects: projectMatches
              };
              payload.note = "No recordings matched. Showing people/projects name matches from /people.json and /projects.json.";
            }
          } catch (nameErr) {
            console.warn("[search_recordings] name-match fallback failed:", nameErr?.message || nameErr);
          }
        }

        return ok(id, payload);
      } catch (e) {
        console.error(`[search_recordings] Error:`, e.message);
        // Fallback to non-enriched search
        try {
          const results = await searchRecordings(ctx, args.query, {
            bucket_id: bucketId,
            type: args.type,
            creator_id: args.creator_id,
            file_type: args.file_type,
            exclude_chat: args.exclude_chat
          });
          const inlineLimit = Number(process.env.SEARCH_INLINE_LIMIT || 1000);
          return ok(id, { query: args.query, fallback: true, ...buildListPayload("results", results, { inlineLimit }) });
        } catch (fbErr) {
          return fail(id, { code: "SEARCH_RECORDINGS_ERROR", message: fbErr.message });
        }
      }
    }

    // Raw
    if (name === "basecamp_request" || name === "basecamp_raw") {
      const method = args.method || "GET";
      const httpMethod = String(method || "GET").toUpperCase();
      const paginate = args.paginate !== false && httpMethod === "GET";
      try {
        const data = paginate ? await apiAll(ctx, args.path) : await api(ctx, args.path, { method, body: args.body });
        return ok(id, data);
      } catch (e) {
        // Auto-recover common card table path mistakes for GETs.
        if (httpMethod === "GET" && isApiError(e, 404)) {
          const path = String(args.path || "");
          const tableMatch = path.match(/^\/buckets\/(\d+)\/card_tables\/(\d+)\.json$/);
          const cardsMatch = path.match(/^\/buckets\/(\d+)\/card_tables\/(\d+)\/cards\.json$/);

          if (tableMatch) {
            const projectId = Number(tableMatch[1]);
            const tables = await listCardTables(ctx, projectId);
            const tableId = Number(tableMatch[2]);
            const table = (tables || []).find(t => Number(t?.id) === tableId) || (tables || [])[0] || null;
            if (table) {
              logDebug("[basecamp_raw] resolved card_table from listCardTables", { projectId, tableId, tablesCount: (tables || []).length });
              return ok(id, { resolved: true, data: table, tables_count: (tables || []).length });
            }
          }

          if (cardsMatch) {
            const projectId = Number(cardsMatch[1]);
            const tables = await listCardTables(ctx, projectId);
            const tableId = Number(cardsMatch[2]);
            const table = (tables || []).find(t => Number(t?.id) === tableId) || (tables || [])[0] || null;
            if (table?.lists) {
              const allCards = [];
              for (const column of table.lists) {
                if (column.cards_url) {
                  const cards = await apiAll(ctx, column.cards_url);
                  allCards.push(...(Array.isArray(cards) ? cards : []));
                }
              }
              logDebug("[basecamp_raw] resolved card_table cards from listCardTables", { projectId, tableId, resolvedId: table?.id || null, tablesCount: (tables || []).length, cards: allCards.length });
              return ok(id, { resolved: true, card_table_id: table?.id || null, data: allCards, tables_count: (tables || []).length });
            }
          }
        }
        throw e;
      }
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
    if (e?.code === "BASECAMP_API_ERROR" && (e.status === 404 || e.status === 403)) {
      const tool = inferToolFromName(params?.name);
      const empty = emptyPayloadForToolName(params?.name);
      if (tool && empty) {
        try {
          const projectName = params?.arguments?.project;
          const project = projectName ? await projectByName(ctx, projectName) : null;
          const notice = toolNoticeResult(id, toolError("TOOL_UNAVAILABLE", "Tool unavailable or disabled for this project.", {
            tool,
            status: e.status,
            hint: "Enable the tool in the project’s Basecamp settings."
          }), { tool, project, empty });
          if (notice) return notice;
        } catch {
          // fall through
        }
      }
    }
    if (e?.code === "BASECAMP_API_ERROR") {
      return fail(id, { code: "BASECAMP_API_ERROR", message: `Basecamp API error (${e.status})`, url: e.url, data: e.data });
    }
    return fail(id, { code: "INTERNAL_ERROR", message: e?.message || String(e) });
  }
}






