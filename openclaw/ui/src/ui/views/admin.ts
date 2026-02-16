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
};

function roleLabel(role: PmosRole): string {
  switch (role) {
    case "system_admin":
      return "System Admin";
    case "workspace_admin":
      return "Workspace Admin";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}

export function renderAdmin(props: AdminProps) {
  const disabledReason = !props.connected
    ? "Connect to PMOS first (Dashboard -> Access Key -> Connect)."
    : null;
  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Workspace Identity</div>
        <div class="card-sub">PMOS workspace profile, owner identity, and role defaults.</div>

        <div class="form-grid" style="margin-top: 14px;">
          <label class="field">
            <span>Workspace ID</span>
            <input
              .value=${props.workspaceId}
              @input=${(e: Event) => props.onWorkspaceIdChange((e.target as HTMLInputElement).value)}
              ?disabled=${!props.connected || props.saving}
            />
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
              <option value="system_admin">System Admin</option>
              <option value="workspace_admin">Workspace Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
        </div>

        <div class="row" style="margin-top: 12px;">
          <button class="btn primary" ?disabled=${!props.connected || props.saving} @click=${() => props.onSave()}>
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
        <div class="card-sub">Role-based access controls for PMOS operations.</div>

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
              <option value="workspace_admin">Workspace Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="system_admin">System Admin</option>
            </select>
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
            class="btn"
            ?disabled=${!props.connected || props.saving || !props.canManageMembers}
            @click=${() => props.onUpsertMember()}
          >
            Upsert member
          </button>
          ${!props.canManageMembers
            ? html`<span class="muted">Current role cannot edit membership.</span>`
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
                    ? html`
                        <button class="btn btn--sm danger" @click=${() => props.onRemoveMember(member.email)}>
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
      <div class="card-sub">Admin-level PMOS changes and command-center actions.</div>
      <div class="list" style="margin-top: 12px; max-height: 320px; overflow: auto;">
        ${props.auditEvents.slice(0, 80).map(
          (event) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${event.action}</div>
                <div class="list-sub">${event.target}${event.detail ? ` · ${event.detail}` : ""}</div>
                <div class="list-sub mono">${event.actor}</div>
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
  `;
}
