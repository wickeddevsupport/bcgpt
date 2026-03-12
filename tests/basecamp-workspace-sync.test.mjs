import test from "node:test";
import assert from "node:assert/strict";

import { buildWorkspaceTodoSnapshot } from "../basecamp-workspace-snapshot.js";

test("buildWorkspaceTodoSnapshot classifies workspace todos into consistent buckets", () => {
  const snapshot = buildWorkspaceTodoSnapshot({
    userKey: "email:rohit@wickedwebsites.us",
    accountId: "5282924",
    fetchedAt: Math.floor(new Date("2026-03-12T12:00:00Z").getTime() / 1000),
    identity: { id: 38176762, name: "Rohit", email: "rohit@wickedwebsites.us" },
    projects: [
      {
        id: 27009821,
        name: "Rohit's ToDo's",
        status: "active",
        app_url: "https://3.basecamp.com/5282924/buckets/27009821/projects/27009821",
        todoListsCount: 26,
      },
    ],
    todos: [
      {
        todoId: "1",
        projectId: "27009821",
        projectName: "Rohit's ToDo's",
        todolistId: "11",
        todolistName: "Urgent",
        title: "Past due item",
        status: "active",
        dueOn: "2026-03-11",
        appUrl: "https://3.basecamp.com/5282924/buckets/27009821/todos/1",
        assigneeIds: [38176762],
        assignedToCurrentUser: true,
        sourceUpdatedAt: null,
      },
      {
        todoId: "2",
        projectId: "27009821",
        projectName: "Rohit's ToDo's",
        todolistId: "11",
        todolistName: "Urgent",
        title: "Due today item",
        status: "active",
        dueOn: "2026-03-12",
        appUrl: "https://3.basecamp.com/5282924/buckets/27009821/todos/2",
        assigneeIds: [],
        assignedToCurrentUser: false,
        sourceUpdatedAt: null,
      },
      {
        todoId: "3",
        projectId: "27009821",
        projectName: "Rohit's ToDo's",
        todolistId: "11",
        todolistName: "Urgent",
        title: "Future item",
        status: "active",
        dueOn: "2026-03-13",
        appUrl: "https://3.basecamp.com/5282924/buckets/27009821/todos/3",
        assigneeIds: [38176762],
        assignedToCurrentUser: true,
        sourceUpdatedAt: null,
      },
      {
        todoId: "4",
        projectId: "27009821",
        projectName: "Rohit's ToDo's",
        todolistId: "12",
        todolistName: "Backlog",
        title: "No date item",
        status: "active",
        dueOn: null,
        appUrl: "https://3.basecamp.com/5282924/buckets/27009821/todos/4",
        assigneeIds: [],
        assignedToCurrentUser: false,
        sourceUpdatedAt: null,
      },
    ],
    previewLimit: 20,
    projectPreviewLimit: 4,
  });

  assert.equal(snapshot.totals.projectCount, 1);
  assert.equal(snapshot.totals.openTodos, 4);
  assert.equal(snapshot.totals.assignedTodos, 2);
  assert.equal(snapshot.totals.overdueTodos, 1);
  assert.equal(snapshot.totals.dueTodayTodos, 1);
  assert.equal(snapshot.totals.futureTodos, 1);
  assert.equal(snapshot.totals.noDueDateTodos, 1);
  assert.equal(snapshot.projects[0]?.todoListsCount, 26);
  assert.equal(snapshot.projects[0]?.health, "at_risk");
  assert.equal(snapshot.projects[0]?.assignedTodosCount, 2);
  assert.equal(snapshot.assignedTodos[0]?.title, "Past due item");
  assert.equal(snapshot.urgentTodos[0]?.title, "Past due item");
  assert.equal(snapshot.dueTodayTodos[0]?.title, "Due today item");
  assert.equal(snapshot.futureTodos[0]?.title, "Future item");
  assert.equal(snapshot.noDueDateTodos[0]?.title, "No date item");
});
