/**
 * basecamp-local-query.js
 *
 * Local-first read layer for Basecamp data.
 * Checks Postgres snapshot tables first; if data is fresh, returns it immediately.
 * If stale or missing, fetches from MCP/API, updates local store, then returns.
 *
 * Also provides write-through mutation helpers that update the API first,
 * then upsert the local snapshot row so reads stay current without a full sync.
 */

import {
  queryBasecampMessages,
  queryBasecampScheduleEntries,
  queryBasecampCards,
  queryBasecampDocuments,
  queryBasecampPeople,
  queryBasecampTodos,
  getBasecampSnapshotAge,
  upsertBasecampResource,
  deleteBasecampResource,
} from "./db.js";

const DEFAULT_MAX_AGE_MS = Number(process.env.BASECAMP_LOCAL_QUERY_MAX_AGE_MS || 5 * 60 * 1000);

/**
 * Generic local-first read.
 * 1. Query local DB
 * 2. If rows exist and snapshot is fresh, return them
 * 3. Otherwise call `fetchFn` (MCP/API), return those results
 *
 * We do NOT block on writing fetched data to local DB here -- the background
 * sync loop handles that. This keeps reads fast.
 */
export async function localFirstRead({
  userKey,
  accountId,
  queryLocal,
  fetchRemote,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
}) {
  const age = await getBasecampSnapshotAge(userKey, accountId);
  if (age !== null && age <= maxAgeMs) {
    const local = await queryLocal();
    if (local && (Array.isArray(local) ? local.length > 0 : true)) {
      return { source: "local", data: local, ageMs: age };
    }
  }

  // Stale or empty -- fetch from remote
  try {
    const remote = await fetchRemote();
    return { source: "remote", data: remote, ageMs: age };
  } catch (err) {
    // If remote fails but we have stale local data, return it
    const stale = await queryLocal();
    if (stale && (Array.isArray(stale) ? stale.length > 0 : true)) {
      return { source: "local_stale", data: stale, ageMs: age, error: err?.message };
    }
    throw err;
  }
}

// ──────────────────────────────────────────────
// Resource-specific local-first readers
// ──────────────────────────────────────────────

export async function localFirstMessages({ userKey, accountId, projectId, limit, fetchRemote, maxAgeMs }) {
  return localFirstRead({
    userKey,
    accountId,
    maxAgeMs,
    queryLocal: () => queryBasecampMessages(userKey, accountId, { projectId, limit }),
    fetchRemote,
  });
}

export async function localFirstScheduleEntries({ userKey, accountId, projectId, fromDate, toDate, limit, fetchRemote, maxAgeMs }) {
  return localFirstRead({
    userKey,
    accountId,
    maxAgeMs,
    queryLocal: () => queryBasecampScheduleEntries(userKey, accountId, { projectId, fromDate, toDate, limit }),
    fetchRemote,
  });
}

export async function localFirstCards({ userKey, accountId, projectId, columnName, limit, fetchRemote, maxAgeMs }) {
  return localFirstRead({
    userKey,
    accountId,
    maxAgeMs,
    queryLocal: () => queryBasecampCards(userKey, accountId, { projectId, columnName, limit }),
    fetchRemote,
  });
}

export async function localFirstDocuments({ userKey, accountId, projectId, limit, fetchRemote, maxAgeMs }) {
  return localFirstRead({
    userKey,
    accountId,
    maxAgeMs,
    queryLocal: () => queryBasecampDocuments(userKey, accountId, { projectId, limit }),
    fetchRemote,
  });
}

export async function localFirstPeople({ userKey, accountId, projectId, limit, fetchRemote, maxAgeMs }) {
  return localFirstRead({
    userKey,
    accountId,
    maxAgeMs,
    queryLocal: () => queryBasecampPeople(userKey, accountId, { projectId, limit }),
    fetchRemote,
  });
}

export async function localFirstTodos({ userKey, accountId, projectId, limit, fetchRemote, maxAgeMs }) {
  return localFirstRead({
    userKey,
    accountId,
    maxAgeMs,
    queryLocal: () => queryBasecampTodos(userKey, accountId, { projectId, limit }),
    fetchRemote,
  });
}

