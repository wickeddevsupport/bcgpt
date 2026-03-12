function classifyDueBucket(dueOn, todayIso) {
  if (!dueOn) return "none";
  if (dueOn < todayIso) return "past";
  if (dueOn > todayIso) return "future";
  return "today";
}

function sortTodos(items, todayIso) {
  const rank = (todo) => {
    switch (classifyDueBucket(todo.dueOn, todayIso)) {
      case "past":
        return 0;
      case "today":
        return 1;
      case "future":
        return 2;
      default:
        return 3;
    }
  };
  return [...items].sort((a, b) => {
    const delta = rank(a) - rank(b);
    if (delta !== 0) return delta;
    if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) {
      return a.dueOn.localeCompare(b.dueOn);
    }
    if ((a.projectName || "") !== (b.projectName || "")) {
      return (a.projectName || "").localeCompare(b.projectName || "");
    }
    return a.title.localeCompare(b.title);
  });
}

export function buildWorkspaceTodoSnapshot({
  userKey,
  accountId,
  fetchedAt,
  identity = null,
  projects = [],
  todos = [],
  previewLimit = 20,
  projectPreviewLimit = 4,
  syncState = null,
}) {
  const todayIso = new Date(fetchedAt * 1000).toISOString().slice(0, 10);
  const projectMap = new Map(
    projects.map((project) => [
      String(project.id),
      {
        projectId: String(project.id),
        name: project.name,
        status: project.status ?? "active",
        appUrl: project.app_url ?? project.url ?? null,
        todoListsCount: Number(project.todoListsCount ?? project.todo_lists_count ?? 0),
        openTodosCount: 0,
        assignedTodosCount: 0,
        overdueTodosCount: 0,
        dueTodayTodosCount: 0,
        futureTodosCount: 0,
        noDueDateTodosCount: 0,
        nextDueOn: null,
        health: "quiet",
        previewTodos: [],
        sourceUpdatedAt: project.sourceUpdatedAt ?? null,
      },
    ]),
  );

  const assigned = [];
  const overdue = [];
  const dueToday = [];
  const future = [];
  const noDueDate = [];

  for (const todo of todos) {
    const projectId = todo.projectId ? String(todo.projectId) : null;
    const projectEntry =
      (projectId ? projectMap.get(projectId) : null) ??
      (projectId
        ? (() => {
            const entry = {
              projectId,
              name: todo.projectName ?? `Project ${projectId}`,
              status: "active",
              appUrl: null,
              todoListsCount: 0,
              openTodosCount: 0,
              assignedTodosCount: 0,
              overdueTodosCount: 0,
              dueTodayTodosCount: 0,
              futureTodosCount: 0,
              noDueDateTodosCount: 0,
              nextDueOn: null,
              health: "quiet",
              previewTodos: [],
              sourceUpdatedAt: todo.sourceUpdatedAt ?? null,
            };
            projectMap.set(projectId, entry);
            return entry;
          })()
        : null);

    if (projectEntry) {
      projectEntry.openTodosCount += 1;
      if (todo.assignedToCurrentUser) projectEntry.assignedTodosCount += 1;
      const dueBucket = classifyDueBucket(todo.dueOn, todayIso);
      if (dueBucket === "past") projectEntry.overdueTodosCount += 1;
      if (dueBucket === "today") projectEntry.dueTodayTodosCount += 1;
      if (dueBucket === "future") projectEntry.futureTodosCount += 1;
      if (dueBucket === "none") projectEntry.noDueDateTodosCount += 1;
      if (todo.dueOn && (!projectEntry.nextDueOn || todo.dueOn < projectEntry.nextDueOn)) {
        projectEntry.nextDueOn = todo.dueOn;
      }
      if (projectEntry.previewTodos.length < projectPreviewLimit) {
        projectEntry.previewTodos.push({
          id: todo.todoId,
          title: todo.title,
          dueOn: todo.dueOn,
          appUrl: todo.appUrl,
        });
      }
    }

    if (todo.assignedToCurrentUser) assigned.push(todo);
    const bucket = classifyDueBucket(todo.dueOn, todayIso);
    if (bucket === "past") overdue.push(todo);
    if (bucket === "today") dueToday.push(todo);
    if (bucket === "future") future.push(todo);
    if (bucket === "none") noDueDate.push(todo);
  }

  const projectCards = Array.from(projectMap.values()).map((project) => {
    if (project.overdueTodosCount > 0) project.health = "at_risk";
    else if (project.dueTodayTodosCount > 0 || project.openTodosCount >= 12) project.health = "attention";
    else if (project.openTodosCount === 0) project.health = "quiet";
    else project.health = "on_track";
    return project;
  }).sort((a, b) => {
    if (b.overdueTodosCount !== a.overdueTodosCount) return b.overdueTodosCount - a.overdueTodosCount;
    if (b.dueTodayTodosCount !== a.dueTodayTodosCount) return b.dueTodayTodosCount - a.dueTodayTodosCount;
    if (b.openTodosCount !== a.openTodosCount) return b.openTodosCount - a.openTodosCount;
    return a.name.localeCompare(b.name);
  });

  const sortAndTrim = (items) => sortTodos(items, todayIso).slice(0, previewLimit);

  return {
    userKey,
    accountId,
    fetchedAt,
    identity,
    syncState,
    totals: {
      projectCount: projectCards.length,
      syncedProjects: projectCards.length,
      openTodos: todos.length,
      assignedTodos: assigned.length,
      overdueTodos: overdue.length,
      dueTodayTodos: dueToday.length,
      futureTodos: future.length,
      noDueDateTodos: noDueDate.length,
    },
    projects: projectCards,
    assignedTodos: sortAndTrim(assigned),
    urgentTodos: sortAndTrim(overdue),
    dueTodayTodos: sortAndTrim(dueToday),
    futureTodos: sortAndTrim(future),
    noDueDateTodos: sortAndTrim(noDueDate),
  };
}
