import type {
  ContextDelta,
  DeltaSeverity,
  DeltaType,
} from "../domain/types.js";
import type { LiveStore } from "../storage/liveStore.js";
import type { StreamStore } from "../storage/streamStore.js";
import { NotFoundError } from "./errors.js";
import type { EventBus } from "./eventBus.js";
import { newId, now } from "../util/id.js";

export interface PushDeltaParams {
  projectId: string;
  sessionId: string;
  taskId?: string;
  type: DeltaType;
  content: string;
  severity: DeltaSeverity;
  affectedContracts?: string[];
}

export class DeltaService {
  constructor(
    private readonly store: LiveStore,
    private readonly bus: EventBus,
    private readonly stream: StreamStore,
  ) {}

  push(p: PushDeltaParams): ContextDelta {
    if (!this.store.getProject(p.projectId)) {
      throw new NotFoundError("project");
    }
    const affectedContracts = p.affectedContracts ?? [];
    const delta: ContextDelta = {
      id: newId("delta"),
      projectId: p.projectId,
      taskId: p.taskId,
      sourceSessionId: p.sessionId,
      type: p.type,
      content: p.content,
      severity: p.severity,
      affectedContracts,
      acknowledgedBy: [],
      conflictsWith: this.detectConflicts(
        p.projectId,
        p.taskId,
        p.type,
        affectedContracts,
      ),
      timestamp: now(),
    };

    this.store.addDelta(delta);
    void this.stream.appendDelta(delta);

    if (p.taskId) {
      const task = this.store.getTask(p.taskId);
      if (task) {
        this.store.updateTask(p.taskId, {
          contextHistory: [...task.contextHistory, delta.id],
        });
      }
    }

    this.bus.emit("delta_received", p.projectId, { delta });
    return delta;
  }

  // Rule-based first pass: a contract_change referencing contract ids/names
  // conflicts with any OTHER non-done task whose interfaceContracts include them.
  private detectConflicts(
    projectId: string,
    sourceTaskId: string | undefined,
    type: DeltaType,
    affectedContracts: string[],
  ): string[] {
    if (type !== "contract_change" || affectedContracts.length === 0) return [];
    const conflicts = new Set<string>();
    for (const task of this.store.listTasks(projectId)) {
      if (task.id === sourceTaskId || task.status === "done") continue;
      const references = task.interfaceContracts.some(
        (c) =>
          affectedContracts.includes(c.id) ||
          affectedContracts.includes(c.name),
      );
      if (references) conflicts.add(task.id);
    }
    return [...conflicts];
  }

  getDeltas(
    projectId: string,
    sessionId: string,
    since?: string,
  ): { deltas: ContextDelta[]; requiresAction: boolean } {
    let deltas = this.store.listDeltas(projectId);
    if (since) deltas = deltas.filter((d) => d.timestamp > since);

    const requiresAction = deltas.some(
      (d) =>
        d.sourceSessionId !== sessionId &&
        !d.acknowledgedBy.includes(sessionId) &&
        (d.conflictsWith.length > 0 || d.severity === "blocking"),
    );
    return { deltas, requiresAction };
  }

  ack(projectId: string, deltaId: string, sessionId: string): ContextDelta {
    const delta = this.store.getDelta(deltaId);
    if (!delta || delta.projectId !== projectId) {
      throw new NotFoundError("delta");
    }
    if (!delta.acknowledgedBy.includes(sessionId)) {
      return this.store.updateDelta(deltaId, {
        acknowledgedBy: [...delta.acknowledgedBy, sessionId],
      });
    }
    return delta;
  }
}
