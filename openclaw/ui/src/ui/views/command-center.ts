import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { ChatProps } from "./chat.ts";
import { renderChat } from "./chat.ts";
import type {
  PmosEntityDetail,
  PmosEntityReference,
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
  selectedEntityDetail: PmosEntityDetail | null;
  selectedEntityLoading: boolean;
  selectedEntityError: string | null;
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
  onOpenItemDetail: (reference: PmosEntityReference) => void;
  onCloseItemDetail: () => void;
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

function dockCapabilityLabel(project: PmosProjectCard, limit = 5) {
  return (project.dockCapabilities ?? [])
    .map((dock) => dock.title || dock.name)
    .filter((label): label is string => Boolean(label))
    .slice(0, limit);
}

function openTodoDetail(props: CommandCenterProps, todo: PmosProjectTodoItem) {
  props.onOpenItemDetail({
    type: "todo",
    id: todo.id,
    projectId: todo.projectId,
    url: todo.appUrl,
    label: todo.title,
  });
}

function quickPromptForProject(project: PmosProjectCard): string {
  return `Review Basecamp project "${project.name}" and give blockers, pending tasks, urgent items, and the next 3 actions.`;
}

function sortTodosLatestFirst(items: PmosProjectTodoItem[]): PmosProjectTodoItem[] {
  return [...items].sort((a, b) => {
    const idA = a.id ? parseInt(a.id, 10) : 0;
    const idB = b.id ? parseInt(b.id, 10) : 0;
    if (idA !== idB) return idB - idA;
    if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
    if (a.dueOn) return -1;
    if (b.dueOn) return 1;
    return 0;
  });
}

function renderTodoList(props: CommandCenterProps, title: string, items: PmosProjectTodoItem[], empty: string) {
  return html`
    <div class="project-priority-card">
      <div class="project-priority-card__title">${title}</div>
      <div class="project-priority-list">
        ${items.slice(0, 20).map(
          (todo) => html`
            <div class="project-priority-item">
                <div class="project-priority-item__row">
                  <div class="project-priority-item__title">${todo.title}</div>
                  <div class="row" style="gap:6px;">
                    ${(todo.id || todo.appUrl)
                      ? html`
                          <button class="btn btn--xs" @click=${() => openTodoDetail(props, todo)}>
                            Details
                          </button>
                        `
                      : nothing}
                    ${todo.appUrl
                      ? html`
                          <a class="btn btn--xs" href=${todo.appUrl} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        `
                      : nothing}
                  </div>
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

function renderCommandCenterFocusStrip(props: CommandCenterProps) {
  const cards = [
    {
      title: "My Day",
      detail: "Start with overdue work, then today’s due items and the next best actions.",
      prompt: "What do I need to do today in Basecamp? Start with overdue items, then due today, then the next best actions.",
    },
    {
      title: "Overdue",
      detail: "Show the overdue todos that actually need attention first.",
      prompt: "What are the most important overdue todos in Basecamp right now? Group them by project and tell me what to do first.",
    },
    {
      title: "Tomorrow",
      detail: "See tomorrow’s work before it becomes another fire drill.",
      prompt: "What is due tomorrow in Basecamp? Group it by project and flag anything risky or blocked.",
    },
    {
      title: "Project Risk",
      detail: "Find the projects slipping, the blockers, and the owners to chase.",
      prompt: "Which Basecamp projects need attention right now? Show the blockers, overdue work, owners, and the next 3 follow-ups.",
    },
  ];

  return html`
    <div class="command-center-focus-grid">
      ${cards.map(
        (card) => html`
          <article class="command-center-focus-card">
            <div class="command-center-focus-card__title">${card.title}</div>
            <div class="command-center-focus-card__detail">${card.detail}</div>
            <button class="btn btn--sm btn--primary" @click=${() => props.onPrefillChat(card.prompt)}>
              Ask
            </button>
          </article>
        `,
      )}
    </div>
  `;
}

function workspaceStatusLabel(snapshotLoaded: boolean, configured: boolean, hasBasecampAccess: boolean) {
  if (!snapshotLoaded) return "Checking Basecamp...";
  if (configured) return "Basecamp connected";
  if (hasBasecampAccess) return "Basecamp available";
  return "Basecamp key missing";
}

function workspaceStatusTone(snapshotLoaded: boolean, configured: boolean, hasBasecampAccess: boolean) {
  if (!snapshotLoaded) return "";
  if (configured || hasBasecampAccess) return "chip-ok";
  return "chip-danger";
}

function topAttentionProjects(cards: PmosProjectCard[]) {
  return [...cards]
    .filter((project) => project.overdueTodos > 0 || project.dueTodayTodos > 0 || project.assignedTodos > 0)
    .sort((a, b) =>
      (b.overdueTodos - a.overdueTodos) ||
      (b.dueTodayTodos - a.dueTodayTodos) ||
      (b.assignedTodos - a.assignedTodos) ||
      (b.openTodos - a.openTodos) ||
      a.name.localeCompare(b.name)
    )
    .slice(0, 6);
}

function renderWorkspaceHero(
  props: CommandCenterProps,
  {
    snapshotLoaded,
    configured,
    hasBasecampAccess,
    refreshedLabel,
    identity,
    totals,
    cards,
  }: {
    snapshotLoaded: boolean;
    configured: boolean;
    hasBasecampAccess: boolean;
    refreshedLabel: string;
    identity: PmosProjectsSnapshot["identity"];
    totals: PmosProjectsSnapshot["totals"];
    cards: PmosProjectCard[];
  },
) {
  const displayName = identity?.name?.trim() || identity?.email?.trim() || "your workspace";
  const attentionProjects = topAttentionProjects(cards);
  return html`
    <section class="command-center-hero">
      <div class="command-center-hero__intro">
        <div class="command-center-hero__eyebrow">Basecamp Workspace Home</div>
        <h2 class="command-center-hero__title">My work, project risk, and next actions in one place.</h2>
        <div class="command-center-hero__detail">
          ${snapshotLoaded
            ? html`Live PMOS snapshot for <strong>${displayName}</strong>.`
            : html`Checking Basecamp identity and project data for <strong>${displayName}</strong>.`}
          Start with overdue work, then move into project drill-down without losing AI context.
        </div>
        <div class="command-center-hero__chips">
          <span class="chip ${workspaceStatusTone(snapshotLoaded, configured, hasBasecampAccess)}">
            ${workspaceStatusLabel(snapshotLoaded, configured, hasBasecampAccess)}
          </span>
          <span class="chip">Refreshed ${refreshedLabel}</span>
          ${identity?.email ? html`<span class="chip">${identity.email}</span>` : nothing}
          ${identity?.selectedAccountId ? html`<span class="chip">Account ${identity.selectedAccountId}</span>` : nothing}
        </div>
        <div class="command-center-hero__actions">
          <button class="btn btn--sm btn--primary" @click=${() => props.onPrefillChat("What do I need to do today in Basecamp? Start with overdue items, then due today, then the next best actions.")}>
            My Day Brief
          </button>
          <button class="btn btn--sm" @click=${() => props.onOpenIntegrations()}>Integrations</button>
          <button class="btn btn--sm" @click=${() => props.onRefresh()} ?disabled=${props.loading}>
            ${props.loading ? "Syncing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div class="command-center-hero__stats">
        <div class="command-center-hero__stat">
          <span class="command-center-hero__stat-label">Open work</span>
          <strong>${totals.openTodos}</strong>
          <span class="muted">${totals.projectCount} projects in play</span>
        </div>
        <div class="command-center-hero__stat">
          <span class="command-center-hero__stat-label">Assigned to me</span>
          <strong>${totals.assignedTodos}</strong>
          <span class="muted">Visible in your queue</span>
        </div>
        <div class="command-center-hero__stat">
          <span class="command-center-hero__stat-label">Needs attention</span>
          <strong>${totals.overdueTodos + totals.dueTodayTodos}</strong>
          <span class="muted">${totals.overdueTodos} overdue / ${totals.dueTodayTodos} due today</span>
        </div>
        <div class="command-center-hero__stat">
          <span class="command-center-hero__stat-label">Unscheduled work</span>
          <strong>${totals.noDueDateTodos}</strong>
          <span class="muted">${attentionProjects.length} attention project${attentionProjects.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </section>
  `;
}

function renderProjectRadar(props: CommandCenterProps, cards: PmosProjectCard[]) {
  const attentionProjects = topAttentionProjects(cards);
  return html`
    <section class="workspace-radar">
      <div class="workspace-radar__header">
        <div>
          <div class="card-title">Project Radar</div>
          <div class="card-sub">The projects most likely to need action next.</div>
        </div>
      </div>
      <div class="workspace-radar__grid">
        ${attentionProjects.length === 0
          ? html`<div class="muted">No projects need attention right now.</div>`
          : attentionProjects.map(
              (project) => html`
                <article class="workspace-radar__card">
                  <div class="workspace-radar__card-head">
                    <div class="workspace-radar__card-title">${project.name}</div>
                    <span class="chip ${healthChipClass(project.health)}">${healthLabel(project.health)}</span>
                  </div>
                  <div class="workspace-radar__card-metrics">
                    <span>Overdue <strong>${project.overdueTodos}</strong></span>
                    <span>Today <strong>${project.dueTodayTodos}</strong></span>
                    <span>Assigned <strong>${project.assignedTodos}</strong></span>
                  </div>
                  <div class="workspace-radar__card-meta">
                    <span>Next due ${project.nextDueOn ?? "n/a"}</span>
                    <span>${project.todoLists} lists</span>
                  </div>
                  <div class="workspace-radar__card-actions">
                    <button class="btn btn--xs btn--primary" @click=${() => props.onSelectProject(project)}>Open cockpit</button>
                    <button class="btn btn--xs" @click=${() => props.onPrefillChat(quickPromptForProject(project))}>Ask AI</button>
                  </div>
                </article>
              `,
            )}
      </div>
    </section>
  `;
}

// -- View: Project Cards (original) --

function renderProjectCards(props: CommandCenterProps, cards: PmosProjectCard[]) {
  return html`
    <div class="project-cards-grid">
      ${cards.map(
        (project) => html`
          <article class="project-card ${project.overdueTodos > 0 ? "project-card--danger" : project.dueTodayTodos > 0 ? "project-card--attention" : ""}">
            <div class="project-card__eyebrow">Project cockpit</div>
            <div class="project-card__head">
              <div class="project-card__title">${project.name}</div>
              <span class="chip ${healthChipClass(project.health)}">${healthLabel(project.health)}</span>
            </div>
            ${project.description
              ? html`<div class="project-card__summary">${project.description}</div>`
              : nothing}
            ${dockCapabilityLabel(project).length > 0
              ? html`
                  <div class="project-card__capabilities">
                    ${dockCapabilityLabel(project).map((label) => html`<span class="chip chip--tiny">${label}</span>`)}
                  </div>
                `
              : nothing}
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
  { key: "campfire", label: "Campfire" },
  { key: "files", label: "Files" },
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

function renderOverviewTab(props: CommandCenterProps, project: PmosProjectCard) {
  return html`
    <div class="project-section-content">
      ${project.description
        ? html`<div class="project-overview-summary">${project.description}</div>`
        : nothing}
      ${dockCapabilityLabel(project, 8).length > 0
        ? html`
            <div class="project-overview-capabilities">
              ${dockCapabilityLabel(project, 8).map((label) => html`<span class="chip chip--tiny">${label}</span>`)}
            </div>
          `
        : nothing}
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
          <div class="project-card__metric">
            <span class="muted">Updated</span>
            <strong class="mono">${project.updatedAt ? project.updatedAt.slice(0, 10) : "n/a"}</strong>
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
                        ${(todo.id || todo.appUrl)
                          ? html`<button class="btn btn--xs" @click=${() => openTodoDetail(props, todo)}>Details</button>`
                          : nothing}
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

type NormalizedTodo = { id: string | null; title: string; status: string | null; dueOn: string | null; appUrl: string | null; assignee: string | null; completedAt: string | null; creator: string | null };
type NormalizedTodoGroup = { name: string; todosCount: number; todos: NormalizedTodo[] };

function renderTodosSection(props: CommandCenterProps, project: PmosProjectCard, data: unknown) {
  if (!Array.isArray(data) || data.length === 0) return html`<div class="muted">No todos found.</div>`;
  const groups = data as NormalizedTodoGroup[];
  const totalOpen = groups.reduce((sum, g) => sum + g.todos.filter((t) => t.status !== "completed").length, 0);
  return html`
    <div class="project-section-list">
      <div class="project-section-summary muted" style="font-size:12px; margin-bottom:8px;">${totalOpen} open across ${groups.length} list${groups.length !== 1 ? "s" : ""}</div>
      ${groups.map((group) => {
        const open = group.todos.filter((t) => t.status !== "completed");
        const done = group.todos.filter((t) => t.status === "completed");
        return html`
          <div class="project-section-group">
            <div class="project-section-group__header">
              ${group.name}
              <span class="chip chip--tiny" style="margin-left:6px;">${open.length} open${done.length > 0 ? ` / ${done.length} done` : ""}</span>
            </div>
            ${open.map((todo) => html`
              <div class="project-section-item">
                <div class="project-section-item__title">${todo.title}</div>
                <div class="project-section-item__meta">
                  ${(todo.id || todo.appUrl)
                    ? html`
                        <button
                          class="btn btn--xs"
                          @click=${() =>
                            props.onOpenItemDetail({
                              type: "todo",
                              id: todo.id,
                              projectId: project.id,
                              url: todo.appUrl,
                              label: todo.title,
                            })}
                        >
                          Details
                        </button>
                      `
                    : nothing}
                  ${todo.assignee ? html`<span class="chip chip--tiny">${todo.assignee}</span>` : nothing}
                  ${todo.dueOn ? html`<span class="muted mono" style="font-size:11px;">${todo.dueOn}</span>` : nothing}
                  ${todo.appUrl ? html`<a class="btn btn--xs" href=${todo.appUrl} target="_blank" rel="noreferrer">Open</a>` : nothing}
                </div>
              </div>
            `)}
            ${done.length > 0 ? html`
              <details style="margin-top:4px;">
                <summary class="muted" style="font-size:12px; cursor:pointer;">${done.length} completed</summary>
                ${done.map((todo) => html`
                  <div class="project-section-item" style="opacity:0.55; text-decoration:line-through;">
                    <div class="project-section-item__title">${todo.title}</div>
                  </div>
                `)}
              </details>
            ` : nothing}
            ${open.length === 0 && done.length === 0 ? html`<div class="muted" style="font-size:12px; padding:4px 0;">No todos in this list</div>` : nothing}
          </div>
        `;
      })}
    </div>
  `;
}

type NormalizedMessage = { id: string | null; title: string; author: string | null; createdAt: string | null; excerpt: string | null; appUrl: string | null };

function renderMessagesSection(props: CommandCenterProps, project: PmosProjectCard, data: unknown) {
  if (!Array.isArray(data) || data.length === 0) return html`<div class="muted">No messages found.</div>`;
  const messages = data as NormalizedMessage[];
  return html`
    <div class="project-section-list">
      <div class="project-section-summary muted" style="font-size:12px; margin-bottom:8px;">${messages.length} message${messages.length !== 1 ? "s" : ""}</div>
      ${messages.map((msg) => html`
        <div class="project-section-item">
          <div class="project-section-item__title">${msg.title}</div>
          <div class="project-section-item__meta">
            ${(msg.id || msg.appUrl)
              ? html`
                  <button
                    class="btn btn--xs"
                    @click=${() =>
                      props.onOpenItemDetail({
                        type: "message",
                        id: msg.id,
                        projectId: project.id,
                        url: msg.appUrl,
                        label: msg.title,
                      })}
                  >
                    Details
                  </button>
                `
              : nothing}
            ${msg.author ? html`<span class="chip chip--tiny">${msg.author}</span>` : nothing}
            ${msg.createdAt ? html`<span class="muted mono" style="font-size:11px;">${msg.createdAt.slice(0, 10)}</span>` : nothing}
            ${msg.appUrl ? html`<a class="btn btn--xs" href=${msg.appUrl} target="_blank" rel="noreferrer">Open</a>` : nothing}
          </div>
          ${msg.excerpt ? html`<div class="muted" style="font-size:12px; margin-top:3px; line-height:1.4;">${msg.excerpt}</div>` : nothing}
        </div>
      `)}
    </div>
  `;
}

type NormalizedEntry = { id: string | null; title: string; startsAt: string | null; endsAt: string | null; allDay: boolean; summary: string | null; appUrl: string | null };

function renderScheduleSection(props: CommandCenterProps, project: PmosProjectCard, data: unknown) {
  if (!Array.isArray(data) || data.length === 0) return html`<div class="muted">No schedule entries found.</div>`;
  const entries = data as NormalizedEntry[];
  return html`
    <div class="project-section-list">
      <div class="project-section-summary muted" style="font-size:12px; margin-bottom:8px;">${entries.length} event${entries.length !== 1 ? "s" : ""}</div>
      ${entries.map((entry) => html`
        <div class="project-section-item">
          <div class="project-section-item__title">${entry.title}</div>
          <div class="project-section-item__meta">
            ${(entry.id || entry.appUrl)
              ? html`
                  <button
                    class="btn btn--xs"
                    @click=${() =>
                      props.onOpenItemDetail({
                        type: "schedule_entry",
                        id: entry.id,
                        projectId: project.id,
                        url: entry.appUrl,
                        label: entry.title,
                      })}
                  >
                    Details
                  </button>
                `
              : nothing}
            ${entry.allDay
              ? html`<span class="chip chip--tiny">All day</span>`
              : nothing}
            ${entry.startsAt ? html`<span class="muted mono" style="font-size:11px;">${entry.startsAt.slice(0, 16).replace("T", " ")}</span>` : nothing}
            ${entry.endsAt && !entry.allDay ? html`<span class="muted" style="font-size:11px;">- ${entry.endsAt.slice(0, 16).replace("T", " ")}</span>` : nothing}
            ${entry.appUrl ? html`<a class="btn btn--xs" href=${entry.appUrl} target="_blank" rel="noreferrer">Open</a>` : nothing}
          </div>
          ${entry.summary ? html`<div class="muted" style="font-size:12px; margin-top:3px;">${entry.summary}</div>` : nothing}
        </div>
      `)}
    </div>
  `;
}

type NormalizedFileItem = {
  id: string | null;
  title: string;
  kind: string | null;
  createdAt: string | null;
  creator: string | null;
  excerpt: string | null;
  appUrl: string | null;
};

type NormalizedCampfireData = {
  chats: Array<{ id: string | null; title: string; appUrl: string | null }>;
  lines: Array<{ id: string | null; content: string; createdAt: string | null; author: string | null; appUrl: string | null }>;
};

function renderCampfireSection(props: CommandCenterProps, project: PmosProjectCard, data: unknown) {
  if (!data || typeof data !== "object") return html`<div class="muted">No campfire activity found.</div>`;
  const campfire = data as NormalizedCampfireData;
  const chats = Array.isArray(campfire.chats) ? campfire.chats : [];
  const lines = Array.isArray(campfire.lines) ? campfire.lines : [];
  if (!chats.length && !lines.length) return html`<div class="muted">No campfire activity found.</div>`;
  return html`
    <div class="project-section-list">
      ${chats.length > 0
        ? html`
            <div class="project-section-group">
              <div class="project-section-group__header">Campfires</div>
              ${chats.map((chat) => html`
                <div class="project-section-item">
                  <div class="project-section-item__title">${chat.title}</div>
                  <div class="project-section-item__meta">
                    ${chat.appUrl ? html`<a class="btn btn--xs" href=${chat.appUrl} target="_blank" rel="noreferrer">Open</a>` : nothing}
                  </div>
                </div>
              `)}
            </div>
          `
        : nothing}
      <div class="project-section-group">
        <div class="project-section-group__header">Recent lines</div>
        ${lines.map((line) => html`
          <div class="project-section-item">
            <div>
              <div class="project-section-item__title">${line.content || "(empty line)"}</div>
              <div class="muted" style="font-size:12px; margin-top:3px;">
                ${line.author ?? "Unknown"} · ${line.createdAt ? line.createdAt.replace("T", " ").slice(0, 16) : "n/a"}
              </div>
            </div>
            <div class="project-section-item__meta">
              ${(line.id || line.appUrl)
                ? html`
                    <button
                      class="btn btn--xs"
                      @click=${() =>
                        props.onOpenItemDetail({
                          type: "campfire",
                          id: line.id,
                          projectId: project.id,
                          url: line.appUrl,
                          label: line.content,
                        })}
                    >
                      Details
                    </button>
                  `
                : nothing}
              ${line.appUrl ? html`<a class="btn btn--xs" href=${line.appUrl} target="_blank" rel="noreferrer">Open</a>` : nothing}
            </div>
          </div>
        `)}
        ${lines.length === 0 ? html`<div class="muted">No recent campfire lines loaded.</div>` : nothing}
      </div>
    </div>
  `;
}

function renderFilesSection(props: CommandCenterProps, project: PmosProjectCard, data: unknown) {
  if (!Array.isArray(data) || data.length === 0) return html`<div class="muted">No files found.</div>`;
  const files = data as NormalizedFileItem[];
  return html`
    <div class="project-section-list">
      <div class="project-section-summary muted" style="font-size:12px; margin-bottom:8px;">${files.length} file${files.length !== 1 ? "s" : ""}</div>
      ${files.map((file) => html`
        <div class="project-section-item">
          <div class="project-section-item__title">${file.title}</div>
          <div class="project-section-item__meta">
            ${(file.id || file.appUrl)
              ? html`
                  <button
                    class="btn btn--xs"
                    @click=${() =>
                      props.onOpenItemDetail({
                        type: file.kind === "upload" ? "upload" : "document",
                        id: file.id,
                        projectId: project.id,
                        url: file.appUrl,
                        label: file.title,
                      })}
                  >
                    Details
                  </button>
                `
              : nothing}
            ${file.kind ? html`<span class="chip chip--tiny">${file.kind}</span>` : nothing}
            ${file.creator ? html`<span class="muted" style="font-size:11px;">${file.creator}</span>` : nothing}
            ${file.createdAt ? html`<span class="muted mono" style="font-size:11px;">${file.createdAt.slice(0, 10)}</span>` : nothing}
            ${file.appUrl ? html`<a class="btn btn--xs" href=${file.appUrl} target="_blank" rel="noreferrer">Open</a>` : nothing}
          </div>
          ${file.excerpt ? html`<div class="muted" style="font-size:12px; margin-top:3px; line-height:1.4;">${file.excerpt}</div>` : nothing}
        </div>
      `)}
    </div>
  `;
}

type NormalizedCard = { id: string | null; title: string; dueOn: string | null; assignee: string | null; status: string | null; appUrl: string | null };
type NormalizedColumn = { id: string | null; name: string; cardsCount: number; cards: NormalizedCard[] };
type NormalizedTable = { id: string | null; name: string; appUrl: string | null; columns: NormalizedColumn[] };

function renderCardTablesSection(props: CommandCenterProps, project: PmosProjectCard, data: unknown) {
  if (!Array.isArray(data) || data.length === 0) return html`<div class="muted">No card tables found.</div>`;
  const tables = data as NormalizedTable[];
  return html`
    <div class="project-section-list">
      ${tables.map((table) => html`
        <div class="project-section-group">
          <div class="project-section-group__header">
            ${table.name}
            ${table.appUrl ? html`<a class="btn btn--xs" href=${table.appUrl} target="_blank" rel="noreferrer" style="margin-left:6px;">Open board</a>` : nothing}
          </div>
          ${(table.columns ?? []).map((col) => html`
            <div class="project-section-item" style="padding-left:8px;">
              <div class="project-section-item__title" style="font-size:13px; font-weight:600;">${col.name} <span class="chip chip--tiny">${col.cardsCount}</span></div>
              ${col.cards.length > 0 ? html`
                <div style="margin-top:4px;">
                  ${col.cards.map((card) => html`
                    <div class="project-section-item" style="padding-left:8px; border-left:2px solid var(--color-border, #333);">
                      <div class="project-section-item__title" style="font-size:12px;">${card.title}</div>
                      <div class="project-section-item__meta">
                        ${(card.id || card.appUrl)
                          ? html`
                              <button
                                class="btn btn--xs"
                                @click=${() =>
                                  props.onOpenItemDetail({
                                    type: "card",
                                    id: card.id,
                                    projectId: project.id,
                                    url: card.appUrl,
                                    label: card.title,
                                  })}
                              >
                                Details
                              </button>
                            `
                          : nothing}
                        ${card.assignee ? html`<span class="chip chip--tiny">${card.assignee}</span>` : nothing}
                        ${card.dueOn ? html`<span class="muted mono" style="font-size:11px;">${card.dueOn}</span>` : nothing}
                        ${card.appUrl ? html`<a class="btn btn--xs" href=${card.appUrl} target="_blank" rel="noreferrer">Open</a>` : nothing}
                      </div>
                    </div>
                  `)}
                </div>
              ` : nothing}
            </div>
          `)}
          ${(table.columns ?? []).length === 0 ? html`<div class="muted" style="font-size:12px; padding:4px 0;">No columns</div>` : nothing}
        </div>
      `)}
    </div>
  `;
}

type NormalizedPerson = { id: string | null; name: string; email: string | null; role: string | null; avatarUrl: string | null };

function renderPeopleSection(props: CommandCenterProps, project: PmosProjectCard, data: unknown) {
  if (!Array.isArray(data) || data.length === 0) return html`<div class="muted">No people found.</div>`;
  const people = data as NormalizedPerson[];
  return html`
    <div class="project-section-list">
      <div class="project-section-summary muted" style="font-size:12px; margin-bottom:8px;">${people.length} team member${people.length !== 1 ? "s" : ""}</div>
      ${people.map((person) => html`
        <div class="project-section-item" style="display:flex; align-items:center; gap:10px;">
          <div class="person-avatar" style="width:32px; height:32px; border-radius:50%; background:var(--color-accent, #5b6ad0); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:#fff; flex-shrink:0;">
            ${person.avatarUrl
              ? html`<img src=${person.avatarUrl} style="width:32px; height:32px; border-radius:50%; object-fit:cover;" />`
              : person.name.charAt(0).toUpperCase()}
          </div>
          <div style="flex:1; min-width:0;">
            <div class="project-section-item__title">${person.name}</div>
            <div class="project-section-item__meta">
              ${person.id
                ? html`
                    <button
                      class="btn btn--xs"
                      @click=${() =>
                        props.onOpenItemDetail({
                          type: "person",
                          id: person.id,
                          projectId: project.id,
                          url: null,
                          label: person.name,
                        })}
                    >
                      Details
                    </button>
                  `
                : nothing}
              ${person.role ? html`<span class="chip chip--tiny">${person.role}</span>` : nothing}
              ${person.email ? html`<span class="muted" style="font-size:11px;">${person.email}</span>` : nothing}
            </div>
          </div>
        </div>
      `)}
    </div>
  `;
}

function askAiPromptForSection(section: PmosProjectDetailTab, projectName: string, data: unknown): string {
  const base = `Project: "${projectName}"`;
  if (section === "todos" && Array.isArray(data) && data.length > 0) {
    const groups = data as NormalizedTodoGroup[];
    const overdue = groups.flatMap((g) => g.todos).filter((t) => t.dueOn && t.dueOn < new Date().toISOString().slice(0, 10) && t.status !== "completed");
    if (overdue.length > 0) return `${base} -- which todos are most overdue and what should be prioritized?`;
    return `${base} -- summarize the open todos and flag anything that needs attention.`;
  }
  if (section === "messages") return `${base} -- what are the key decisions or action items from recent messages?`;
  if (section === "schedule") return `${base} -- what upcoming events do I need to prepare for?`;
  if (section === "campfire") return `${base} -- summarize the recent campfire discussion, blockers, and follow-ups.`;
  if (section === "files") return `${base} -- which files matter most right now, what are they for, and what should I read first?`;
  if (section === "card_tables") return `${base} -- what's the current state of the kanban board and what's blocking progress?`;
  if (section === "people") return `${base} -- who are the key people on this project and what are their roles?`;
  return `Tell me about the ${section} for project "${projectName}".`;
}

function renderSectionTab(props: CommandCenterProps, section: PmosProjectDetailTab) {
  const project = props.selectedProject!;
  const key = `${project.id}:${section}`;
  const sectionData = props.projectSectionData[key];

  // Auto-load: trigger load on first render if no data yet
  if (!sectionData) {
    // Fire load on next microtask so we don't mutate state during render
    Promise.resolve().then(() => props.onLoadProjectSection(project.name, section));
    return html`
      <div class="project-section-content">
        <div class="progress-bar"><div class="progress-bar__fill progress-bar__fill--indeterminate"></div></div>
        <div class="muted" style="margin-top: 8px; font-size: 13px;">Loading ${DETAIL_TABS.find((t) => t.key === section)?.label ?? section}...</div>
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
    section === "todos" ? renderTodosSection(props, project, sectionData.data)
    : section === "messages" ? renderMessagesSection(props, project, sectionData.data)
    : section === "schedule" ? renderScheduleSection(props, project, sectionData.data)
    : section === "campfire" ? renderCampfireSection(props, project, sectionData.data)
    : section === "files" ? renderFilesSection(props, project, sectionData.data)
    : section === "card_tables" ? renderCardTablesSection(props, project, sectionData.data)
    : renderPeopleSection(props, project, sectionData.data);

  const aiPrompt = askAiPromptForSection(section, project.name, sectionData.data);

  return html`
    <div class="project-section-content">
      <div class="row" style="gap: 8px; margin-bottom: 12px;">
        <button class="btn btn--sm" @click=${() => props.onLoadProjectSection(project.name, section)}>Refresh</button>
        <button class="btn btn--sm btn--primary" @click=${() => props.onPrefillChat(aiPrompt)}>Ask AI</button>
      </div>
      ${content}
    </div>
  `;
}

function renderEntityDetailCard(props: CommandCenterProps) {
  if (!props.selectedEntityLoading && !props.selectedEntityError && !props.selectedEntityDetail) return nothing;

  const detail = props.selectedEntityDetail;
  return html`
    <div class="card project-entity-detail">
      <div class="project-entity-detail__header">
        <div>
          <div class="card-title">Item Detail</div>
          <div class="card-sub">
            ${detail?.reference.label ?? detail?.reference.type ?? "Basecamp item"}
          </div>
        </div>
        <button class="btn btn--xs" @click=${() => props.onCloseItemDetail()}>Close</button>
      </div>

      ${props.selectedEntityLoading
        ? html`<div class="muted">Loading item details...</div>`
        : props.selectedEntityError
          ? html`<div class="callout danger">${props.selectedEntityError}</div>`
          : detail
            ? html`
                <div class="project-entity-detail__body">
                  <div class="project-entity-detail__title">${detail.title}</div>
                  <div class="project-entity-detail__chips">
                    <span class="chip chip--tiny">${detail.reference.type}</span>
                    ${detail.status ? html`<span class="chip chip--tiny">${detail.status}</span>` : nothing}
                    ${detail.project?.name ? html`<span class="chip chip--tiny">${detail.project.name}</span>` : nothing}
                    ${detail.creator ? html`<span class="chip chip--tiny">By ${detail.creator}</span>` : nothing}
                    ${detail.assignee ? html`<span class="chip chip--tiny">Assigned ${detail.assignee}</span>` : nothing}
                  </div>
                  ${detail.summary ? html`<div class="project-entity-detail__summary">${detail.summary}</div>` : nothing}
                  <div class="project-entity-detail__meta">
                    ${detail.createdAt ? html`<span>Created ${detail.createdAt.replace("T", " ").slice(0, 16)}</span>` : nothing}
                    ${detail.updatedAt ? html`<span>Updated ${detail.updatedAt.replace("T", " ").slice(0, 16)}</span>` : nothing}
                  </div>
                  <div class="row" style="gap:8px; flex-wrap:wrap;">
                    ${detail.appUrl ? html`<a class="btn btn--sm" href=${detail.appUrl} target="_blank" rel="noreferrer">Open in Basecamp</a>` : nothing}
                    <button
                      class="btn btn--sm btn--primary"
                      @click=${() =>
                        props.onPrefillChat(
                          `Explain this Basecamp ${detail.reference.type}: "${detail.title}". Include purpose, status, risks, and next actions.`,
                        )}
                    >
                      Ask AI
                    </button>
                  </div>
                  ${detail.comments.length > 0
                    ? html`
                        <div class="project-entity-detail__list">
                          <div class="project-entity-detail__list-title">Comments</div>
                          ${detail.comments.slice(0, 6).map((comment) => html`
                            <div class="project-entity-detail__list-item">
                              <div class="project-entity-detail__list-head">
                                <strong>${comment.author ?? "Unknown"}</strong>
                                ${comment.createdAt ? html`<span class="muted">${comment.createdAt.slice(0, 16).replace("T", " ")}</span>` : nothing}
                              </div>
                              <div class="muted">${comment.content ?? "(no comment text)"}</div>
                            </div>
                          `)}
                        </div>
                      `
                    : nothing}
                  ${detail.events.length > 0
                    ? html`
                        <div class="project-entity-detail__list">
                          <div class="project-entity-detail__list-title">Activity</div>
                          ${detail.events.slice(0, 6).map((event) => html`
                            <div class="project-entity-detail__list-item">
                              <div class="project-entity-detail__list-head">
                                <strong>${event.action ?? "event"}</strong>
                                ${event.createdAt ? html`<span class="muted">${event.createdAt.slice(0, 16).replace("T", " ")}</span>` : nothing}
                              </div>
                              <div class="muted">${event.actor ?? "Unknown"}${event.summary ? ` · ${event.summary}` : ""}</div>
                            </div>
                          `)}
                        </div>
                      `
                    : nothing}
                </div>
              `
            : nothing}
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
            ${tab === "overview" ? renderOverviewTab(props, project) : renderSectionTab(props, tab)}
          </div>
        </div>
      </div>
      <div class="projects-side">
        ${renderEntityDetailCard(props)}
        <div class="card projects-chat-card">
          <div class="ai-context-bar">
            <span class="ai-context-dot"></span>
            <span class="ai-context-label">AI sees: ${project.name} / ${DETAIL_TABS.find((t) => t.key === tab)?.label ?? tab}</span>
          </div>
          <div class="row projects-chat-shortcuts">
            <button class="btn btn--xs" @click=${() => props.onPrefillChat(`What are the most urgent todos in "${project.name}"?`)}>Urgent</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat(`Summarize the current state of "${project.name}" and suggest next steps.`)}>Summary</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat(`What's blocking progress in "${project.name}"?`)}>Blockers</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat(`Create a status update for "${project.name}" for stakeholders.`)}>Status Update</button>
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
  const assignedTodos = sortTodosLatestFirst(snapshot?.assignedTodos ?? []);
  const urgentTodos = sortTodosLatestFirst(snapshot?.urgentTodos ?? []);
  const dueTodayTodos = sortTodosLatestFirst(snapshot?.dueTodayTodos ?? []);
  const futureTodos = sortTodosLatestFirst(snapshot?.futureTodos ?? []);
  const noDueDateTodos = sortTodosLatestFirst(snapshot?.noDueDateTodos ?? []);
  const allCards = snapshot?.projects ?? [];
  const projectSearch = (props.projectSearch ?? "").trim().toLowerCase();
  const cards = projectSearch
    ? allCards.filter(
        (p) =>
          p.name.toLowerCase().includes(projectSearch) ||
          (p.description ?? "").toLowerCase().includes(projectSearch),
      )
    : allCards;
  const staleLabel =
    snapshot?.cacheAgeMs && snapshot.cacheAgeMs > 0
      ? formatRelativeTimestamp(Date.now() - snapshot.cacheAgeMs)
      : refreshedLabel;

  const viewMode = props.viewMode ?? "cards";
  const ccTab = props.commandCenterTab ?? "overview";
  const basecampStatusLabel = workspaceStatusLabel(snapshotLoaded, configured, hasBasecampAccess);

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
        ${renderWorkspaceHero(props, {
          snapshotLoaded,
          configured,
          hasBasecampAccess,
          refreshedLabel,
          identity,
          totals,
          cards,
        })}

        ${renderCommandCenterFocusStrip(props)}

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
          ${renderTodoList(props, "Assigned to Me", assignedTodos, "No assigned todos right now.")}
          ${renderTodoList(props, "Past Due", urgentTodos, "No overdue todos right now.")}
          ${renderTodoList(props, "Due Today", dueTodayTodos, "No todos due today.")}
          ${renderTodoList(props, "Future", futureTodos, "No upcoming todos in the visible queue.")}
          ${renderTodoList(props, "No Due Date", noDueDateTodos, "No unscheduled todos in the visible queue.")}
        </div>

        ${renderProjectRadar(props, cards)}
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

  const contextLabel = ccTab === "overview"
    ? `Workspace overview: ${totals.projectCount} projects, ${totals.overdueTodos} overdue, ${totals.dueTodayTodos} due today`
    : ccTab === "projects"
      ? `${cards.length} projects${projectSearch ? ` matching "${projectSearch}"` : ""}`
      : `Timeline: ${totals.openTodos} open todos`;

  return html`
    <section class="projects-layout">
      <div class="projects-main">
        <div class="card">
          <div class="projects-header-row">
            <div>
              <div class="card-title">Basecamp Command Center</div>
              <div class="card-sub">Live project data, PMOS triage, and AI-ready project drill-down.</div>
            </div>
            <div class="row" style="gap:8px; flex-wrap:wrap; align-items:center;">
              <input
                type="search"
                .value=${props.projectSearch ?? ""}
                @input=${(e: Event) => props.onProjectSearchChange((e.target as HTMLInputElement).value)}
                placeholder="Search projects..."
                style="padding:4px 10px; font-size:13px; border:1px solid var(--border); border-radius:var(--radius-sm,6px); background:var(--input-bg,var(--surface)); color:inherit; outline:none; width:160px;"
              />
              <button class="btn btn--sm" @click=${() => props.onOpenIntegrations()}>Integrations</button>
              <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onRefresh()}>
                ${props.loading ? "Syncing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div class="chip-row" style="margin-top: 8px;">
            <span class="chip ${workspaceStatusTone(snapshotLoaded, configured, hasBasecampAccess)}">
              ${basecampStatusLabel}
            </span>
            <span class="chip">Refreshed: ${refreshedLabel}</span>
            ${identity?.email ? html`<span class="chip">${identity.email}</span>` : nothing}
          </div>

          ${props.loading
            ? html`
                <div style="margin-top: 8px;">
                  <div class="progress-bar"><div class="progress-bar__fill progress-bar__fill--indeterminate"></div></div>
                </div>
              `
            : nothing}
          ${snapshot?.stale && snapshot?.staleReason
            ? html`<div class="callout warn" style="margin-top: 8px; font-size:12px;">${snapshot.staleReason}</div>`
            : props.error
              ? html`<div class="callout danger" style="margin-top: 8px; font-size:12px;">${props.error}</div>`
              : nothing}
          ${!props.connected
            ? html`<div class="callout danger" style="margin-top: 8px;">Connect to Wicked OS first.</div>`
            : snapshotLoaded && !hasBasecampAccess
              ? html`<div class="callout info" style="margin-top: 8px;">Add your Basecamp token in Integrations.</div>`
              : nothing}
        </div>

        ${tabStrip}

        ${tabContent()}
      </div>

      <div class="projects-side">
        <div class="card projects-chat-card">
          <div class="ai-context-bar">
            <span class="ai-context-dot"></span>
            <span class="ai-context-label">AI sees: ${contextLabel}</span>
          </div>
          <div class="row projects-chat-shortcuts">
            <button class="btn btn--xs" @click=${() => props.onPrefillChat("What do I need to do today in Basecamp? Start with overdue items, then due today, then the next best actions.")}>My Day</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat("What are the most important overdue todos in Basecamp right now? Group them by project and tell me what to do first.")}>Overdue</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat("What is due tomorrow in Basecamp? Group it by project and flag anything risky or blocked.")}>Tomorrow</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat("Which Basecamp projects need attention right now? Show the blockers, overdue work, owners, and the next 3 follow-ups.")}>Risk</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat("Search Basecamp for ")}>Search</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat("Create a todo in Basecamp: ")}>+ Todo</button>
            <button class="btn btn--xs" @click=${() => props.onPrefillChat("Create a message in Basecamp project ")}>+ Message</button>
          </div>
          <div class="projects-chat-host">
            ${renderChat(props.chatProps)}
          </div>
        </div>
      </div>
    </section>
  `;
}
