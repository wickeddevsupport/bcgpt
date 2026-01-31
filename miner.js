import { basecampFetch, basecampFetchAll } from "./basecamp.js";
import {
  indexSearchItem,
  upsertEntityCache,
  getMineState,
  setMineState,
} from "./db.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dockFind(dock, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) {
    const hit = (dock || []).find((d) => d?.name === n && d?.enabled !== false);
    if (hit) return hit;
  }
  return null;
}

async function safeFetchAll(token, accountId, path, { ua, delayMs } = {}) {
  try {
    const data = await basecampFetchAll(token, path, { accountId, ua });
    if (delayMs) await sleep(delayMs);
    return data;
  } catch (e) {
    return { _error: e?.message || String(e) };
  }
}

async function safeFetch(token, accountId, path, { ua, delayMs } = {}) {
  try {
    const data = await basecampFetch(token, path, { accountId, ua });
    if (delayMs) await sleep(delayMs);
    return data;
  } catch (e) {
    return { _error: e?.message || String(e) };
  }
}

function trackEntity(type, object, { projectId, titleKey = "title", userKey = null } = {}) {
  if (!object || object.id == null) return;
  const title = object[titleKey] || object.name || object.subject || null;
  upsertEntityCache(type, object.id, { projectId, title, data: object, userKey });
  if (title || object.content) {
    indexSearchItem(type, object.id, {
      projectId,
      title: title || "",
      content: object.content || object.description || "",
      url: object.app_url || object.url || null,
      userKey,
    });
  }
}

function projectMineKey(projectId) {
  return `project:${projectId}:last_mined`;
}

export async function runMining({
  token,
  accountId,
  ua = "bcgpt-full-v3",
  delayMs = 150,
  projectsPerRun = 4,
  projectMinIntervalSec = 1800,
  userKey = null,
} = {}) {
  const summary = {
    started_at: new Date().toISOString(),
    projects_mined: 0,
    errors: [],
  };

  if (!token?.access_token || !accountId) {
    summary.errors.push("Not authenticated or missing accountId.");
    return summary;
  }

  const projects = await safeFetchAll(token, accountId, "/projects.json?per_page=100", { ua, delayMs });
  if (Array.isArray(projects)) {
    for (const p of projects) {
      trackEntity("project", p, { projectId: p.id, titleKey: "name", userKey });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const candidates = Array.isArray(projects) ? projects : [];
  const scored = candidates.map((p) => {
    const state = getMineState(projectMineKey(p.id), { userKey });
    const last = state?.updated_at || 0;
    return { project: p, last };
  });
  scored.sort((a, b) => a.last - b.last);
  const toMine = scored.filter((item) => now - item.last > projectMinIntervalSec).slice(0, projectsPerRun);

  const allChats = await safeFetchAll(token, accountId, "/chats.json", { ua, delayMs });
  if (Array.isArray(allChats)) {
    for (const chat of allChats) {
      trackEntity("campfire", chat, { projectId: chat?.bucket?.id, titleKey: "title", userKey });
    }
  }

  const people = await safeFetchAll(token, accountId, "/people.json", { ua, delayMs });
  if (Array.isArray(people)) {
    for (const person of people) trackEntity("person", person, { projectId: null, titleKey: "name", userKey });
  }

  for (const entry of toMine) {
    const project = entry.project;
    const projectId = project.id;

    const detail = await safeFetch(token, accountId, `/projects/${projectId}.json`, { ua, delayMs });
    if (detail && !detail._error) {
      trackEntity("project_detail", detail, { projectId, titleKey: "name", userKey });
      const dock = detail.dock || [];
      for (const d of dock) {
        if (!d?.id) continue;
        upsertEntityCache("dock_tool", d.id, { projectId, title: d.name, data: d, userKey });
      }

      const todosDock = dockFind(dock, ["todoset", "todos", "todo_set"]);
      if (todosDock?.url) {
        const todoset = await safeFetch(token, accountId, todosDock.url, { ua, delayMs });
        const todolistsUrl = todoset?.todolists_url;
        if (todolistsUrl) {
          const lists = await safeFetchAll(token, accountId, todolistsUrl, { ua, delayMs });
          if (Array.isArray(lists)) {
            for (const list of lists) trackEntity("todolist", list, { projectId, titleKey: "name", userKey });
          }
        }
      }

      const mbDock = dockFind(dock, ["message_board", "message_boards"]);
      if (mbDock?.url) {
        const boards = await safeFetchAll(token, accountId, mbDock.url, { ua, delayMs });
        if (Array.isArray(boards)) {
          for (const board of boards) trackEntity("message_board", board, { projectId, titleKey: "title", userKey });
        }
      }

      const scheduleDock = dockFind(dock, ["schedule", "schedules"]);
      if (scheduleDock?.url) {
        const schedule = await safeFetch(token, accountId, scheduleDock.url, { ua, delayMs });
        if (schedule && !schedule._error) trackEntity("schedule", schedule, { projectId, titleKey: "name", userKey });
      }

      const vaultDock = dockFind(dock, ["vault", "documents", "vaults"]);
      if (vaultDock?.url) {
        const vault = await safeFetch(token, accountId, vaultDock.url, { ua, delayMs });
        if (vault && !vault._error) trackEntity("vault", vault, { projectId, titleKey: "name", userKey });
      }
    }

    const cardTables = await safeFetchAll(token, accountId, `/buckets/${projectId}/card_tables.json`, { ua, delayMs });
    if (Array.isArray(cardTables)) {
      for (const table of cardTables) trackEntity("card_table", table, { projectId, titleKey: "title", userKey });
    }

    const webhooks = await safeFetchAll(token, accountId, `/buckets/${projectId}/webhooks.json`, { ua, delayMs });
    if (Array.isArray(webhooks)) {
      for (const hook of webhooks) trackEntity("webhook", hook, { projectId, titleKey: "name", userKey });
    }

    const correspondences = await safeFetchAll(token, accountId, `/buckets/${projectId}/client/correspondences.json`, { ua, delayMs });
    if (Array.isArray(correspondences)) {
      for (const item of correspondences) {
        trackEntity("client_correspondence", item, { projectId, titleKey: "subject", userKey });
      }
    }

    const approvals = await safeFetchAll(token, accountId, `/buckets/${projectId}/client/approvals.json`, { ua, delayMs });
    if (Array.isArray(approvals)) {
      for (const item of approvals) trackEntity("client_approval", item, { projectId, titleKey: "subject", userKey });
    }

    setMineState(projectMineKey(projectId), "ok", { userKey });
    summary.projects_mined += 1;
  }

  summary.completed_at = new Date().toISOString();
  return summary;
}