// ──────────────────────────────────────────────
// Cross-resource search
// ──────────────────────────────────────────────

export async function searchLocalBasecamp(userKey, accountId, { query, projectId, limit = 20 } = {}) {
  if (!query || typeof query !== "string") return { results: [] };
  const q = query.toLowerCase();

  const [todos, messages, scheduleEntries, cards, documents, people] = await Promise.all([
    queryBasecampTodos(userKey, accountId, { projectId, limit: 100 }),
    queryBasecampMessages(userKey, accountId, { projectId, limit: 100 }),
    queryBasecampScheduleEntries(userKey, accountId, { projectId, limit: 100 }),
    queryBasecampCards(userKey, accountId, { projectId, limit: 100 }),
    queryBasecampDocuments(userKey, accountId, { projectId, limit: 100 }),
    queryBasecampPeople(userKey, accountId, { limit: 100 }),
  ]);

  const results = [];

  for (const todo of todos) {
    const text = `${todo.title || ""} ${todo.project_name || ""} ${todo.todolist_name || ""}`.toLowerCase();
    if (text.includes(q)) results.push({ type: "todo", id: todo.todo_id, title: todo.title, projectName: todo.project_name, appUrl: todo.app_url });
  }
  for (const msg of messages) {
    const text = `${msg.subject || ""} ${msg.content_preview || ""} ${msg.project_name || ""}`.toLowerCase();
    if (text.includes(q)) results.push({ type: "message", id: msg.message_id, title: msg.subject, projectName: msg.project_name, appUrl: msg.app_url });
  }
  for (const entry of scheduleEntries) {
    const text = `${entry.summary || ""} ${entry.description || ""} ${entry.project_name || ""}`.toLowerCase();
    if (text.includes(q)) results.push({ type: "schedule_entry", id: entry.entry_id, title: entry.summary, projectName: entry.project_name, appUrl: entry.app_url });
  }
  for (const card of cards) {
    const text = `${card.title || ""} ${card.content_preview || ""} ${card.column_name || ""} ${card.project_name || ""}`.toLowerCase();
    if (text.includes(q)) results.push({ type: "card", id: card.card_id, title: card.title, projectName: card.project_name, appUrl: card.app_url });
  }
  for (const doc of documents) {
    const text = `${doc.title || ""} ${doc.content_preview || ""} ${doc.project_name || ""}`.toLowerCase();
    if (text.includes(q)) results.push({ type: "document", id: doc.document_id, title: doc.title, projectName: doc.project_name, appUrl: doc.app_url });
  }
  for (const person of people) {
    const text = `${person.name || ""} ${person.email_address || ""} ${person.company || ""}`.toLowerCase();
    if (text.includes(q)) results.push({ type: "person", id: person.person_id, title: person.name, email: person.email_address });
  }

  return { results: results.slice(0, limit), total: results.length, query };
}

// ──────────────────────────────────────────────
// Write-through mutation helpers
// ──────────────────────────────────────────────

/**
 * After a successful API mutation (create/update), upsert the local snapshot row
 * so subsequent reads see the change without waiting for a full sync.
 */
export async function syncLocalAfterCreate(userKey, accountId, { table, idColumn, record }) {
  try {
    await upsertBasecampResource(userKey, accountId, table, idColumn, record);
  } catch {
    // Non-fatal: next sync will pick it up
  }
}

export async function syncLocalAfterDelete(userKey, accountId, { table, idColumn, resourceId }) {
  try {
    await deleteBasecampResource(userKey, accountId, table, idColumn, resourceId);
  } catch {
    // Non-fatal
  }
}

// Table/column mappings for easy write-through
export const RESOURCE_TABLE_MAP = {
  todo: { table: "basecamp_todo_snapshots", idColumn: "todo_id" },
  message: { table: "basecamp_message_snapshots", idColumn: "message_id" },
  schedule_entry: { table: "basecamp_schedule_entry_snapshots", idColumn: "entry_id" },
  card: { table: "basecamp_card_snapshots", idColumn: "card_id" },
  document: { table: "basecamp_document_snapshots", idColumn: "document_id" },
  person: { table: "basecamp_person_snapshots", idColumn: "person_id" },
};
