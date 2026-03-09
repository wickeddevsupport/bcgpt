import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type { ChatProps } from "./chat.ts";
import { renderChat } from "./chat.ts";
import type { PmosProjectCard, PmosProjectTodoItem, PmosProjectsSnapshot } from "../controllers/pmos-projects.ts";

export type CommandCenterProps = {
  connected: boolean;
  loading: boolean;
  error: string | null;
  snapshot: PmosProjectsSnapshot | null;
  projectSearch: string;
  chatProps: ChatProps;
  onRefresh: () => void;
  onOpenIntegrations: () => void;
  onOpenWorkflows: () => void;
  onPrefillChat: (prompt: string) => void;
  onProjectSearchChange: (next: string) => void;
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
        ${items.slice(0, 8).map(
          (todo) => html`
            <div class="project-priority-item">
              <div class="project-priority-item__title">${todo.title}</div>
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
                <span class="muted">Overdue</span>
                <strong>${project.overdueTodos}</strong>
              </div>
              <div class="project-card__metric">
                <span class="muted">Due today</span>
                <strong>${project.dueTodayTodos}</strong>
              </div>
              <div class="project-card__metric">
                <span class="muted">Todo lists</span>
                <strong>${project.todoLists}</strong>
              </div>
            </div>
            <div class="project-card__meta">
              <span>Next due</span>
              <span class="mono">${project.nextDueOn ?? "n/a"}</span>
            </div>
            <div class="project-card__actions">
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

export function renderCommandCenter(props: CommandCenterProps) {
  const snapshot = props.snapshot;
  const totals = snapshot?.totals ?? {
    projectCount: 0,
    syncedProjects: 0,
    openTodos: 0,
    overdueTodos: 0,
    dueTodayTodos: 0,
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
  const urgentTodos = snapshot?.urgentTodos ?? [];
  const dueTodayTodos = snapshot?.dueTodayTodos ?? [];
  const allCards = snapshot?.projects ?? [];
  const projectSearch = (props.projectSearch ?? "").trim().toLowerCase();
  const cards = projectSearch
    ? allCards.filter((p) => p.name.toLowerCase().includes(projectSearch))
    : allCards;
  const staleLabel =
    snapshot?.cacheAgeMs && snapshot.cacheAgeMs > 0
      ? formatRelativeTimestamp(Date.now() - snapshot.cacheAgeMs)
      : refreshedLabel;

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
            <span
              class="chip ${!snapshotLoaded ? "" : hasBasecampAccess ? "chip-ok" : "chip-danger"}"
            >
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
            ? html`
                <div class="callout warn" style="margin-top: 12px;">
                  Latest refresh failed. Showing the last successful snapshot from ${staleLabel}. ${snapshot.staleReason}
                </div>
              `
            : props.error
              ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
              : nothing}
          ${errors.length > 0
            ? html`<div class="callout info" style="margin-top: 12px;">${errors[0]}</div>`
            : nothing}

          ${!props.connected
            ? html`
                <div class="callout danger" style="margin-top: 12px;">
                  Connect to Wicked OS first to load Projects.
                </div>
              `
            : snapshotLoaded && !hasBasecampAccess
              ? html`
                  <div class="callout info" style="margin-top: 12px;">
                    Add your Basecamp token in Integrations to enable project cards and AI project actions.
                  </div>
                `
              : nothing}
        </div>

        <div class="project-stats-grid">
          <div class="stat project-stat-card">
            <div class="stat-label">Projects</div>
            <div class="stat-value">${totals.projectCount}</div>
            <div class="muted">Synced cards: ${totals.syncedProjects}</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">Open Todos</div>
            <div class="stat-value">${totals.openTodos}</div>
            <div class="muted">Across synced projects</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">Overdue</div>
            <div class="stat-value ${totals.overdueTodos > 0 ? "warn" : "ok"}">${totals.overdueTodos}</div>
            <div class="muted">Urgent follow-up required</div>
          </div>
          <div class="stat project-stat-card">
            <div class="stat-label">Due Today</div>
            <div class="stat-value ${totals.dueTodayTodos > 0 ? "warn" : "ok"}">${totals.dueTodayTodos}</div>
            <div class="muted">Needs same-day action</div>
          </div>
        </div>

        <div class="project-priority-grid">
          ${renderTodoList("Urgent / Overdue", urgentTodos, "No overdue todos right now.")}
          ${renderTodoList("Due Today", dueTodayTodos, "No todos due today.")}
        </div>

        <div class="card">
          <div class="projects-header-row">
            <div>
              <div class="card-title">Project Cards</div>
              <div class="card-sub">Operational cards with health and action shortcuts.</div>
            </div>
          </div>
          ${cards.length > 0
            ? renderProjectCards(props, cards)
            : allCards.length > 0
              ? html`<div class="muted" style="margin-top: 12px;">No projects match "${props.projectSearch}".</div>`
              : html`<div class="muted" style="margin-top: 12px;">No project cards available yet.</div>`}
        </div>
      </div>

      <div class="projects-side">
        <div class="card projects-chat-card">
          <div class="card-title">Project Copilot</div>
          <div class="card-sub">
            Ask for updates, blockers, summaries, or direct actions in Basecamp. The same chat engine is available here.
          </div>
          <div class="row projects-chat-shortcuts" style="margin-top: 10px;">
            <button
              class="btn btn--sm"
              @click=${() =>
                props.onPrefillChat("Give me a daily project brief: urgent tasks, overdue items, and what to do next.")}
            >
              Daily Brief
            </button>
            <button
              class="btn btn--sm"
              @click=${() =>
                props.onPrefillChat("List all Basecamp projects and flag high-risk items with owners and due dates.")}
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
