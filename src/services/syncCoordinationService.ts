import type { Phase, SyncToken } from "../domain/types.js";
import type { LiveStore } from "../storage/liveStore.js";
import type { StreamStore } from "../storage/streamStore.js";
import { NotFoundError, SyncBusyError, ValidationError } from "./errors.js";
import type { EventBus } from "./eventBus.js";
import { now } from "../util/id.js";

export interface SyncStartResult {
  status: "go" | "wait";
  token?: SyncToken;
  pullShas: string[];
  heldBy?: string;
}

// The server never pushes. It serializes pushes with a per-project sync token
// and evaluates phase-boundary sync barriers ("merge points"). Sessions do all
// git work; merge points only confirm everyone is on the same peer-progress HEAD.
export class SyncCoordinationService {
  constructor(
    private readonly store: LiveStore,
    private readonly bus: EventBus,
    private readonly stream: StreamStore,
  ) {}

  // A session is about to push: grant a serialized token + tell it what to pull.
  startSync(projectId: string, sessionId: string): SyncStartResult {
    if (!this.store.getProject(projectId)) throw new NotFoundError("project");

    const existing = this.store.getSyncToken(projectId);
    if (existing && existing.sessionId !== sessionId) {
      throw new SyncBusyError(existing.sessionId);
    }

    const token: SyncToken = { projectId, sessionId, acquiredAt: now() };
    this.store.setSyncToken(token);

    const records = this.store.listSyncRecords(projectId);
    const myLast = [...records].reverse().find((r) => r.sessionId === sessionId);
    const sinceTs = myLast?.syncedAt ?? "";
    const pullShas = [
      ...new Set(
        records
          .filter((r) => r.sessionId !== sessionId && r.syncedAt > sinceTs)
          .map((r) => r.commitSha),
      ),
    ];

    void this.stream.appendAudit({
      projectId,
      sessionId,
      action: "sync_start",
      ts: token.acquiredAt,
      detail: { pullShas },
    });
    return { status: "go", token, pullShas };
  }

  // A session finished pushing; record its new HEAD and release the token.
  completeSync(
    projectId: string,
    sessionId: string,
    commitSha: string,
  ): { ok: true; mergePointsReached: string[] } {
    const token = this.store.getSyncToken(projectId);
    if (!token || token.sessionId !== sessionId) {
      throw new ValidationError("you do not hold the sync token");
    }
    if (!commitSha?.trim()) throw new ValidationError("commitSha is required");

    this.store.addSyncRecord({ projectId, sessionId, commitSha, syncedAt: now() });
    this.store.clearSyncToken(projectId);
    this.bus.emit("sync_complete", projectId, { sessionId, commitSha });
    void this.stream.appendAudit({
      projectId,
      sessionId,
      action: "sync_complete",
      ts: now(),
      detail: { commitSha },
    });

    const reached: string[] = [];
    for (const phase of this.store.listPhases(projectId)) {
      const before = phase.mergePoint.reached;
      const updated = this.evaluatePhase(phase.id);
      if (updated && updated.mergePoint.reached && !before) reached.push(phase.id);
    }
    return { ok: true, mergePointsReached: reached };
  }

  releaseToken(projectId: string, sessionId: string): void {
    const token = this.store.getSyncToken(projectId);
    if (token && token.sessionId === sessionId) {
      this.store.clearSyncToken(projectId);
    }
  }

  // Merge-point barrier: all phase tasks at merge_point/done (locks contracts),
  // and every involved session sitting on the same latest peer-progress HEAD.
  evaluatePhase(phaseId: string): Phase | undefined {
    const phase = this.store.getPhase(phaseId);
    if (!phase) return undefined;
    const project = this.store.getProject(phase.projectId);
    if (!project) return phase;

    const tasks = phase.taskIds
      .map((id) => this.store.getTask(id))
      .filter((t): t is NonNullable<typeof t> => !!t);

    const barrierReady =
      tasks.length > 0 &&
      tasks.every((t) => t.status === "merge_point" || t.status === "done");
    if (!barrierReady) return phase;

    // Lock contracts the moment the barrier precondition is met.
    if (!phase.contractsLocked) {
      for (const t of tasks) {
        if (t.interfaceContracts.length === 0) continue;
        const locked = t.interfaceContracts.map((c) => ({ ...c, locked: true }));
        this.store.updateTask(t.id, { interfaceContracts: locked });
      }
    }

    // Involved sessions = sessions of members assigned to this phase's tasks.
    const involved = new Set<string>();
    for (const t of tasks) {
      if (!t.assigneeId) continue;
      const member = project.team.find((m) => m.id === t.assigneeId);
      if (member?.claudeSessionId) involved.add(member.claudeSessionId);
    }

    const records = this.store.listSyncRecords(phase.projectId);
    const latestSha = records[records.length - 1]?.commitSha;
    const lastShaBySession = new Map<string, string>();
    for (const r of records) lastShaBySession.set(r.sessionId, r.commitSha);

    const allInSync =
      involved.size > 0 &&
      latestSha !== undefined &&
      [...involved].every((s) => lastShaBySession.get(s) === latestSha);

    const updated = this.store.updatePhase(phaseId, {
      contractsLocked: true,
      mergePoint: {
        reached: allInSync,
        syncedSessionIds: [...involved].filter(
          (s) => lastShaBySession.get(s) === latestSha,
        ),
        headSha: latestSha,
      },
    });

    if (allInSync && !phase.mergePoint.reached) {
      this.bus.emit("task_update", phase.projectId, {
        type: "merge_point_reached",
        phaseId,
        headSha: latestSha,
      });
    }
    return updated;
  }
}
