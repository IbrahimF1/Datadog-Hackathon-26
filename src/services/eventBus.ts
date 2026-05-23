import type { StreamStore } from "../storage/streamStore.js";
import { now } from "../util/id.js";

// The 5 WebSocket event types from TECH_SPEC §9.
export type EventType =
  | "delta_received"
  | "lock_changed"
  | "debate_update"
  | "sync_complete"
  | "task_update"
  | "presence";

export interface DomainEvent {
  event: EventType;
  projectId: string;
  payload: unknown;
  ts: string;
}

type Listener = (e: DomainEvent) => void;

// Spine of the system: every domain mutation emits an event, fanned out
// synchronously to WebSocket subscribers and mirrored (best-effort) into the
// ClickHouse `events` table.
export class EventBus {
  private byProject = new Map<string, Set<Listener>>();

  constructor(private readonly stream: StreamStore) {}

  subscribe(projectId: string, listener: Listener): () => void {
    let set = this.byProject.get(projectId);
    if (!set) {
      set = new Set();
      this.byProject.set(projectId, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit(event: EventType, projectId: string, payload: unknown): void {
    const e: DomainEvent = { event, projectId, payload, ts: now() };
    const set = this.byProject.get(projectId);
    if (set) {
      for (const l of set) {
        try {
          l(e);
        } catch {
          // a misbehaving subscriber must not break the emitter
        }
      }
    }
    void this.stream.appendEvent({
      projectId,
      type: event,
      ts: e.ts,
      payload,
    });
  }
}
