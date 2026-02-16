import type { PmosRole as PmosAdminRole } from "./pmos-admin.ts";

export type PmosAuthRole = "super_admin" | "workspace_admin" | "member" | "viewer";

export type PmosAuthUser = {
  id: string;
  name: string;
  email: string;
  role: PmosAuthRole;
  workspaceId: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastLoginAtMs?: number;
};

type PmosAuthState = {
  basePath: string;
  pmosAuthLoading: boolean;
  pmosAuthAuthenticated: boolean;
  pmosAuthError: string | null;
  pmosAuthMode: "signin" | "signup";
  pmosAuthName: string;
  pmosAuthEmail: string;
  pmosAuthPassword: string;
  pmosAuthUser: PmosAuthUser | null;
  pmosCurrentUserName: string;
  pmosCurrentUserEmail: string;
  pmosCurrentUserRole: PmosAdminRole;
};

type AuthResponse = {
  ok: boolean;
  status?: number;
  error?: string;
  authenticated?: boolean;
  user?: PmosAuthUser;
};

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

function resolveAuthEndpoint(basePath: string, suffix: string): string {
  const normalized = normalizeBasePath(basePath);
  const path = `/api/pmos/auth/${suffix}`;
  return normalized ? `${normalized}${path}` : path;
}

async function requestAuth(
  state: PmosAuthState,
  suffix: string,
  init: RequestInit,
): Promise<AuthResponse> {
  const response = await fetch(resolveAuthEndpoint(state.basePath, suffix), {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  let parsed: AuthResponse | null = null;
  try {
    parsed = (await response.json()) as AuthResponse;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: parsed?.error || `Auth request failed (${response.status})`,
      authenticated: false,
    };
  }
  const base =
    parsed && typeof parsed === "object"
      ? parsed
      : {
          ok: false,
          error: "Invalid auth response.",
          authenticated: false,
        };
  return { ...base, status: response.status };
}

function applyAuthenticatedUser(state: PmosAuthState, user: PmosAuthUser): void {
  state.pmosAuthUser = user;
  state.pmosAuthAuthenticated = true;
  state.pmosAuthError = null;
  state.pmosCurrentUserName = user.name;
  state.pmosCurrentUserEmail = user.email;
  state.pmosCurrentUserRole = user.role === "super_admin" ? "system_admin" : user.role;
}

function clearAuthState(state: PmosAuthState): void {
  state.pmosAuthAuthenticated = false;
  state.pmosAuthUser = null;
  state.pmosCurrentUserName = "";
  state.pmosCurrentUserEmail = "";
  state.pmosCurrentUserRole = "workspace_admin";
}

export async function loadPmosAuthSession(state: PmosAuthState): Promise<void> {
  state.pmosAuthLoading = true;
  state.pmosAuthError = null;
  try {
    const result = await requestAuth(state, "me", {
      method: "GET",
    });
    if (result.ok && result.user) {
      applyAuthenticatedUser(state, result.user);
      return;
    }
    // Only clear auth state on explicit auth failures. If the server is temporarily
    // unavailable, keep the last known user to avoid UI flicker on navigation.
    if (result.status === 401 || result.status === 403) {
      clearAuthState(state);
    } else {
      state.pmosAuthError = result.error || "Failed to restore session.";
      if (!state.pmosAuthAuthenticated) {
        clearAuthState(state);
      }
    }
  } catch (err) {
    state.pmosAuthError = String(err);
    if (!state.pmosAuthAuthenticated) {
      clearAuthState(state);
    }
  } finally {
    state.pmosAuthLoading = false;
  }
}

export async function signupPmosAuth(state: PmosAuthState): Promise<boolean> {
  state.pmosAuthLoading = true;
  state.pmosAuthError = null;
  try {
    const result = await requestAuth(state, "signup", {
      method: "POST",
      body: JSON.stringify({
        name: state.pmosAuthName,
        email: state.pmosAuthEmail,
        password: state.pmosAuthPassword,
      }),
    });
    if (!result.ok || !result.user) {
      state.pmosAuthError = result.error || "Sign up failed.";
      return false;
    }
    applyAuthenticatedUser(state, result.user);
    state.pmosAuthPassword = "";
    return true;
  } catch (err) {
    state.pmosAuthError = String(err);
    return false;
  } finally {
    state.pmosAuthLoading = false;
  }
}

export async function loginPmosAuth(state: PmosAuthState): Promise<boolean> {
  state.pmosAuthLoading = true;
  state.pmosAuthError = null;
  try {
    const result = await requestAuth(state, "login", {
      method: "POST",
      body: JSON.stringify({
        email: state.pmosAuthEmail,
        password: state.pmosAuthPassword,
      }),
    });
    if (!result.ok || !result.user) {
      state.pmosAuthError = result.error || "Sign in failed.";
      return false;
    }
    applyAuthenticatedUser(state, result.user);
    state.pmosAuthPassword = "";
    return true;
  } catch (err) {
    state.pmosAuthError = String(err);
    return false;
  } finally {
    state.pmosAuthLoading = false;
  }
}

export async function logoutPmosAuth(state: PmosAuthState): Promise<void> {
  state.pmosAuthLoading = true;
  state.pmosAuthError = null;
  try {
    await requestAuth(state, "logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (err) {
    state.pmosAuthError = String(err);
  } finally {
    clearAuthState(state);
    state.pmosAuthLoading = false;
  }
}
