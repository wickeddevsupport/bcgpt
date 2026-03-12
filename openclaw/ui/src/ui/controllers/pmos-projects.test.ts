import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPmosProjectsSnapshot,
  type PmosProjectsSnapshot,
  type PmosProjectsState,
} from "./pmos-projects.ts";

function createSnapshot(): PmosProjectsSnapshot {
  return {
    workspaceId: "ws-1",
    configured: true,
    connected: true,
    connectorUrl: "https://bcgpt.wickedlab.io",
    identity: {
      connected: true,
      email: "owner@example.com",
    },
    totals: {
      projectCount: 1,
      syncedProjects: 1,
      openTodos: 3,
      assignedTodos: 1,
      overdueTodos: 1,
      dueTodayTodos: 1,
      futureTodos: 1,
      noDueDateTodos: 0,
    },
    projects: [
      {
        id: "p1",
        name: "Ops",
        status: "active",
        appUrl: null,
        todoLists: 1,
        openTodos: 3,
        assignedTodos: 1,
        overdueTodos: 1,
        dueTodayTodos: 1,
        futureTodos: 1,
        noDueDateTodos: 0,
        nextDueOn: "2026-03-06",
        health: "attention",
      },
    ],
    assignedTodos: [],
    urgentTodos: [],
    dueTodayTodos: [],
    futureTodos: [],
    noDueDateTodos: [],
    errors: [],
    refreshedAtMs: Date.now() - 5_000,
  };
}

function createState(): PmosProjectsState {
  return {
    connected: true,
    client: null,
    pmosProjectsLoading: false,
    pmosProjectsError: null,
    pmosProjectsSnapshot: null,
  };
}

describe("pmos-projects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the last successful snapshot when refresh times out", async () => {
    const state = createState();
    state.pmosProjectsSnapshot = createSnapshot();
    state.client = {
      request: vi.fn(() => new Promise(() => {})),
    } as any;

    const loadPromise = loadPmosProjectsSnapshot(state);
    await vi.advanceTimersByTimeAsync(18_001);
    await loadPromise;

    expect(state.pmosProjectsLoading).toBe(false);
    expect(state.pmosProjectsError).toContain("Showing the last successful snapshot");
    expect(state.pmosProjectsSnapshot?.stale).toBe(true);
    expect(state.pmosProjectsSnapshot?.refreshing).toBe(false);
  });

  it("clears stale markers after a successful refresh", async () => {
    const state = createState();
    state.pmosProjectsSnapshot = {
      ...createSnapshot(),
      stale: true,
      staleReason: "old error",
    };
    state.client = {
      request: vi.fn(async () => ({
        ...createSnapshot(),
        refreshedAtMs: Date.now(),
      })),
    } as any;

    await loadPmosProjectsSnapshot(state);

    expect(state.pmosProjectsError).toBeNull();
    expect(state.pmosProjectsSnapshot?.stale).toBe(false);
    expect(state.pmosProjectsSnapshot?.refreshing).toBe(false);
    expect(state.pmosProjectsSnapshot?.staleReason).toBeNull();
  });
});
