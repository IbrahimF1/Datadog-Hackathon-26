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

  async push(p: PushDeltaParams): Promise<ContextDelta> {
    const project = await this.store.getProject(p.projectId);
    if (!project) throw new NotFoundError("project");
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
      conflictsWith: await this.detectConflicts(
        p.projectId,
        p.taskId,
        p.type,
        affectedContracts,
      ),
      timestamp: now(),
    };

    await this.store.addDelta(delta);
    void this.stream.appendDelta(delta);

    if (p.taskId) {
      const task = await this.store.getTask(p.taskId);
      if (task) {
        await this.store.updateTask(p.taskId, {
          contextHistory: [...task.contextHistory, delta.id],
        });
      }
    }

    this.bus.emit("delta_received", p.projectId, { delta });
    return delta;
  }

  // Rule-based first pass: a contract_change referencing contract ids/names
  // conflicts with any OTHER non-done task whose interfaceContracts include them.
  private async detectConflicts(
    projectId: string,
    sourceTaskId: string | undefined,
    type: DeltaType,
    affectedContracts: string[],
  ): Promise<string[]> {
    if (type !== "contract_change" || affectedContracts.length === 0) return [];
    const conflicts = new Set<string>();
    const tasks = await this.store.listTasks(projectId);
    for (const task of tasks) {
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

  async getDeltas(
    projectId: string,
    sessionId: string,
    since?: string,
  ): Promise<{ deltas: ContextDelta[]; requiresAction: boolean }> {
    let deltas = await this.store.listDeltas(projectId);
    if (since) deltas = deltas.filter((d) => d.timestamp > since);

    const requiresAction = deltas.some(
      (d) =>
        d.sourceSessionId !== sessionId &&
        !d.acknowledgedBy.includes(sessionId) &&
        (d.conflictsWith.length > 0 || d.severity === "blocking"),
    );
    return { deltas, requiresAction };
  }

  async ack(projectId: string, deltaId: string, sessionId: string): Promise<ContextDelta> {
    const delta = await this.store.getDelta(deltaId);
    if (!delta || delta.projectId !== projectId) {
      throw new NotFoundError("delta");
    }
    if (!delta.acknowledgedBy.includes(sessionId)) {
      return await this.store.updateDelta(deltaId, {
        acknowledgedBy: [...delta.acknowledgedBy, sessionId],
      });
    }
    return delta;
  }
}
