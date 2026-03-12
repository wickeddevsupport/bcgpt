import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { ChatProps } from "./chat.ts";
import { renderChat } from "./chat.ts";
import type {
  PmosProjectCard,
  PmosProjectDetailTab,
  PmosProjectSectionResult,
  PmosProjectTodoItem,
  PmosProjectsSnapshot,
} from "../controllers/pmos-projects.ts";

export type ProjectViewMode = "cards" | "status-board" | "timeline";
export type CommandCenterTab = "overview" | "projects" | "timeline";

export type CommandCenterProps = {
  connected: boolean;
  loading: boolean;
  error: string | null;
  snapshot: PmosProjectsSnapshot | null;
  projectSearch: string;
  viewMode: ProjectViewMode;
  chatProps: ChatProps;
  selectedProject: PmosProjectCard | null;
  projectDetailTab: PmosProjectDetailTab;
  projectSectionData: Record<string, PmosProjectSectionResult>;
  onRefresh: () => void;
  onOpenIntegrations: () => void;
  onOpenWorkflows: () => void;
  onPrefillChat: (prompt: string) => void;
  onProjectSearchChange: (next: string) => void;
  onViewModeChange: (next: ProjectViewMode) => void;
  commandCenterTab: CommandCenterTab;
  onCommandCenterTabChange: (tab: CommandCenterTab) => void;
  onSelectProject: (project: PmosProjectCard | null) => void;
  onProjectDetailTabChange: (tab: PmosProjectDetailTab) => void;
  onLoadProjectSection: (projectName: string, section: PmosProjectDetailTab) => void;
};

function healthChipClass(health: PmosProjectCard["health"]) {
  switch (health) {
    case "at_risk":
      return "chip-danger";
    case "attention":
      return "chip-warn";
    case "quiet":
      return "chip";
    default:
      return "chip-ok";
  }
}

function healthLabel(health: PmosProjectCard["health"]) {
  switch (health) {
    case "at_risk":
      return "At risk";
    case "attention":
      return "Needs attention";
    case "quiet":
      return "Quiet";
    default:
      return "On track";
  }
}

function todoProjectLabel(todo: PmosProjectTodoItem) {
  return todo.projectName || (todo.projectId ? `Project ${todo.projectId}` : "Unknown project");
}

function quickPromptForProject(project: PmosProjectCard): string {
  return `Review Basecamp project "${project.name}" and give blockers, pending tasks, urgent items, and the next 3 actions.`;
}

function renderTodoList(title: string, items: PmosProjectTodoItem[], empty: string) {
  return html`
    <div class="project-priority-card">
      <div class="project-priority-card__title">${title}</div>
      <div class="project-priority-list">
        ${items.slice(0, 20).map(
          (todo) => html`
            <div class="project-priority-item">
              <div class="project-priority-item__row">
                <div class="project-priority-item__title">${todo.title}</div>
                ${todo.appUrl
                  ? html`
                      <a class="btn btn--xs" href=${todo.appUrl} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    `
                  : nothing}
              </div>
              <div class="project-priority-item__meta">
                <span>${todoProjectLabel(todo)}</span>
                <span class="mono">${todo.dueOn ?? "no due date"}</span>
              </div>
            </div>
          `,
        )}
        ${items.length === 0 ? html`<div class="muted">${empty}</div>` : nothing}
      </div>
    </div>
  `;
}

// -- View: Project Cards (original) --

