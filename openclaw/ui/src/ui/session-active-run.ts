type SessionLike = {
  key?: string;
  hasActiveRun?: boolean;
  activeRunId?: string;
};

type RememberedRunStore = Record<string, number>;

const STORAGE_KEY = "openclaw.ui.completedSessionRuns";
const REMEMBERED_RUN_TTL_MS = 30 * 60 * 1000;

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return null;
    }
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readRememberedRunStore(now: number): RememberedRunStore {
  const storage = getSessionStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: RememberedRunStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "number") {
        continue;
      }
      if (now - value > REMEMBERED_RUN_TTL_MS) {
        continue;
      }
      next[key] = value;
    }
    return next;
  } catch {
    return {};
  }
}

function writeRememberedRunStore(store: RememberedRunStore): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  try {
    const keys = Object.keys(store);
    if (keys.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage write failures; they should not block chat recovery.
  }
}

function runStoreKey(sessionKey: string, runId: string): string {
  return `${sessionKey}::${runId}`;
}

export function rememberCompletedSessionRun(sessionKey: string, runId: string, now = Date.now()): void {
  const normalizedSessionKey = sessionKey.trim();
  const normalizedRunId = runId.trim();
  if (!normalizedSessionKey || !normalizedRunId) {
    return;
  }
  const store = readRememberedRunStore(now);
  store[runStoreKey(normalizedSessionKey, normalizedRunId)] = now;
  writeRememberedRunStore(store);
}

export function hasRememberedCompletedSessionRun(sessionKey: string, runId: string, now = Date.now()): boolean {
  const normalizedSessionKey = sessionKey.trim();
  const normalizedRunId = runId.trim();
  if (!normalizedSessionKey || !normalizedRunId) {
    return false;
  }
  const store = readRememberedRunStore(now);
  writeRememberedRunStore(store);
  return typeof store[runStoreKey(normalizedSessionKey, normalizedRunId)] === "number";
}

export function resolveBlockingRecoveredSessionRun(params: {
  sessionKey: string;
  sessions?: SessionLike[] | null;
  localRunId?: string | null;
  localStream?: string | null;
  localSending?: boolean;
  compactionActive?: boolean;
}): boolean {
  const currentKey = params.sessionKey.trim();
  if (!currentKey) {
    return false;
  }
  const activeSession = params.sessions?.find((row) => {
    const rowKey = typeof row?.key === "string" ? row.key.trim() : "";
    return rowKey === currentKey;
  });
  if (!activeSession) {
    return false;
  }
  const remoteRunId = typeof activeSession.activeRunId === "string" ? activeSession.activeRunId.trim() : "";
  const hasRemoteActiveRun = activeSession.hasActiveRun === true || Boolean(remoteRunId);
  if (!hasRemoteActiveRun) {
    return false;
  }
  if (remoteRunId && hasRememberedCompletedSessionRun(currentKey, remoteRunId)) {
    return false;
  }
  if (
    params.compactionActive === true &&
    !params.localSending &&
    !params.localRunId &&
    !params.localStream
  ) {
    return false;
  }
  return true;
}