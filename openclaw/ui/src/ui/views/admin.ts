import { html, nothing } from "lit";
import type { PmosAuditEvent, PmosMember, PmosMemberStatus, PmosRole } from "../controllers/pmos-admin.ts";
import { formatRelativeTimestamp } from "../format.ts";

export type AdminProps = {
  connected: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;

  workspaceId: string;
  workspaceName: string;
  currentUserName: string;
  currentUserEmail: string;
  currentUserRole: PmosRole;
  canManageMembers: boolean;

  memberDraftName: string;
  memberDraftEmail: string;
  memberDraftRole: PmosRole;
  memberDraftStatus: PmosMemberStatus;

  members: PmosMember[];
  auditEvents: PmosAuditEvent[];

  onWorkspaceIdChange: (next: string) => void;
  onWorkspaceNameChange: (next: string) => void;
  onCurrentUserNameChange: (next: string) => void;
  onCurrentUserEmailChange: (next: string) => void;
  onCurrentUserRoleChange: (next: PmosRole) => void;
  onSave: () => void;
  onRefresh: () => void;

  onMemberDraftNameChange: (next: string) => void;
  onMemberDraftEmailChange: (next: string) => void;
  onMemberDraftRoleChange: (next: PmosRole) => void;
  onMemberDraftStatusChange: (next: PmosMemberStatus) => void;
  onUpsertMember: () => void;
  onRemoveMember: (email: string) => void;

  // Remove-member confirm state
  memberRemoveConfirm: string | null;
  onMemberRemoveConfirmSet: (email: string | null) => void;

  // Super-admin: workspace list
  isSuperAdmin?: boolean;
  workspacesList?: Array<{ workspaceId: string; ownerEmail: string; ownerName: string; ownerRole: string; createdAtMs: number }>;
  workspacesLoading?: boolean;
  workspacesError?: string | null;
  onLoadWorkspaces?: () => void;
};

const ROLE_DESCRIPTIONS: Record<PmosRole, string> = {
  system_admin: "Full access to all workspaces and system settings",
  workspace_admin: "Can manage members, agents, and all workspace settings",
  member: "Can use agents and automations, cannot manage members",
  viewer: "Read-only access — cannot chat or modify anything",
};

function roleLabel(role: PmosRole): string {
  switch (role) {
    case "system_admin": return "System Admin";
    case "workspace_admin": return "Workspace Admin";
    case "member": return "Member";
    case "viewer": return "Viewer";
    default: return role;
  }
}

function friendlyAction(action: string): string {
  const MAP: Record<string, string> = {
    "agent.create": "Created agent",
    "agent.update": "Updated agent",
    "agent.delete": "Deleted agent",
    "workspace.config.set": "Changed workspace settings",
    "workspace.member.upsert": "Added/updated member",
    "workspace.member.remove": "Removed member",
    "byok.set": "Saved AI key",
    "byok.clear": "Removed AI key",
    "workflow.create": "Created workflow",
    "workflow.delete": "Deleted workflow",
    "workflow.status.set": "Changed workflow status",
  };
  return MAP[action] ?? action;
}

