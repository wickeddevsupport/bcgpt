import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSnapshot } from "../types.ts";

export type PmosRole = "system_admin" | "workspace_admin" | "member" | "viewer";
export type PmosMemberStatus = "active" | "invited" | "disabled";

export type PmosMember = {
  id: string;
  email: string;
  name: string;
  role: PmosRole;
  status: PmosMemberStatus;
  createdAt: string;
  updatedAt: string;
};

export type PmosAuditEvent = {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target: string;
  detail?: string;
  status: "info" | "success" | "error";
};

type DeepRecord = Record<string, unknown>;

export type PmosAdminState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  configSnapshot: ConfigSnapshot | null;

  pmosAdminDraftsInitialized: boolean;
  pmosAdminLoading: boolean;
  pmosAdminSaving: boolean;
  pmosAdminError: string | null;

  pmosWorkspaceId: string;
  pmosWorkspaceName: string;

  pmosCurrentUserName: string;
  pmosCurrentUserEmail: string;
  pmosCurrentUserRole: PmosRole;

  pmosMembers: PmosMember[];
  pmosMemberDraftName: string;
  pmosMemberDraftEmail: string;
  pmosMemberDraftRole: PmosRole;
  pmosMemberDraftStatus: PmosMemberStatus;

  pmosAuditEvents: PmosAuditEvent[];
};

function deepClone<T>(value: T): T {
  return value && typeof value === "object" ? (JSON.parse(JSON.stringify(value)) as T) : value;
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as DeepRecord)[key];
  }
  return cur;
}

function setPath(obj: DeepRecord, path: string[], value: unknown) {
  let cur: DeepRecord = obj;
  for (let i = 0; i < path.length; i++) {
    const key = path[i]!;
    if (i === path.length - 1) {
      cur[key] = value;
      return;
    }
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as DeepRecord;
  }
}

function deletePath(obj: DeepRecord, path: string[]) {
  let cur: DeepRecord = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cur = next as DeepRecord;
  }
  delete cur[path[path.length - 1]!];
}

function normalizeRole(value: unknown): PmosRole {
  if (
    value === "system_admin" ||
    value === "workspace_admin" ||
    value === "member" ||
    value === "viewer"
  ) {
    return value;
  }
  return "member";
}

function normalizeStatus(value: unknown): PmosMemberStatus {
  if (value === "active" || value === "invited" || value === "disabled") {
    return value;
  }
  return "active";
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMembers(value: unknown): PmosMember[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const members: PmosMember[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const row = item as DeepRecord;
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    if (!email) {
      continue;
    }
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : nextId("member");
    const createdAt =
      typeof row.createdAt === "string" && row.createdAt.trim() ? row.createdAt.trim() : toIsoNow();
    const updatedAt =
      typeof row.updatedAt === "string" && row.updatedAt.trim() ? row.updatedAt.trim() : createdAt;
    members.push({
      id,
      email,
      name: name || email,
      role: normalizeRole(row.role),
      status: normalizeStatus(row.status),
      createdAt,
      updatedAt,
    });
  }
  members.sort((a, b) => a.email.localeCompare(b.email));
  return members;
}

function normalizeAudit(value: unknown): PmosAuditEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const events: PmosAuditEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const row = item as DeepRecord;
    const ts = typeof row.ts === "number" && Number.isFinite(row.ts) ? row.ts : Date.now();
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : nextId("audit");
    const actor = typeof row.actor === "string" ? row.actor : "system";
    const action = typeof row.action === "string" ? row.action : "unknown";
    const target = typeof row.target === "string" ? row.target : "pmos";
    const detail = typeof row.detail === "string" ? row.detail : undefined;
    const status =
      row.status === "success" || row.status === "error" || row.status === "info"
        ? row.status
        : "info";
    events.push({ id, ts, actor, action, target, detail, status });
  }
  events.sort((a, b) => b.ts - a.ts);
  return events.slice(0, 200);
}

