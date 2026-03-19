function todoText(todo) {
  return String(todo?.content || todo?.title || todo?.name || "").trim();
}

function normalizedIntentText(value) {
  return String(value || "").toLowerCase().trim();
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAssignedToMeIntent(raw) {
  const s = normalizedIntentText(raw);
  return (
    /\bassigned to me\b/.test(s) ||
    /\bmy todos\b/.test(s) ||
    /\bmy tasks\b/.test(s) ||
    /\bwhat do i need to do\b/.test(s) ||
    /\bwhat(?:'s| is) on my plate\b/.test(s) ||
    /\bmy\b.*\b(assigned|todo|todos|task|tasks)\b/.test(s) ||
    /\b(assigned|todo|todos|task|tasks)\b.*\b(to me|for me|mine)\b/.test(s)
  );
}

export function wantsAssignedTodoDetails(raw) {
  const s = normalizedIntentText(raw);
  if (!isAssignedToMeIntent(s)) {
    return false;
  }
  return (
    /\b(detail|details|detailed|full|fully|expanded|expand|everything|complete|verbose)\b/.test(s) ||
    /\b(all|full)\b.*\b(details?|info|information)\b/.test(s) ||
    /\binclude\b.*\b(details?|description|descriptions|notes?|comments?)\b/.test(s) ||
    /\b(show|get|give|list|open)\b.*\b(details?|description|descriptions|notes?|comments?)\b/.test(s) ||
    /\bwhat does\b.*\b(todo|todos|task|tasks)\b.*\bmean\b/.test(s)
  );
}

export function resolveAssignedTodoListOptions({ query, include_details, compact, preview_limit } = {}) {
  const wantsDetails = include_details === true || wantsAssignedTodoDetails(query);
  const parsedPreviewLimit = Number(preview_limit);

  return {
    include_details: wantsDetails,
    compact: typeof compact === "boolean" ? compact : !wantsDetails,
    preview_limit: Number.isFinite(parsedPreviewLimit) ? parsedPreviewLimit : (wantsDetails ? 25 : undefined),
  };
}

export function normalizeTodoAssigneeIds(todo) {
  if (!todo) return [];
  if (Array.isArray(todo.assignee_ids)) {
    return todo.assignee_ids.map((value) => Number(value)).filter(Number.isFinite);
  }
  if (Array.isArray(todo.assigneeIds)) {
    return todo.assigneeIds.map((value) => Number(value)).filter(Number.isFinite);
  }
  if (Array.isArray(todo.assignees)) {
    return todo.assignees.map((entry) => Number(entry?.id ?? entry)).filter(Number.isFinite);
  }
  if (todo.assignee_id != null) {
    const id = Number(todo.assignee_id);
    return Number.isFinite(id) ? [id] : [];
  }
  return [];
}

export function normalizeTodoProject(todo) {
  if (!todo) return null;
  const bucket = isPlainObject(todo.bucket)
    ? todo.bucket
    : isPlainObject(todo.project)
      ? todo.project
      : null;
  if (bucket) {
    return {
      id: bucket.id ?? todo.projectId ?? todo.project_id ?? null,
      name: bucket.name ?? todo.projectName ?? todo.project_name ?? null,
    };
  }
  const projectName =
    typeof todo.project === "string"
      ? todo.project
      : todo.projectName ?? todo.project_name ?? null;
  const projectId = todo.projectId ?? todo.project_id ?? null;
  if (projectId != null || projectName != null) {
    return {
      id: projectId ?? null,
      name: projectName ?? null,
    };
  }
  return null;
}

export function compactAssignmentTodo(todo) {
  if (!todo) return null;
  const title = todo.title || todo.content || todoText(todo);
  const completed = Boolean(todo.completed || todo.completed_at);
  const project = normalizeTodoProject(todo);
  const assigneeIds = normalizeTodoAssigneeIds(todo);

  return {
    id: todo.id ?? todo.todo_id ?? todo.todoId ?? todo.recording_id ?? null,
    title: title || null,
    status: todo.status ?? (completed ? "completed" : "open"),
    completed,
    due_on: todo.due_on ?? todo.due_at ?? todo.dueOn ?? null,
    project,
    assignee_ids: assigneeIds.length ? assigneeIds : null,
    app_url: todo.app_url ?? todo.appUrl ?? todo.url ?? null,
  };
}

export function hydrateSnapshotAssignmentTodo(todo, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!todo || typeof todo !== "object") return null;
  const dueOn = todo.dueOn ?? todo.due_on ?? todo.due_at ?? null;
  const project = normalizeTodoProject(todo);
  const todolist =
    todo.todolistId != null || todo.todolistName != null
      ? {
          id: todo.todolistId ?? null,
          name: todo.todolistName ?? null,
        }
      : null;

  return {
    id: todo.todoId ?? todo.id ?? todo.todo_id ?? todo.recording_id ?? null,
    title: todo.title ?? todo.content ?? todo.name ?? null,
    status: todo.status ?? "open",
    completed: Boolean(todo.completed || todo.completed_at),
    due_on: dueOn,
    overdue: Boolean(dueOn && dueOn < todayIso),
    project,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    todolist,
    assignee_ids: normalizeTodoAssigneeIds(todo),
    app_url: todo.appUrl ?? todo.app_url ?? todo.url ?? null,
  };
}

export function hydrateScannedTodoRow(row) {
  if (!row || typeof row !== "object") return null;
  const raw = isPlainObject(row.raw) ? row.raw : {};
  const fallbackProject =
    row.projectId != null || row.project != null
      ? {
          id: row.projectId ?? null,
          name: typeof row.project === "string" ? row.project : row.projectName ?? null,
        }
      : null;
  const project = normalizeTodoProject(raw) ?? fallbackProject;
  const todolist =
    row.todolistId != null || row.todolist != null
      ? {
          id: row.todolistId ?? null,
          name: typeof row.todolist === "string" ? row.todolist : null,
        }
      : null;

  return {
    ...raw,
    id: raw.id ?? raw.todo_id ?? raw.todoId ?? row.todoId ?? raw.recording_id ?? null,
    title: raw.title ?? raw.content ?? row.content ?? raw.name ?? null,
    status: raw.status ?? "open",
    completed: Boolean(raw.completed || raw.completed_at),
    due_on: raw.due_on ?? raw.due_at ?? raw.dueOn ?? row.due_on ?? null,
    project,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    todolist,
    assignee_ids: normalizeTodoAssigneeIds(raw),
    app_url: raw.app_url ?? raw.appUrl ?? raw.url ?? row.url ?? row.app_url ?? row.appUrl ?? null,
  };
}

export function scanAssignedTodosFromRows(rows, personId) {
  const targetId = Number(personId);
  if (!Number.isFinite(targetId)) {
    return [];
  }
  return (Array.isArray(rows) ? rows : [])
    .map(hydrateScannedTodoRow)
    .filter((todo) => todo && normalizeTodoAssigneeIds(todo).includes(targetId));
}

export function scanAssignedTodosFromSnapshot(snapshotTodos, personId, todayIso = new Date().toISOString().slice(0, 10)) {
  const targetId = Number(personId);
  if (!Number.isFinite(targetId)) {
    return [];
  }
  return (Array.isArray(snapshotTodos) ? snapshotTodos : [])
    .map((todo) => hydrateSnapshotAssignmentTodo(todo, todayIso))
    .filter((todo) => todo && normalizeTodoAssigneeIds(todo).includes(targetId));
}

export function scanOverdueTodosFromRows(rows, todayIso = new Date().toISOString().slice(0, 10)) {
  return (Array.isArray(rows) ? rows : [])
    .map(hydrateScannedTodoRow)
    .filter((todo) => todo && !todo.completed && todo.due_on && todo.due_on < todayIso);
}

export function buildAssignedPeopleSummary(rows, people = [], todayIso = new Date().toISOString().slice(0, 10)) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const todo = hydrateScannedTodoRow(row);
    if (!todo) continue;
    const assigneeIds = normalizeTodoAssigneeIds(todo);
    if (!assigneeIds.length) continue;
    for (const assigneeId of assigneeIds) {
      const entry = groups.get(assigneeId) || {
        id: assigneeId,
        assigned_todos_count: 0,
        overdue_count: 0,
        due_today_count: 0,
        project_ids: new Set(),
        todos_preview: [],
      };
      entry.assigned_todos_count += 1;
      if (todo.due_on) {
        if (todo.due_on < todayIso) entry.overdue_count += 1;
        if (todo.due_on === todayIso) entry.due_today_count += 1;
      }
      if (todo.project?.id != null) {
        entry.project_ids.add(String(todo.project.id));
      }
      if (entry.todos_preview.length < 5) {
        const preview = compactAssignmentTodo(todo);
        if (preview) entry.todos_preview.push(preview);
      }
      groups.set(assigneeId, entry);
    }
  }

  const peopleById = new Map(
    (Array.isArray(people) ? people : [])
      .map((person) => [Number(person?.id), person])
      .filter(([id]) => Number.isFinite(id)),
  );

  return [...groups.values()]
    .map((entry) => {
      const person = peopleById.get(entry.id) || null;
      return {
        ...(person || {}),
        id: entry.id,
        name: person?.name ?? `Person ${entry.id}`,
        email: person?.email ?? person?.email_address ?? null,
        title: person?.title ?? null,
        avatar_url: person?.avatar_url ?? null,
        assigned_todos_count: entry.assigned_todos_count,
        overdue_count: entry.overdue_count,
        due_today_count: entry.due_today_count,
        projects_count: entry.project_ids.size,
        project_ids: [...entry.project_ids],
        todos_preview: entry.todos_preview,
      };
    })
    .sort(
      (a, b) =>
        (b.assigned_todos_count - a.assigned_todos_count) ||
        (b.overdue_count - a.overdue_count) ||
        String(a.name || "").localeCompare(String(b.name || "")),
    );
}