function renderProjectCards(props: CommandCenterProps, cards: PmosProjectCard[]) {
  return html`
    <div class="project-cards-grid">
      ${cards.map(
        (project) => html`
          <article class="project-card">
            <div class="project-card__head">
              <div class="project-card__title">${project.name}</div>
              <span class="chip ${healthChipClass(project.health)}">${healthLabel(project.health)}</span>
            </div>
            <div class="project-card__metrics">
              <div class="project-card__metric">
                <span class="muted">Open</span>
                <strong>${project.openTodos}</strong>
              </div>
              <div class="project-card__metric">
                <span class="muted">Assigned</span>
                <strong>${project.assignedTodos}</strong>
              </div>
              <div class="project-card__metric">
                <span class="muted">Overdue</span>
                <strong>${project.overdueTodos}</strong>
              </div>
              <div class="project-card__metric">
                <span class="muted">Due today</span>
                <strong>${project.dueTodayTodos}</strong>
              </div>
              <div class="project-card__metric">
                <span class="muted">Future</span>
                <strong>${project.futureTodos}</strong>
              </div>
              <div class="project-card__metric">
                <span class="muted">No date</span>
                <strong>${project.noDueDateTodos}</strong>
              </div>
            </div>
            <div class="project-card__meta">
              <span>Next due / Lists</span>
              <span class="mono">${project.nextDueOn ?? "n/a"} · ${project.todoLists}</span>
            </div>
            ${(project.previewTodos ?? []).length > 0
              ? html`
                  <div class="project-card__todo-list">
                    ${(project.previewTodos ?? []).map(
                      (todo) => html`
                        <div class="project-card__todo-item">
                          <div class="project-card__todo-row">
                            <div class="project-card__todo-title">${todo.title}</div>
                            ${todo.appUrl
                              ? html`
                                  <a class="btn btn--xs" href=${todo.appUrl} target="_blank" rel="noreferrer">
                                    Open
                                  </a>
                                `
                              : nothing}
                          </div>
                          <div class="project-card__todo-meta">
                            <span>${todo.dueOn ?? "no due date"}</span>
                          </div>
                        </div>
                      `,
                    )}
                  </div>
                `
              : nothing}
            <div class="project-card__actions">
              <button class="btn btn--sm btn--primary" @click=${() => props.onSelectProject(project)}>
                Explore
              </button>
              ${project.appUrl
                ? html`
                    <a class="btn btn--sm" href=${project.appUrl} target="_blank" rel="noreferrer">
                      Open Basecamp
                    </a>
                  `
                : nothing}
              <button class="btn btn--sm" @click=${() => props.onPrefillChat(quickPromptForProject(project))}>
                Use in Chat
              </button>
            </div>
          </article>
        `,
      )}
    </div>
  `;
}

// -- View: Status Board --

const HEALTH_ORDER: PmosProjectCard["health"][] = ["at_risk", "attention", "on_track", "quiet"];

function renderStatusBoard(props: CommandCenterProps, cards: PmosProjectCard[]) {
  const groups = new Map<PmosProjectCard["health"], PmosProjectCard[]>();
  for (const h of HEALTH_ORDER) groups.set(h, []);
  for (const card of cards) {
    const bucket = groups.get(card.health) ?? groups.get("on_track")!;
    bucket.push(card);
  }

  return html`
    <div class="status-board">
      ${HEALTH_ORDER.map((health) => {
        const items = groups.get(health) ?? [];
        return html`
          <div class="status-board__column">
            <div class="status-board__column-header">
              <span class="chip ${healthChipClass(health)}">${healthLabel(health)}</span>
              <span class="muted" style="font-size:12px;">${items.length}</span>
            </div>
            <div class="status-board__column-body">
              ${items.length === 0
                ? html`<div class="muted" style="padding:12px; font-size:13px;">No projects</div>`
                : items.map(
                    (project) => html`
                      <div class="status-board__card">
                        <div style="font-weight:500; font-size:14px; margin-bottom:4px;">${project.name}</div>
                        <div class="row" style="gap:12px; font-size:12px;">
                          <span>Open: <strong>${project.openTodos}</strong></span>
                          <span>Assigned: <strong>${project.assignedTodos}</strong></span>
                          <span>Overdue: <strong class="${project.overdueTodos > 0 ? "warn" : ""}">${project.overdueTodos}</strong></span>
                          <span>Due today: <strong>${project.dueTodayTodos}</strong></span>
                        </div>
                        <div class="row" style="gap:6px; margin-top:6px;">
                          <button class="btn btn--xs btn--primary" @click=${() => props.onSelectProject(project)}>Explore</button>
                          ${project.appUrl
                            ? html`<a class="btn btn--xs" href=${project.appUrl} target="_blank" rel="noreferrer">Basecamp</a>`
                            : nothing}
                          <button class="btn btn--xs" @click=${() => props.onPrefillChat(quickPromptForProject(project))}>
                            Chat
                          </button>
                        </div>
                      </div>
                    `,
                  )}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

// -- View: Timeline --

function renderTimeline(props: CommandCenterProps, snapshot: PmosProjectsSnapshot) {
  const allTodos = [
    ...(snapshot.urgentTodos ?? []),
    ...(snapshot.dueTodayTodos ?? []),
    ...(snapshot.futureTodos ?? []),
    ...(snapshot.noDueDateTodos ?? []),
  ];

  // Deduplicate by id
  const seen = new Set<string>();
  const unique: PmosProjectTodoItem[] = [];
  for (const todo of allTodos) {
    const key = todo.id ?? todo.title;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(todo);
    }
  }

  // Sort by due date (overdue first, then today, then no date)
  unique.sort((a, b) => {
    if (!a.dueOn && !b.dueOn) return 0;
    if (!a.dueOn) return 1;
    if (!b.dueOn) return -1;
    return a.dueOn.localeCompare(b.dueOn);
  });

  // Group by date
  const groups = new Map<string, PmosProjectTodoItem[]>();
  for (const todo of unique) {
    const key = todo.dueOn ?? "No due date";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(todo);
  }

  const today = new Date().toISOString().slice(0, 10);

  return html`
    <div class="timeline-view">
      ${unique.length === 0
        ? html`<div class="muted" style="padding:16px;">No due-date activity to show in timeline.</div>`
        : Array.from(groups.entries()).map(
            ([date, todos]) => html`
              <div class="timeline-group">
                <div class="timeline-group__header">
                  <span class="timeline-group__date ${date < today ? "warn" : date === today ? "highlight" : ""}">
                    ${date === today ? "Today" : date === "No due date" ? "No due date" : date}
                  </span>
                  <span class="muted" style="font-size:12px;">${todos.length} item${todos.length !== 1 ? "s" : ""}</span>
                  ${date < today && date !== "No due date"
                    ? html`<span class="chip chip-danger" style="font-size:11px;">Overdue</span>`
                    : nothing}
                </div>
                <div class="timeline-group__items">
                  ${todos.map(
                    (todo) => html`
                      <div class="timeline-item">
                        <div class="timeline-item__dot ${date < today ? "danger" : date === today ? "warn" : ""}"></div>
                        <div class="timeline-item__content">
                          <div class="timeline-item__title">${todo.title}</div>
                          <div class="timeline-item__meta">
                            <span class="muted">${todoProjectLabel(todo)}</span>
                            ${todo.appUrl
                              ? html`<a class="btn btn--xs" href=${todo.appUrl} target="_blank" rel="noreferrer">Open</a>`
                              : nothing}
                          </div>
                        </div>
                      </div>
                    `,
                  )}
                </div>
              </div>
            `,
          )}
    </div>
  `;
}