function buildCurrentActor(state: Pick<PmosAdminState, "pmosCurrentUserEmail" | "pmosCurrentUserName">): string {
  const email = state.pmosCurrentUserEmail.trim().toLowerCase();
  if (email) {
    return email;
  }
  const name = state.pmosCurrentUserName.trim();
  return name || "system";
}

function buildAuditEvent(
  state: PmosAdminState,
  params: { action: string; target: string; detail?: string; status?: "info" | "success" | "error" },
): PmosAuditEvent {
  return {
    id: nextId("audit"),
    ts: Date.now(),
    actor: buildCurrentActor(state),
    action: params.action,
    target: params.target,
    detail: params.detail,
    status: params.status ?? "success",
  };
}

function roleRank(role: PmosRole): number {
  switch (role) {
    case "system_admin":
      return 4;
    case "workspace_admin":
      return 3;
    case "member":
      return 2;
    case "viewer":
      return 1;
    default:
      return 0;
  }
}

export function canManagePmosMembers(state: Pick<PmosAdminState, "pmosCurrentUserRole">): boolean {
  return roleRank(state.pmosCurrentUserRole) >= roleRank("workspace_admin");
}

export function hydratePmosAdminFromConfig(state: PmosAdminState) {
  if (state.pmosAdminDraftsInitialized) {
    return;
  }
  const cfg = state.configSnapshot?.config ?? null;

  const workspaceId = getPath(cfg, ["pmos", "identity", "workspace", "id"]);
  const workspaceName = getPath(cfg, ["pmos", "identity", "workspace", "name"]);
  const profileName = getPath(cfg, ["pmos", "identity", "currentUser", "name"]);
  const profileEmail = getPath(cfg, ["pmos", "identity", "currentUser", "email"]);
  const profileRole = getPath(cfg, ["pmos", "identity", "currentUser", "role"]);
  const members = getPath(cfg, ["pmos", "identity", "members"]);
  const audit = getPath(cfg, ["pmos", "audit", "events"]);

  state.pmosWorkspaceId =
    typeof workspaceId === "string" && workspaceId.trim() ? workspaceId.trim() : "default";
  state.pmosWorkspaceName =
    typeof workspaceName === "string" && workspaceName.trim() ? workspaceName.trim() : "PMOS Workspace";
  state.pmosCurrentUserName =
    typeof profileName === "string" && profileName.trim() ? profileName.trim() : "";
  state.pmosCurrentUserEmail =
    typeof profileEmail === "string" && profileEmail.trim() ? profileEmail.trim().toLowerCase() : "";
  state.pmosCurrentUserRole = normalizeRole(profileRole);
  state.pmosMembers = normalizeMembers(members);
  state.pmosAuditEvents = normalizeAudit(audit);

  state.pmosAdminDraftsInitialized = true;
}

export async function loadPmosAdminState(state: PmosAdminState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosAdminLoading = true;
  state.pmosAdminError = null;
  try {
    const snapshot = await state.client.request<ConfigSnapshot>("config.get", {});
    state.configSnapshot = snapshot;
    state.pmosAdminDraftsInitialized = false;
    hydratePmosAdminFromConfig(state);
  } catch (err) {
    state.pmosAdminError = String(err);
  } finally {
    state.pmosAdminLoading = false;
  }
}

