import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAssignedPeopleSummary,
  compactAssignmentTodo,
  hydrateScannedTodoRow,
  scanAssignedTodosFromRows,
} from "../mcp/basecamp-assignment-utils.js";

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const YESTERDAY_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function buildRows() {
  return [
    {
      project: "Alpha Project",
      projectId: 1,
      todolist: "Alpha Internal",
      todolistId: 111,
      todoId: 1001,
      content: "PM Thread",
      due_on: null,
      url: "https://3.basecamp.com/5282924/buckets/1/todos/1001",
      raw: {
        id: 1001,
        title: "PM Thread",
        assignee_ids: [101],
        app_url: "https://3.basecamp.com/5282924/buckets/1/todos/1001",
      },
    },
    {
      project: "Alpha Project",
      projectId: 1,
      todolist: "Alpha Internal",
      todolistId: 111,
      todoId: 1002,
      content: "QA Review",
      due_on: TODAY_ISO,
      url: "https://3.basecamp.com/5282924/buckets/1/todos/1002",
      raw: {
        id: 1002,
        title: "QA Review",
        assignee_ids: [101, 202],
        due_on: TODAY_ISO,
        app_url: "https://3.basecamp.com/5282924/buckets/1/todos/1002",
      },
    },
    {
      project: "Beta Project",
      projectId: 2,
      todolist: "Beta Internal",
      todolistId: 222,
      todoId: 2001,
      content: "Design Polish",
      due_on: YESTERDAY_ISO,
      url: "https://3.basecamp.com/5282924/buckets/2/todos/2001",
      raw: {
        id: 2001,
        title: "Design Polish",
        assignee_ids: [202],
        due_on: YESTERDAY_ISO,
        app_url: "https://3.basecamp.com/5282924/buckets/2/todos/2001",
      },
    },
    {
      project: "Beta Project",
      projectId: 2,
      todolist: "Beta Internal",
      todolistId: 222,
      todoId: 2002,
      content: "Owner Follow-up",
      due_on: null,
      url: "https://3.basecamp.com/5282924/buckets/2/todos/2002",
      raw: {
        id: 2002,
        title: "Owner Follow-up",
        assignee_ids: [101],
        app_url: "https://3.basecamp.com/5282924/buckets/2/todos/2002",
      },
    },
  ];
}

test("hydrateScannedTodoRow preserves ids, project context, and assignees", () => {
  const todo = hydrateScannedTodoRow(buildRows()[0]);

  assert.equal(todo.id, 1001);
  assert.equal(todo.title, "PM Thread");
  assert.deepEqual(todo.project, { id: 1, name: "Alpha Project" });
  assert.deepEqual(todo.todolist, { id: 111, name: "Alpha Internal" });
  assert.deepEqual(todo.assignee_ids, [101]);
});

test("scanAssignedTodosFromRows returns the current user's real assignments", () => {
  const todos = scanAssignedTodosFromRows(buildRows(), 101);

  assert.deepEqual(
    todos.map((todo) => todo.id).sort(),
    [1001, 1002, 2002],
  );
  assert.equal(todos.find((todo) => todo.id === 2002)?.project?.name, "Beta Project");
});

test("buildAssignedPeopleSummary groups open todos by assignee with counts and previews", () => {
  const people = [
    { id: 101, name: "Rohit M.", email: "rohit@wickedwebsites.us", title: "CEO" },
    { id: 202, name: "Designer", email: "designer@example.com", title: "UI Designer" },
  ];

  const summary = buildAssignedPeopleSummary(buildRows(), people, TODAY_ISO);
  const rohit = summary.find((person) => person.id === 101);
  const designer = summary.find((person) => person.id === 202);

  assert.ok(rohit);
  assert.ok(designer);
  assert.equal(rohit.assigned_todos_count, 3);
  assert.equal(designer.assigned_todos_count, 2);
  assert.equal(designer.overdue_count, 1);
  assert.equal(rohit.todos_preview[0]?.project?.name, "Alpha Project");
});

test("compactAssignmentTodo keeps ids and project names for snapshot-style todo objects", () => {
  const compact = compactAssignmentTodo({
    todoId: "3001",
    title: "Snapshot task",
    dueOn: TODAY_ISO,
    projectId: "88",
    projectName: "Snapshot Project",
    appUrl: "https://3.basecamp.com/5282924/buckets/88/todos/3001",
    assigneeIds: [101],
  });

  assert.equal(compact.id, "3001");
  assert.equal(compact.project?.id, "88");
  assert.equal(compact.project?.name, "Snapshot Project");
  assert.equal(compact.due_on, TODAY_ISO);
  assert.equal(compact.app_url, "https://3.basecamp.com/5282924/buckets/88/todos/3001");
  assert.deepEqual(compact.assignee_ids, [101]);
});
