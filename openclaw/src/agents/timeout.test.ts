import { describe, expect, it } from "vitest";
import {
  AGENT_NO_TIMEOUT_MS,
  DEFAULT_AGENT_TIMEOUT_SECONDS,
  resolveAgentTimeoutMs,
  resolveAgentTimeoutSeconds,
} from "./timeout.js";

describe("resolveAgentTimeoutMs", () => {
  it("defaults agent runs to no timeout", () => {
    expect(DEFAULT_AGENT_TIMEOUT_SECONDS).toBe(0);
    expect(resolveAgentTimeoutSeconds()).toBe(0);
    expect(resolveAgentTimeoutMs({})).toBe(AGENT_NO_TIMEOUT_MS);
  });

  it("treats configured timeoutSeconds 0 as no timeout", () => {
    expect(resolveAgentTimeoutSeconds({ agents: { defaults: { timeoutSeconds: 0 } } } as never)).toBe(0);
    expect(resolveAgentTimeoutMs({ cfg: { agents: { defaults: { timeoutSeconds: 0 } } } as never })).toBe(
      AGENT_NO_TIMEOUT_MS,
    );
  });

  it("uses a timer-safe sentinel for no-timeout overrides", () => {
    expect(resolveAgentTimeoutMs({ overrideSeconds: 0 })).toBe(AGENT_NO_TIMEOUT_MS);
    expect(resolveAgentTimeoutMs({ overrideMs: 0 })).toBe(AGENT_NO_TIMEOUT_MS);
  });

  it("clamps very large timeout overrides to timer-safe values", () => {
    expect(resolveAgentTimeoutMs({ overrideSeconds: 9_999_999 })).toBe(AGENT_NO_TIMEOUT_MS);
    expect(resolveAgentTimeoutMs({ overrideMs: 9_999_999_999 })).toBe(AGENT_NO_TIMEOUT_MS);
  });
});
