export type BasecampChatUrlHints = {
  basecampUrl: string | null;
  basecampAccountId: string | null;
  basecampBucketId: string | null;
  basecampCardId: string | null;
  basecampRecordingId: string | null;
  basecampCardPath: string | null;
};

type BasecampDateHint = {
  isoDate: string | null;
  label: string | null;
};

type BasecampProjectRoute =
  | "project_todolists"
  | "project_todos"
  | "project_people"
  | "project_schedule"
  | "project_messages"
  | "project_cards"
  | "project_documents"
  | "project_summary";

export type DirectBasecampChatShortcut =
  | {
      kind: "inspect_url";
      toolName: "smart_action";
      toolArgs: { query: string };
    }
  | {
      kind: "workspace_snapshot";
      toolName: "workspace_todo_snapshot";
      toolArgs: { preview_limit: number; project_preview_limit: number };
    }
  | {
      kind: "project_list";
      toolName: "list_projects";
      toolArgs: Record<string, never>;
    }
  | {
      kind: "assigned";
      toolName: "list_assigned_to_me";
      toolArgs: { project?: string };
      filter: "all" | "overdue" | "date";
      filterDate: string | null;
      filterLabel: string | null;
      projectName: string | null;
    }
  | {
      kind: "due_date";
      toolName: "list_todos_due";
      toolArgs: { date: string; include_overdue: boolean; project?: string };
      filterDate: string;
      filterLabel: string | null;
      projectName: string | null;
    }
  | {
      kind: "overdue";
      toolName: "report_todos_overdue" | "list_todos_due";
      toolArgs:
        | Record<string, never>
        | { date: string; include_overdue: boolean; project: string };
      projectName: string | null;
      anchorDate: string;
    }
  | {
      kind: BasecampProjectRoute;
      toolName:
        | "list_todolists"
        | "list_todos_for_project"
        | "list_project_people"
        | "list_schedule_entries"
        | "list_messages"
        | "list_card_tables"
        | "list_documents"
        | "smart_action";
      toolArgs:
        | { project: string }
        | { project: string; compact: boolean; preview_limit: number }
        | { query: string; project: string };
      projectName: string;
    };

function isoFromDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(now: Date, days: number): string {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + days);
  return isoFromDate(next);
}

export function parseBasecampDateHint(message: string, now = new Date()): BasecampDateHint {
  const lower = message.toLowerCase();
  if (/\btoday\b/.test(lower)) {
    return { isoDate: isoFromDate(now), label: "today" };
  }
  if (/\btomorrow\b/.test(lower)) {
    return { isoDate: addDays(now, 1), label: "tomorrow" };
  }
  if (/\byesterday\b/.test(lower)) {
    return { isoDate: addDays(now, -1), label: "yesterday" };
  }

  const isoMatch = message.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch?.[0]) {
    return { isoDate: isoMatch[0], label: isoMatch[0] };
  }

  const naturalMatch = message.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*\d{4})?\b/i,
  );
  if (naturalMatch?.[0]) {
    const parsed = new Date(naturalMatch[0]);
    if (!Number.isNaN(parsed.getTime())) {
      return { isoDate: isoFromDate(parsed), label: naturalMatch[0] };
    }
  }

  return { isoDate: null, label: null };
}