export function renderAdmin(props: AdminProps) {
  const disabledReason = !props.connected
    ? "Sign in to your workspace to manage settings."
    : null;

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Workspace Identity</div>
        <div class="card-sub">Your workspace profile and your account details.</div>

        <div class="form-grid" style="margin-top: 14px;">
          <label class="field">
            <span>Workspace ID <span class="muted">(read-only)</span></span>
            <div class="row" style="gap: 8px; align-items: center;">
              <code class="mono" style="padding: 8px 10px; background: var(--surface2, var(--surface)); border-radius: 6px; border: 1px solid var(--border); flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${props.workspaceId}</code>
              <button
                class="btn btn--sm btn--secondary"
                @click=${() => navigator.clipboard?.writeText(props.workspaceId)}
                title="Copy workspace ID"
              >Copy</button>
            </div>
          </label>
          <label class="field">
            <span>Workspace Name</span>
            <input
              .value=${props.workspaceName}
              @input=${(e: Event) => props.onWorkspaceNameChange((e.target as HTMLInputElement).value)}
              ?disabled=${!props.connected || props.saving}
            />
          </label>
          <label class="field">
            <span>Your Name</span>
            <input
              .value=${props.currentUserName}
              @input=${(e: Event) => props.onCurrentUserNameChange((e.target as HTMLInputElement).value)}
              ?disabled=${!props.connected || props.saving}
            />
          </label>
          <label class="field">
            <span>Your Email</span>
            <input
              .value=${props.currentUserEmail}
              @input=${(e: Event) => props.onCurrentUserEmailChange((e.target as HTMLInputElement).value)}
              ?disabled=${!props.connected || props.saving}
            />
          </label>
          <label class="field">
            <span>Your Role</span>
            <select
              .value=${props.currentUserRole}
              @change=${(e: Event) => props.onCurrentUserRoleChange((e.target as HTMLSelectElement).value as PmosRole)}
              ?disabled=${!props.connected || props.saving}
            >
              <option value="workspace_admin" title=${ROLE_DESCRIPTIONS.workspace_admin}>Workspace Admin</option>
              <option value="member" title=${ROLE_DESCRIPTIONS.member}>Member</option>
              <option value="viewer" title=${ROLE_DESCRIPTIONS.viewer}>Viewer</option>
              <option value="system_admin" title=${ROLE_DESCRIPTIONS.system_admin}>System Admin</option>
            </select>
            <span class="muted" style="font-size: 11px; margin-top: 4px;">${ROLE_DESCRIPTIONS[props.currentUserRole] ?? ""}</span>
          </label>
        </div>

        <div class="row" style="margin-top: 12px;">
          <button class="btn btn--primary" ?disabled=${!props.connected || props.saving} @click=${() => props.onSave()}>
            ${props.saving ? "Saving..." : "Save"}
          </button>
          <button class="btn btn--secondary" ?disabled=${!props.connected || props.loading} @click=${() => props.onRefresh()}>
            ${props.loading ? "Loading..." : "Reload"}
          </button>
        </div>

        ${disabledReason ? html`<div class="muted" style="margin-top: 12px;">${disabledReason}</div>` : nothing}
        ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}
      </div>

      <div class="card">
        <div class="card-title">Workspace Members</div>
        <div class="card-sub">Control who has access and what they can do.</div>

        <div class="form-grid" style="margin-top: 14px;">
          <label class="field">
            <span>Name</span>
            <input
              .value=${props.memberDraftName}
              @input=${(e: Event) => props.onMemberDraftNameChange((e.target as HTMLInputElement).value)}
              placeholder="Jane Doe"
              ?disabled=${!props.connected || props.saving || !props.canManageMembers}
            />
          </label>
          <label class="field">
            <span>Email</span>
            <input
              .value=${props.memberDraftEmail}
              @input=${(e: Event) => props.onMemberDraftEmailChange((e.target as HTMLInputElement).value)}
              placeholder="jane@company.com"
              ?disabled=${!props.connected || props.saving || !props.canManageMembers}
            />
          </label>
          <label class="field">
            <span>Role</span>
            <select
              .value=${props.memberDraftRole}
              @change=${(e: Event) => props.onMemberDraftRoleChange((e.target as HTMLSelectElement).value as PmosRole)}
              ?disabled=${!props.connected || props.saving || !props.canManageMembers}
            >
              <option value="workspace_admin" title=${ROLE_DESCRIPTIONS.workspace_admin}>Workspace Admin</option>
              <option value="member" title=${ROLE_DESCRIPTIONS.member}>Member</option>
              <option value="viewer" title=${ROLE_DESCRIPTIONS.viewer}>Viewer</option>
            </select>
            <span class="muted" style="font-size: 11px; margin-top: 4px;">${ROLE_DESCRIPTIONS[props.memberDraftRole] ?? ""}</span>
          </label>
          <label class="field">
            <span>Status</span>
            <select
              .value=${props.memberDraftStatus}
              @change=${(e: Event) =>
                props.onMemberDraftStatusChange((e.target as HTMLSelectElement).value as PmosMemberStatus)}
              ?disabled=${!props.connected || props.saving || !props.canManageMembers}
            >
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>

        <div class="row" style="margin-top: 12px;">
          <button
            class="btn btn--primary"
            ?disabled=${!props.connected || props.saving || !props.canManageMembers || !props.memberDraftEmail.trim()}
            @click=${() => props.onUpsertMember()}
          >
            Add / Update Member
          </button>
          ${!props.canManageMembers
            ? html`<span class="muted">Your role cannot edit membership.</span>`
            : nothing}
        </div>

        <div class="list" style="margin-top: 14px; max-height: 300px; overflow: auto;">
          ${props.members.map(
            (member) => html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${member.name}</div>
                  <div class="list-sub mono">${member.email}</div>
                  <div class="list-sub">
                    ${roleLabel(member.role)} · ${member.status}
                  </div>
                </div>
                <div class="list-meta">
                  <span class="muted">${formatRelativeTimestamp(Date.parse(member.updatedAt) || Date.now())}</span>
                  ${props.canManageMembers
                    ? props.memberRemoveConfirm === member.email
                      ? html`
                          <span class="muted" style="font-size:12px;">Remove?</span>
                          <button class="btn btn--sm btn--danger" @click=${() => { props.onRemoveMember(member.email); props.onMemberRemoveConfirmSet(null); }}>
                            Confirm
                          </button>
                          <button class="btn btn--sm" @click=${() => props.onMemberRemoveConfirmSet(null)}>
                            Cancel
                          </button>
                        `
                      : html`
                          <button class="btn btn--sm" @click=${() => props.onMemberRemoveConfirmSet(member.email)}>
                            Remove
                          </button>
                        `
                    : nothing}
                </div>
              </div>
            `,
          )}
          ${props.members.length === 0 ? html`<div class="muted">No workspace members configured.</div>` : nothing}
        </div>
      </div>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Audit Feed</div>
      <div class="card-sub">Recent admin-level changes to this workspace.</div>
      <div class="list" style="margin-top: 12px; max-height: 320px; overflow: auto;">
        ${props.auditEvents.slice(0, 80).map(
          (event) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${friendlyAction(event.action)}</div>
                <div class="list-sub">${event.target}${event.detail ? ` — ${event.detail}` : ""}</div>
                <div class="list-sub muted">${event.actor}</div>
              </div>
              <div class="list-meta">
                <span class="chip ${event.status === "error"
                  ? "chip-danger"
                  : event.status === "success"
                    ? "chip-ok"
                    : ""}">${event.status}</span>
                <span class="muted">${formatRelativeTimestamp(event.ts)}</span>
              </div>
            </div>
          `,
        )}
        ${props.auditEvents.length === 0 ? html`<div class="muted">No audit events yet.</div>` : nothing}
      </div>
    </section>

    ${props.isSuperAdmin ? html`
      <section class="card" style="margin-top: 18px;">
        <div class="card-title">All Workspaces</div>
        <div class="card-sub">All registered workspaces — visible to system admins only.</div>
        <div class="row" style="margin-top: 12px;">
          <button
            class="btn btn--secondary"
            @click=${() => props.onLoadWorkspaces?.()}
            ?disabled=${props.workspacesLoading}
          >
            ${props.workspacesLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
        ${props.workspacesError ? html`<div class="callout danger" style="margin-top: 10px;">${props.workspacesError}</div>` : nothing}
        <div class="list" style="margin-top: 12px;">
          ${(props.workspacesList ?? []).map((ws) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${ws.ownerName || ws.ownerEmail}</div>
                <div class="list-sub mono" style="font-size:11px;">${ws.workspaceId}</div>
                <div class="list-sub muted">${ws.ownerEmail} · Created ${new Date(ws.createdAtMs).toLocaleDateString()}</div>
              </div>
              <div class="list-meta">
                <span class="chip">${roleLabel(ws.ownerRole as PmosRole)}</span>
              </div>
            </div>
          `)}
          ${(props.workspacesList ?? []).length === 0 && !props.workspacesLoading
            ? html`<div class="muted" style="margin-top: 8px;">No workspaces loaded yet.</div>`
            : nothing}
        </div>
      </section>
    ` : nothing}
  `;
}
