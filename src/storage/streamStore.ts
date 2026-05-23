import type { ContextDelta, DebateMessage } from "../domain/types.js";

export interface StreamEvent {
  projectId: string;
  type: string;
  ts: string;
  payload: unknown;
}

export interface AuditEntry {
  projectId: string;
  sessionId: string;
  action: string;
  ts: string;
  detail: unknown;
}

// Append-only history, backed by ClickHouse (OLAP sweet spot). All methods are
// best-effort: a failure to reach ClickHouse must never crash a coordination
// action, so implementations log and continue.
export interface StreamStore {
  init(): Promise<void>;
  appendDelta(d: ContextDelta): Promise<void>;
  appendDebateMessage(m: DebateMessage): Promise<void>;
  appendEvent(e: StreamEvent): Promise<void>;
  appendAudit(a: AuditEntry): Promise<void>;
  recentEvents(projectId: string, limit: number): Promise<StreamEvent[]>;
  healthy(): boolean;
}