export function extractExplicitProjectName(message: string): string | null {
  const quoted = message.match(/["“”]([^"“”\n]{2,120})["“”]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const patterns = [
    /\bproject\s+(?:named|called)\s+([^?.!,\n]+)/i,
    /\b(?:in|for|on)\s+project\s+([^?.!,\n]+)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value.replace(/^["“']|["”']$/g, "").trim();
    }
  }

  return null;
}

function inferProjectRoute(message: string, projectName: string): DirectBasecampChatShortcut | null {
  const lower = message.toLowerCase();
  if (/\b(todo lists?|todolists?)\b/.test(lower)) {
    return {
      kind: "project_todolists",
      toolName: "list_todolists",
      toolArgs: { project: projectName },
      projectName,
    };
  }
  if (/\b(who is on|team|people)\b/.test(lower)) {
    return {
      kind: "project_people",
      toolName: "list_project_people",
      toolArgs: { project: projectName },
      projectName,
    };
  }
  if (/\b(schedule|calendar|upcoming|events?)\b/.test(lower)) {
    return {
      kind: "project_schedule",
      toolName: "list_schedule_entries",
      toolArgs: { project: projectName },
      projectName,
    };
  }
  if (/\b(messages?|message board|announcements?|posts?|updates?)\b/.test(lower)) {
    return {
      kind: "project_messages",
      toolName: "list_messages",
      toolArgs: { project: projectName },
      projectName,
    };
  }
  if (/\b(cards?|kanban|board|card table|columns?)\b/.test(lower)) {
    return {
      kind: "project_cards",
      toolName: "list_card_tables",
      toolArgs: { project: projectName },
      projectName,
    };
  }
  if (/\b(docs?|documents?|files?|vault)\b/.test(lower)) {
    return {
      kind: "project_documents",
      toolName: "list_documents",
      toolArgs: { project: projectName },
      projectName,
    };
  }
  if (
    /\b(open todos?|open tasks?|todos? in|tasks? in|show todos?|show tasks?|how many open todos?)\b/.test(
      lower,
    )
  ) {
    return {
      kind: "project_todos",
      toolName: "list_todos_for_project",
      toolArgs: { project: projectName, compact: true, preview_limit: 12 },
      projectName,
    };
  }
  if (/\b(summary|summarize|overview|status|health|blockers?)\b/.test(lower)) {
    return {
      kind: "project_summary",
      toolName: "smart_action",
      toolArgs: { query: message.trim(), project: projectName },
      projectName,
    };
  }
  return null;
}

export function inferDirectBasecampChatShortcut(
  message: string,
  urlHints: BasecampChatUrlHints,
  now = new Date(),
): DirectBasecampChatShortcut | null {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  if (urlHints.basecampUrl) {
    return {
      kind: "inspect_url",
      toolName: "smart_action",
      toolArgs: { query: trimmed },
    };
  }

  const lower = trimmed.toLowerCase();
  const todayIso = isoFromDate(now);
  const projectName = extractExplicitProjectName(trimmed);
  const dateHint = parseBasecampDateHint(trimmed, now);
  const asksForAssignedWork =
    /\bassigned to me\b/.test(lower) ||
    /\bmy todos\b/.test(lower) ||
    /\bmy tasks\b/.test(lower) ||
    /\bmy\b[\s\w-]{0,20}\b(todo|task)s?\b/.test(lower) ||
    /\bmy day\b/.test(lower) ||
    /\bwhat do i need to do\b/.test(lower) ||
    /\bwhat should i focus on\b/.test(lower) ||
    /\bwhat should i do today\b/.test(lower) ||
    /\bwhat am i responsible for\b/.test(lower) ||
    /\bwhat is on my plate\b/.test(lower);

  if (projectName) {
    const projectRoute = inferProjectRoute(trimmed, projectName);
    if (projectRoute) {
      return projectRoute;
    }
  }

  if (
    !projectName &&
    /\b(list|show|get|what|which|give|display)\b[\s\w-]{0,40}\bprojects?\b|\bmy projects?\b|\bprojects?\b[\s\w-]{0,30}\b(names?|ids?|list)\b/i.test(
      trimmed,
    ) &&
    !/\b(find|search|lookup|about|summary|summarize|todo lists?|todolists?|people|team|schedule|calendar|events?|attention|risk|health|status|blockers?)\b/i.test(
      lower,
    )
  ) {
    return {
      kind: "project_list",
      toolName: "list_projects",
      toolArgs: {},
    };
  }

  if (asksForAssignedWork) {
    return {
      kind: "assigned",
      toolName: "list_assigned_to_me",
      toolArgs: projectName ? { project: projectName } : {},
      filter: /\b(overdue|past due|late)\b/.test(lower)
        ? "overdue"
        : dateHint.isoDate
          ? "date"
          : "all",
      filterDate: dateHint.isoDate,
      filterLabel: dateHint.label,
      projectName,
    };
  }

  if (/\b(overdue|past due|late)\b/.test(lower) && /\b(todo|task)s?\b/.test(lower)) {
    if (projectName) {
      return {
        kind: "overdue",
        toolName: "list_todos_due",
        toolArgs: {
          date: todayIso,
          include_overdue: true,
          project: projectName,
        },
        projectName,
        anchorDate: todayIso,
      };
    }
    return {
      kind: "overdue",
      toolName: "report_todos_overdue",
      toolArgs: {},
      projectName: null,
      anchorDate: todayIso,
    };
  }

  if (dateHint.isoDate && (/\b(todo|task)s?\b/.test(lower) || /\bdue\b/.test(lower))) {
    return {
      kind: "due_date",
      toolName: "list_todos_due",
      toolArgs: {
        date: dateHint.isoDate,
        include_overdue: /\b(overdue|past due|late)\b/.test(lower),
        ...(projectName ? { project: projectName } : {}),
      },
      filterDate: dateHint.isoDate,
      filterLabel: dateHint.label,
      projectName,
    };
  }

  if (
    !projectName &&
    /\b(at a glance|overview|focus|brief(?:ing)?|pulse|dashboard|status|attention|at risk|risk|blockers?)\b/i.test(
      trimmed,
    ) &&
    /\b(today|day|workspace|basecamp|projects?|todos?|tasks?)\b/i.test(trimmed)
  ) {
    return {
      kind: "workspace_snapshot",
      toolName: "workspace_todo_snapshot",
      toolArgs: { preview_limit: 12, project_preview_limit: 3 },
    };
  }

  return null;
}