export async function savePmosAdminState(
  state: PmosAdminState,
  opts?: { action?: string; target?: string; detail?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosAdminSaving = true;
  state.pmosAdminError = null;
  try {
    const snapshot = await state.client.request<ConfigSnapshot>("config.get", {});
    const baseHash = snapshot.hash;
    if (!baseHash) {
      state.pmosAdminError = "Config hash missing; reload and retry.";
      return;
    }
    const nextConfig = deepClone((snapshot.config ?? {}) as DeepRecord);

    const workspaceId = state.pmosWorkspaceId.trim() || "default";
    const workspaceName = state.pmosWorkspaceName.trim() || "PMOS Workspace";
    setPath(nextConfig, ["pmos", "identity", "workspace", "id"], workspaceId);
    setPath(nextConfig, ["pmos", "identity", "workspace", "name"], workspaceName);

    const profileName = state.pmosCurrentUserName.trim();
    const profileEmail = state.pmosCurrentUserEmail.trim().toLowerCase();
    if (profileName) {
      setPath(nextConfig, ["pmos", "identity", "currentUser", "name"], profileName);
    } else {
      deletePath(nextConfig, ["pmos", "identity", "currentUser", "name"]);
    }
    if (profileEmail) {
      setPath(nextConfig, ["pmos", "identity", "currentUser", "email"], profileEmail);
    } else {
      deletePath(nextConfig, ["pmos", "identity", "currentUser", "email"]);
    }
    setPath(nextConfig, ["pmos", "identity", "currentUser", "role"], state.pmosCurrentUserRole);

    const members = state.pmosMembers.map((member) => ({
      ...member,
      email: member.email.trim().toLowerCase(),
      name: member.name.trim() || member.email.trim().toLowerCase(),
      updatedAt: member.updatedAt || toIsoNow(),
    }));
    setPath(nextConfig, ["pmos", "identity", "members"], members);

    const existingAudit = normalizeAudit(getPath(nextConfig, ["pmos", "audit", "events"]));
    const nextAudit = [
      buildAuditEvent(state, {
        action: opts?.action ?? "pmos.admin.save",
        target: opts?.target ?? "identity",
        detail: opts?.detail,
      }),
      ...existingAudit,
    ].slice(0, 200);
    setPath(nextConfig, ["pmos", "audit", "events"], nextAudit);

    const raw = JSON.stringify(nextConfig, null, 2).trimEnd().concat("\n");
    await state.client.request("config.set", { raw, baseHash });

    state.configSnapshot = snapshot;
    state.pmosAuditEvents = nextAudit;
  } catch (err) {
    state.pmosAdminError = String(err);
  } finally {
    state.pmosAdminSaving = false;
  }
}

export function upsertPmosMember(
  state: Pick<
    PmosAdminState,
    | "pmosMembers"
    | "pmosMemberDraftEmail"
    | "pmosMemberDraftName"
    | "pmosMemberDraftRole"
    | "pmosMemberDraftStatus"
    | "pmosAdminError"
  >,
) {
  const email = state.pmosMemberDraftEmail.trim().toLowerCase();
  const name = state.pmosMemberDraftName.trim();
  if (!email) {
    state.pmosAdminError = "Member email is required.";
    return;
  }
  const now = toIsoNow();
  const existingIndex = state.pmosMembers.findIndex((entry) => entry.email === email);
  if (existingIndex >= 0) {
    const current = state.pmosMembers[existingIndex]!;
    const next: PmosMember = {
      ...current,
      name: name || current.name,
      role: state.pmosMemberDraftRole,
      status: state.pmosMemberDraftStatus,
      updatedAt: now,
    };
    const copy = [...state.pmosMembers];
    copy[existingIndex] = next;
    state.pmosMembers = copy;
    return;
  }
  const nextMember: PmosMember = {
    id: nextId("member"),
    email,
    name: name || email,
    role: state.pmosMemberDraftRole,
    status: state.pmosMemberDraftStatus,
    createdAt: now,
    updatedAt: now,
  };
  state.pmosMembers = [...state.pmosMembers, nextMember].sort((a, b) => a.email.localeCompare(b.email));
}

export function removePmosMember(
  state: Pick<PmosAdminState, "pmosMembers" | "pmosAdminError">,
  email: string,
) {
  const target = email.trim().toLowerCase();
  if (!target) {
    return;
  }
  const next = state.pmosMembers.filter((entry) => entry.email !== target);
  if (next.length === state.pmosMembers.length) {
    state.pmosAdminError = `Member not found: ${target}`;
    return;
  }
  state.pmosMembers = next;
}
