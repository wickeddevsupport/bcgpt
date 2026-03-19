import assert from "node:assert/strict";
import test from "node:test";

import {
  extractExplicitProjectName,
  inferDirectBasecampChatShortcut,
  parseBasecampDateHint,
  type BasecampChatUrlHints,
} from "./basecamp-chat-shortcuts.js";

const NO_URLS: BasecampChatUrlHints = {
  basecampUrl: null,
  basecampAccountId: null,
  basecampBucketId: null,
  basecampCardId: null,
  basecampRecordingId: null,
  basecampCardPath: null,
};

test("parseBasecampDateHint resolves today and tomorrow from natural language", () => {
  const now = new Date("2026-03-19T12:00:00Z");

  assert.deepEqual(parseBasecampDateHint("what is due today?", now), {
    isoDate: "2026-03-19",
    label: "today",
  });
  assert.deepEqual(parseBasecampDateHint("what is due tomorrow?", now), {
    isoDate: "2026-03-20",
    label: "tomorrow",
  });
});

test("extractExplicitProjectName prefers quoted project names", () => {
  assert.equal(
    extractExplicitProjectName("show todo lists for \"Rohit's ToDo's\""),
    "Rohit's ToDo's",
  );
});

test("inferDirectBasecampChatShortcut routes my-day questions to assigned todos", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    "What do I need to do today in Basecamp?",
    NO_URLS,
    new Date("2026-03-19T12:00:00Z"),
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "assigned");
  assert.equal(shortcut?.toolName, "list_assigned_to_me");
  if (shortcut?.kind === "assigned") {
    assert.equal(shortcut.filter, "date");
    assert.equal(shortcut.filterDate, "2026-03-19");
  }
});

test("inferDirectBasecampChatShortcut routes overdue personal queues to assigned todos", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    "What are my overdue todos?",
    NO_URLS,
    new Date("2026-03-19T12:00:00Z"),
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "assigned");
  if (shortcut?.kind === "assigned") {
    assert.equal(shortcut.filter, "overdue");
  }
});

test("inferDirectBasecampChatShortcut routes focus prompts to assigned todos", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    "What should I focus on today in Basecamp?",
    NO_URLS,
    new Date("2026-03-19T12:00:00Z"),
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "assigned");
  if (shortcut?.kind === "assigned") {
    assert.equal(shortcut.filter, "date");
    assert.equal(shortcut.filterDate, "2026-03-19");
  }
});

test("inferDirectBasecampChatShortcut routes workspace due-date asks to list_todos_due", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    "What is due tomorrow in Basecamp?",
    NO_URLS,
    new Date("2026-03-19T12:00:00Z"),
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "due_date");
  assert.equal(shortcut?.toolName, "list_todos_due");
  if (shortcut?.kind === "due_date") {
    assert.equal(shortcut.filterDate, "2026-03-20");
  }
});

test("inferDirectBasecampChatShortcut routes quoted project todo-list requests directly", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    'Show todo lists for project "BCGPT TEST PROJECT"',
    NO_URLS,
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "project_todolists");
  assert.equal(shortcut?.toolName, "list_todolists");
  if (shortcut?.kind === "project_todolists") {
    assert.equal(shortcut.projectName, "BCGPT TEST PROJECT");
  }
});

test("inferDirectBasecampChatShortcut scopes project overdue asks", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    'Show overdue todos for project "BCGPT TEST PROJECT"',
    NO_URLS,
    new Date("2026-03-19T12:00:00Z"),
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "overdue");
  if (shortcut?.kind === "overdue") {
    assert.equal(shortcut.toolName, "list_todos_due");
    assert.equal(shortcut.projectName, "BCGPT TEST PROJECT");
  }
});

test("inferDirectBasecampChatShortcut routes project people requests directly", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    'Who is on project "BCGPT TEST PROJECT"?',
    NO_URLS,
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "project_people");
  assert.equal(shortcut?.toolName, "list_project_people");
});

test("inferDirectBasecampChatShortcut routes project attention asks to workspace snapshot", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    "Which Basecamp projects need attention right now?",
    NO_URLS,
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "workspace_snapshot");
  assert.equal(shortcut?.toolName, "workspace_todo_snapshot");
});

test("inferDirectBasecampChatShortcut routes pasted Basecamp URLs to smart_action", () => {
  const shortcut = inferDirectBasecampChatShortcut(
    "What does this todo mean? https://3.basecamp.com/5282924/buckets/45864540/card_tables/cards/9515058775#__recording_9654404048",
    {
      basecampUrl:
        "https://3.basecamp.com/5282924/buckets/45864540/card_tables/cards/9515058775#__recording_9654404048",
      basecampAccountId: "5282924",
      basecampBucketId: "45864540",
      basecampCardId: "9515058775",
      basecampRecordingId: "9654404048",
      basecampCardPath: "/buckets/45864540/card_tables/cards/9515058775",
    },
  );

  assert.ok(shortcut);
  assert.equal(shortcut?.kind, "inspect_url");
  assert.equal(shortcut?.toolName, "smart_action");
});
