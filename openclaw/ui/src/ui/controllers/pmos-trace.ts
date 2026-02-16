export type PmosExecutionTraceStatus = "running" | "success" | "error" | "info";

export type PmosExecutionTraceEvent = {
  id: string;
  ts: number;
  source: "chat" | "tool" | "system";
  kind: string;
  status: PmosExecutionTraceStatus;
  title: string;
  detail?: string;
  runId?: string;
  sessionKey?: string;
};

const TRACE_LIMIT = 200;
const TRACE_DETAIL_LIMIT = 800;

function truncate(value: string, max = TRACE_DETAIL_LIMIT): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

export function summarizeTraceValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text ? truncate(text) : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return truncate(String(value));
  }
}

export function appendPmosTraceEvent(
  host: { pmosTraceEvents: PmosExecutionTraceEvent[] },
  event: Omit<PmosExecutionTraceEvent, "id" | "ts"> & { id?: string; ts?: number },
) {
  const id =
    event.id?.trim() ||
    `${event.source}:${event.kind}:${event.runId ?? "none"}:${event.sessionKey ?? "none"}:${Date.now()}`;
  const ts = typeof event.ts === "number" ? event.ts : Date.now();
  const next: PmosExecutionTraceEvent = {
    id,
    ts,
    source: event.source,
    kind: event.kind,
    status: event.status,
    title: event.title,
    detail: event.detail,
    runId: event.runId,
    sessionKey: event.sessionKey,
  };

  const existingIndex = host.pmosTraceEvents.findIndex((entry) => entry.id === id);
  if (existingIndex >= 0) {
    const prev = host.pmosTraceEvents[existingIndex];
    if (
      prev.ts === next.ts &&
      prev.status === next.status &&
      prev.title === next.title &&
      prev.detail === next.detail &&
      prev.kind === next.kind
    ) {
      return;
    }
    const copy = [...host.pmosTraceEvents];
    copy.splice(existingIndex, 1);
    host.pmosTraceEvents = [next, ...copy].slice(0, TRACE_LIMIT);
    return;
  }

  host.pmosTraceEvents = [next, ...host.pmosTraceEvents].slice(0, TRACE_LIMIT);
}