// -- Project Detail View --

const DETAIL_TABS: { key: PmosProjectDetailTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "todos", label: "Todos" },
  { key: "messages", label: "Messages" },
  { key: "people", label: "People" },
  { key: "schedule", label: "Schedule" },
  { key: "card_tables", label: "Card Tables" },
];

function renderProjectDetailHeader(props: CommandCenterProps) {
  const project = props.selectedProject!;
  return html`
    <div class="project-detail-header">
      <button class="btn btn--sm" @click=${() => props.onSelectProject(null)}>
        &larr; All Projects
      </button>
      <div class="project-detail-title">
        <span>${project.name}</span>
        <span class="chip ${healthChipClass(project.health)}">${healthLabel(project.health)}</span>
      </div>
      ${project.appUrl
        ? html`<a class="btn btn--sm" href=${project.appUrl} target="_blank" rel="noreferrer">Open in Basecamp</a>`
        : nothing}
    </div>
  `;
}

function renderProjectDetailTabs(props: CommandCenterProps) {
  return html`
    <div class="agent-tabs project-detail-tabs">
      ${DETAIL_TABS.map(
        (tab) => html`
          <button
            class="agent-tab ${props.projectDetailTab === tab.key ? "active" : ""}"
            @click=${() => props.onProjectDetailTabChange(tab.key)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderOverviewTab(project: PmosProjectCard) {
  return html`
    <div class="project-section-content">
      <div class="project-overview-metrics">
        <div class="project-card__metrics" style="margin-bottom: 16px;">
          <div class="project-card__metric">
            <span class="muted">Open</span>
            <strong>${project.openTodos}</strong>
          </div>
          <div class="project-card__metric">
            <span class="muted">Assigned</span>
            <strong>${project.assignedTodos}</strong>
          </div>
          <div class="project-card__metric">
            <span class="muted">Overdue</span>
            <strong class="${project.overdueTodos > 0 ? "warn" : ""}">${project.overdueTodos}</strong>
          </div>
          <div class="project-card__metric">
            <span class="muted">Due today</span>
            <strong>${project.dueTodayTodos}</strong>
          </div>
          <div class="project-card__metric">
            <span class="muted">Future</span>
            <strong>${project.futureTodos}</strong>
          </div>
          <div class="project-card__metric">
            <span class="muted">No date</span>
            <strong>${project.noDueDateTodos}</strong>
          </div>
          <div class="project-card__metric">
            <span class="muted">Todo lists</span>
            <strong>${project.todoLists}</strong>
          </div>
          <div class="project-card__metric">
            <span class="muted">Next due</span>
            <strong class="mono">${project.nextDueOn ?? "n/a"}</strong>
          </div>
        </div>
        ${(project.previewTodos ?? []).length > 0
          ? html`
              <div style="margin-bottom: 8px; font-weight: 500; font-size: 14px;">Upcoming todos</div>
              <div class="project-section-list">
                ${(project.previewTodos ?? []).map(
                  (todo) => html`
                    <div class="project-section-item">
                      <div class="project-section-item__title">${todo.title}</div>
                      <div class="project-section-item__meta">
                        <span class="muted mono">${todo.dueOn ?? "no due date"}</span>
                        ${todo.appUrl
                          ? html`<a class="btn btn--xs" href=${todo.appUrl} target="_blank" rel="noreferrer">Open</a>`
                          : nothing}
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
          : html`<div class="muted">No preview todos available. Click Todos tab to load all.</div>`}
      </div>
    </div>
  `;
}

function renderTodosSection(data: unknown) {
  if (!data || typeof data !== "object") return html`<div class="muted">No todo data.</div>`;
  // data is likely string or structured object from bcgpt tool
  if (typeof data === "string") {
    return html`<pre class="project-section-pre">${data}</pre>`;
  }
  const raw = data as Record<string, unknown>;
  // Try to render as todolists grouped format
  const todolists = Array.isArray(raw.todolists)
    ? (raw.todolists as Array<{ name?: string; todos?: Array<{ title?: string; dueOn?: string; appUrl?: string; status?: string }> }>)
    : null;
  if (todolists) {
    return html`
      <div class="project-section-list">
        ${todolists.map(
          (list) => html`
            <div class="project-section-group">
              <div class="project-section-group__header">${list.name ?? "Untitled list"}</div>
              ${(list.todos ?? []).map(
                (todo) => html`
                  <div class="project-section-item">
                    <div class="project-section-item__title">${todo.title}</div>
                    <div class="project-section-item__meta">
                      <span class="muted mono">${todo.dueOn ?? "no due date"}</span>
                      <span class="chip chip--tiny">${todo.status ?? ""}</span>
                      ${todo.appUrl
                        ? html`<a class="btn btn--xs" href=${todo.appUrl} target="_blank" rel="noreferrer">Open</a>`
                        : nothing}
                    </div>
                  </div>
                `,
              )}
              ${(list.todos ?? []).length === 0 ? html`<div class="muted" style="font-size:12px; padding:4px 0;">No todos in this list</div>` : nothing}
            </div>
          `,
        )}
        ${todolists.length === 0 ? html`<div class="muted">No todo lists found.</div>` : nothing}
      </div>
    `;
  }
  // Fallback: show raw as formatted JSON
  return html`<pre class="project-section-pre">${JSON.stringify(data, null, 2)}</pre>`;
}

function renderMessagesSection(data: unknown) {
  if (!data) return html`<div class="muted">No messages.</div>`;
  if (typeof data === "string") return html`<pre class="project-section-pre">${data}</pre>`;
  const messages = Array.isArray(data) ? (data as Array<{ title?: string; author?: string; createdAt?: string; appUrl?: string }>) : null;
  if (messages) {
    return html`
      <div class="project-section-list">
        ${messages.map(
          (msg) => html`
            <div class="project-section-item">
              <div class="project-section-item__title">${msg.title ?? "(no title)"}</div>
              <div class="project-section-item__meta">
                <span class="muted">${msg.author ?? ""}</span>
                <span class="muted mono">${msg.createdAt ?? ""}</span>
                ${msg.appUrl
                  ? html`<a class="btn btn--xs" href=${msg.appUrl} target="_blank" rel="noreferrer">Open</a>`
                  : nothing}
              </div>
            </div>
          `,
        )}
        ${messages.length === 0 ? html`<div class="muted">No messages found.</div>` : nothing}
      </div>
    `;
  }
  return html`<pre class="project-section-pre">${JSON.stringify(data, null, 2)}</pre>`;
}

function renderScheduleSection(data: unknown) {
  if (!data) return html`<div class="muted">No schedule entries.</div>`;
  if (typeof data === "string") return html`<pre class="project-section-pre">${data}</pre>`;
  const entries = Array.isArray(data) ? (data as Array<{ title?: string; startsAt?: string; endsAt?: string; appUrl?: string }>) : null;
  if (entries) {
    return html`
      <div class="project-section-list">
        ${entries.map(
          (entry) => html`
            <div class="project-section-item">
              <div class="project-section-item__title">${entry.title ?? "(no title)"}</div>
              <div class="project-section-item__meta">
                <span class="muted mono">${entry.startsAt ?? ""} - ${entry.endsAt ?? ""}</span>
                ${entry.appUrl
                  ? html`<a class="btn btn--xs" href=${entry.appUrl} target="_blank" rel="noreferrer">Open</a>`
                  : nothing}
              </div>
            </div>
          `,
        )}
        ${entries.length === 0 ? html`<div class="muted">No schedule entries found.</div>` : nothing}
      </div>
    `;
  }
  return html`<pre class="project-section-pre">${JSON.stringify(data, null, 2)}</pre>`;
}

function renderCardTablesSection(data: unknown) {
  if (!data) return html`<div class="muted">No card tables.</div>`;
  if (typeof data === "string") return html`<pre class="project-section-pre">${data}</pre>`;
  const tables = Array.isArray(data)
    ? (data as Array<{ name?: string; columns?: Array<{ name?: string; cardsCount?: number }> }>)
    : null;
  if (tables) {
    return html`
      <div class="project-section-list">
        ${tables.map(
          (table) => html`
            <div class="project-section-group">
              <div class="project-section-group__header">${table.name ?? "Untitled table"}</div>
              ${(table.columns ?? []).map(
                (col) => html`
                  <div class="project-section-item">
                    <div class="project-section-item__title">${col.name ?? "Untitled column"}</div>
                    <div class="project-section-item__meta">
                      <span class="chip">${col.cardsCount ?? 0} cards</span>
                    </div>
                  </div>
                `,
              )}
              ${(table.columns ?? []).length === 0 ? html`<div class="muted" style="font-size:12px; padding:4px 0;">No columns</div>` : nothing}
            </div>
          `,
        )}
        ${tables.length === 0 ? html`<div class="muted">No card tables found.</div>` : nothing}
      </div>
    `;
  }
  return html`<pre class="project-section-pre">${JSON.stringify(data, null, 2)}</pre>`;
}

function renderPeopleSection(data: unknown) {
  if (!data) return html`<div class="muted">No people data.</div>`;
  if (typeof data === "string") return html`<pre class="project-section-pre">${data}</pre>`;
  const people = Array.isArray(data) ? (data as Array<{ name?: string; email?: string; role?: string }>) : null;
  if (people) {
    return html`
      <div class="project-section-list">
        ${people.map(
          (person) => html`
            <div class="project-section-item">
              <div class="project-section-item__title">${person.name ?? "(unknown)"}</div>
              <div class="project-section-item__meta">
                <span class="muted">${person.email ?? ""}</span>
                ${person.role ? html`<span class="chip">${person.role}</span>` : nothing}
              </div>
            </div>
          `,
        )}
        ${people.length === 0 ? html`<div class="muted">No people found.</div>` : nothing}
      </div>
    `;
  }
  return html`<pre class="project-section-pre">${JSON.stringify(data, null, 2)}</pre>`;
}

function renderSectionTab(props: CommandCenterProps, section: PmosProjectDetailTab) {
  const project = props.selectedProject!;
  const key = `${project.id}:${section}`;
  const sectionData = props.projectSectionData[key];

  if (!sectionData) {
    return html`
      <div class="project-section-empty">
        <div class="muted" style="margin-bottom: 12px;">Not yet loaded.</div>
        <div class="row" style="gap: 8px;">
          <button class="btn btn--sm btn--primary" @click=${() => props.onLoadProjectSection(project.name, section)}>
            Load ${DETAIL_TABS.find((t) => t.key === section)?.label ?? section}
          </button>
          <button
            class="btn btn--sm"
            @click=${() => props.onPrefillChat(`Tell me about the ${section} for project "${project.name}".`)}
          >
            Ask AI
          </button>
        </div>
      </div>
    `;
  }

  if (sectionData.loading) {
    return html`
      <div class="project-section-content">
        <div class="progress-bar"><div class="progress-bar__fill progress-bar__fill--indeterminate"></div></div>
        <div class="muted" style="margin-top: 8px; font-size: 13px;">Loading ${section}...</div>
      </div>
    `;
  }

  if (sectionData.error) {
    return html`
      <div class="project-section-content">
        <div class="callout danger">${sectionData.error}</div>
        <div class="row" style="gap: 8px; margin-top: 8px;">
          <button class="btn btn--sm" @click=${() => props.onLoadProjectSection(project.name, section)}>Retry</button>
          <button class="btn btn--sm" @click=${() => props.onPrefillChat(`Tell me about the ${section} for project "${project.name}".`)}>
            Ask AI instead
          </button>
        </div>
      </div>
    `;
  }

  const content =
    section === "todos" ? renderTodosSection(sectionData.data)
    : section === "messages" ? renderMessagesSection(sectionData.data)
    : section === "schedule" ? renderScheduleSection(sectionData.data)
    : section === "card_tables" ? renderCardTablesSection(sectionData.data)
    : renderPeopleSection(sectionData.data);

  return html`
    <div class="project-section-content">
      <div class="row" style="gap: 8px; margin-bottom: 12px;">
        <button class="btn btn--sm" @click=${() => props.onLoadProjectSection(project.name, section)}>Refresh</button>
        <button
          class="btn btn--sm"
          @click=${() => props.onPrefillChat(`Tell me about the ${section} for project "${project.name}".`)}
        >
          Ask AI
        </button>
      </div>
      ${content}
    </div>
  `;
}

function renderProjectDetail(props: CommandCenterProps) {
  const project = props.selectedProject!;
  const tab = props.projectDetailTab;

  return html`
    <section class="projects-layout">
      <div class="projects-main">
        <div class="card project-detail">
          ${renderProjectDetailHeader(props)}
          ${renderProjectDetailTabs(props)}
          <div class="project-detail-body">
            ${tab === "overview" ? renderOverviewTab(project) : renderSectionTab(props, tab)}
          </div>
        </div>
      </div>
      <div class="projects-side">
        <div class="card projects-chat-card">
          <div class="card-title">Project Copilot</div>
          <div class="card-sub">Ask about "${project.name}" -- todos, blockers, team, schedule, or any action.</div>
          <div class="row projects-chat-shortcuts" style="margin-top: 10px;">
            <button
              class="btn btn--sm"
              @click=${() => props.onPrefillChat(`What are the most urgent todos in "${project.name}"?`)}
            >
              Urgent Items
            </button>
            <button
              class="btn btn--sm"
              @click=${() => props.onPrefillChat(`Summarize the current state of "${project.name}" and suggest next steps.`)}
            >
              Summary
            </button>
          </div>
          <div class="projects-chat-host">
            ${renderChat(props.chatProps)}
          </div>
        </div>
      </div>
    </section>
  `;
}

// -- View Mode Switcher --

function renderViewModeSwitcher(props: CommandCenterProps) {
  const modes: { key: ProjectViewMode; label: string }[] = [
    { key: "cards", label: "Cards" },
    { key: "status-board", label: "Status Board" },
    { key: "timeline", label: "Timeline" },
  ];
  return html`
    <div class="view-mode-switcher">
      ${modes.map(
        (mode) => html`
          <button
            class="btn btn--sm ${props.viewMode === mode.key ? "btn--active" : ""}"
            @click=${() => props.onViewModeChange(mode.key)}
          >
            ${mode.label}
          </button>
        `,
      )}
    </div>
  `;
}

// -- Main Render --

export function renderCommandCenter(props: CommandCenterProps) {
  // Show project detail view when a project is selected
  if (props.selectedProject) {
    return renderProjectDetail(props);
  }

  const snapshot = props.snapshot;
  const totals = snapshot?.totals ?? {
    projectCount: 0,
    syncedProjects: 0,
    openTodos: 0,
    assignedTodos: 0,
    overdueTodos: 0,
    dueTodayTodos: 0,
    futureTodos: 0,
    noDueDateTodos: 0,
  };
  const configured = snapshot?.configured ?? false;
  const connected = snapshot?.connected ?? false;
  const identity = snapshot?.identity ?? null;
  const snapshotLoaded = Boolean(snapshot);
  const hasBasecampAccess = configured || connected || identity?.connected === true;
  const refreshedLabel = snapshot?.refreshedAtMs
    ? formatRelativeTimestamp(snapshot.refreshedAtMs)
    : "n/a";
  const errors = snapshot?.errors ?? [];
  const assignedTodos = snapshot?.assignedTodos ?? [];
  const urgentTodos = snapshot?.urgentTodos ?? [];
  const dueTodayTodos = snapshot?.dueTodayTodos ?? [];
  const futureTodos = snapshot?.futureTodos ?? [];
  const noDueDateTodos = snapshot?.noDueDateTodos ?? [];
  const allCards = snapshot?.projects ?? [];
  const projectSearch = (props.projectSearch ?? "").trim().toLowerCase();
  const cards = projectSearch
    ? allCards.filter((p) => p.name.toLowerCase().includes(projectSearch))
    : allCards;
  const staleLabel =
    snapshot?.cacheAgeMs && snapshot.cacheAgeMs > 0
      ? formatRelativeTimestamp(Date.now() - snapshot.cacheAgeMs)
      : refreshedLabel;

  const viewMode = props.viewMode ?? "cards";
  const ccTab = props.commandCenterTab ?? "overview";

  const CC_TABS: { key: CommandCenterTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "projects", label: "Projects" },
    { key: "timeline", label: "Timeline" },
  ];

  const tabStrip = html`
    <div class="dashboard-tab-strip">
      ${CC_TABS.map(
        (t) => html`
          <button
            class="dashboard-tab-btn ${ccTab === t.key ? "active" : ""}"
            @click=${() => props.onCommandCenterTabChange(t.key)}
          >
            ${t.label}
          </button>
        `,
      )}
    </div>
  `;

  const tabContent = () => {
    if (ccTab === "overview") {
      return html`
        <div class="project-stats-grid">
          <div class="stat project-stat-card">
            <div class="stat-label">Projects</div>
            <div class="stat-value">${totals.projectCount}</div>
            <div class="muted">Synced: ${totals.syncedProjects}</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">Open Todos</div>
            <div class="stat-value">${totals.openTodos}</div>
            <div class="muted">Across all projects</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">Assigned</div>
            <div class="stat-value ${totals.assignedTodos > 0 ? "warn" : "ok"}">${totals.assignedTodos}</div>
            <div class="muted">Visible in your queue</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">Overdue</div>
            <div class="stat-value ${totals.overdueTodos > 0 ? "warn" : "ok"}">${totals.overdueTodos}</div>
            <div class="muted">Urgent follow-up</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">Due Today</div>
            <div class="stat-value ${totals.dueTodayTodos > 0 ? "warn" : "ok"}">${totals.dueTodayTodos}</div>
            <div class="muted">Same-day action</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">Future</div>
            <div class="stat-value">${totals.futureTodos}</div>
            <div class="muted">Scheduled ahead</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">No Due Date</div>
            <div class="stat-value">${totals.noDueDateTodos}</div>
            <div class="muted">Needs prioritization</div>
          </div>
        </div>

        <div class="project-priority-grid">
          ${renderTodoList("Assigned to Me", assignedTodos, "No assigned todos right now.")}
          ${renderTodoList("Past Due", urgentTodos, "No overdue todos right now.")}
          ${renderTodoList("Due Today", dueTodayTodos, "No todos due today.")}
          ${renderTodoList("Future", futureTodos, "No upcoming todos in the visible queue.")}
          ${renderTodoList("No Due Date", noDueDateTodos, "No unscheduled todos in the visible queue.")}
        </div>
      `;
    }

    if (ccTab === "projects") {
      const boardModes: { key: ProjectViewMode; label: string }[] = [
        { key: "cards", label: "Cards" },
        { key: "status-board", label: "Status Board" },
      ];
      return html`
        <div class="card">
          <div class="projects-header-row">
            <div>
              <div class="card-title">${viewMode === "status-board" ? "Status Board" : "Project Cards"}</div>
              <div class="card-sub">
                ${viewMode === "status-board"
                  ? "Projects grouped by health status for quick triage."
                  : "Operational cards with health, metrics, and action shortcuts."}
              </div>
            </div>
            <div class="view-mode-switcher">
              ${boardModes.map(
                (m) => html`
                  <button
                    class="btn btn--sm ${viewMode === m.key ? "btn--active" : ""}"
                    @click=${() => props.onViewModeChange(m.key)}
                  >
                    ${m.label}
                  </button>
                `,
              )}
            </div>
          </div>

          ${viewMode === "cards"
            ? cards.length > 0
              ? renderProjectCards(props, cards)
              : allCards.length > 0
                ? html`<div class="muted" style="margin-top: 12px;">No projects match "${props.projectSearch}".</div>`
                : html`<div class="muted" style="margin-top: 12px;">No project cards available yet.</div>`
            : nothing}

          ${viewMode === "status-board"
            ? cards.length > 0
              ? renderStatusBoard(props, cards)
              : html`<div class="muted" style="margin-top: 12px;">No project data available yet.</div>`
            : nothing}
        </div>
      `;
    }

    // timeline tab
    return html`
      <div class="card">
        <div class="card-title">Timeline</div>
        <div class="card-sub">Past, today, future, and no-date items in chronological order.</div>
        ${snapshot
          ? renderTimeline(props, snapshot)
          : html`<div class="muted" style="margin-top: 12px;">No project data available yet.</div>`}
      </div>
    `;
  };

  return html`
    <section class="projects-layout">
      <div class="projects-main">
        <div class="card">
          <div class="projects-header-row">
            <div>
              <div class="card-title">Project Pulse</div>
              <div class="card-sub">Live Basecamp sync with project health, pending work, and urgency.</div>
            </div>
            <div class="row" style="gap:8px; flex-wrap:wrap; align-items:center;">
              <input
                type="search"
                .value=${props.projectSearch ?? ""}
                @input=${(e: Event) => props.onProjectSearchChange((e.target as HTMLInputElement).value)}
                placeholder="Search projects..."
                style="padding:4px 10px; font-size:13px; border:1px solid var(--border); border-radius:var(--radius-sm,6px); background:var(--input-bg,var(--surface)); color:inherit; outline:none; width:180px;"
              />
              <button class="btn btn--sm" @click=${() => props.onOpenIntegrations()}>Integrations</button>
              <button class="btn btn--sm" @click=${() => props.onOpenWorkflows()}>Workflows</button>
              <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>
                ${props.loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div class="chip-row" style="margin-top: 12px;">
            <span class="chip ${!snapshotLoaded ? "" : hasBasecampAccess ? "chip-ok" : "chip-danger"}">
              ${!snapshotLoaded
                ? "Checking Basecamp..."
                : configured
                  ? "Basecamp key configured"
                  : hasBasecampAccess
                    ? "Basecamp available"
                    : "Basecamp key missing"}
            </span>
            <span class="chip ${connected ? "chip-ok" : "chip-warn"}">
              ${connected ? "Basecamp connected" : "Basecamp disconnected"}
            </span>
            <span class="chip">Last refresh: ${refreshedLabel}</span>
            ${identity?.email ? html`<span class="chip">User: ${identity.email}</span>` : nothing}
            ${identity?.selectedAccountId
              ? html`<span class="chip">Account: ${identity.selectedAccountId}</span>`
              : nothing}
          </div>

          ${props.loading
            ? html`
                <div style="margin-top: 12px;">
                  <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                    <span style="font-size:13px; font-weight:500;">Syncing with Basecamp...</span>
                    ${snapshot?.projects?.length
                      ? html`<span class="muted" style="font-size:12px;">Showing last data from ${refreshedLabel}</span>`
                      : nothing}
                  </div>
                  <div class="progress-bar"><div class="progress-bar__fill progress-bar__fill--indeterminate"></div></div>
                </div>
              `
            : nothing}
          ${snapshot?.stale && snapshot?.staleReason
            ? html`<div class="callout warn" style="margin-top: 12px;">Latest refresh failed. Showing snapshot from ${staleLabel}. ${snapshot.staleReason}</div>`
            : props.error
              ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
              : nothing}
          ${errors.length > 0 && allCards.length === 0 && assignedTodos.length === 0 && urgentTodos.length === 0 && dueTodayTodos.length === 0 && futureTodos.length === 0 && noDueDateTodos.length === 0
            ? html`<div class="callout info" style="margin-top: 12px;">${errors[0]}</div>`
            : nothing}
          ${!props.connected
            ? html`<div class="callout danger" style="margin-top: 12px;">Connect to Wicked OS first to load Projects.</div>`
            : snapshotLoaded && !hasBasecampAccess
              ? html`<div class="callout info" style="margin-top: 12px;">Add your Basecamp token in Integrations to enable project cards and AI project actions.</div>`
              : nothing}

          ${tabStrip}
        </div>

        ${tabContent()}
      </div>

      <div class="projects-side">
        <div class="card projects-chat-card">
          <div class="card-title">Project Copilot</div>
          <div class="card-sub">
            Ask for updates, blockers, summaries, or direct actions in Basecamp.
          </div>
          <div class="row projects-chat-shortcuts" style="margin-top: 10px;">
            <button
              class="btn btn--sm"
              @click=${() => props.onPrefillChat("Give me a daily project brief: urgent tasks, overdue items, and what to do next.")}
            >
              Daily Brief
            </button>
            <button
              class="btn btn--sm"
              @click=${() => props.onPrefillChat("List all Basecamp projects and flag high-risk items with owners and due dates.")}
            >
              Risk Check
            </button>
          </div>
          <div class="projects-chat-host">
            ${renderChat(props.chatProps)}
          </div>
        </div>
      </div>
    </section>
  `;
}
