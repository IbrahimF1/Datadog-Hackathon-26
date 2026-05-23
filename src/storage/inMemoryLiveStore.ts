import type {
  ContextDelta,
  Debate,
  FileLock,
  Phase,
  Project,
  Session,
  SyncRecord,
  SyncToken,
  Task,
} from "../domain/types.js";
import { NotFoundError } from "../services/errors.js";
import type { LiveStore } from "./liveStore.js";

export class InMemoryLiveStore implements LiveStore {
  private projects = new Map<string, Project>();
  private phases = new Map<string, Phase>();
  private tasks = new Map<string, Task>();
  private locks = new Map<string, FileLock>();
  private sessions = new Map<string, Session>();
  private deltas = new Map<string, ContextDelta>();
  private debates = new Map<string, Debate>();
  private syncTokens = new Map<string, SyncToken>();
  private syncRecords: SyncRecord[] = [];

  // Projects
  createProject(p: Project): Project {
    this.projects.set(p.id, p);
    return p;
  }
  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }
  updateProject(id: string, patch: Partial<Project>): Project {
    const cur = this.projects.get(id);
    if (!cur) throw new NotFoundError("project");
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.projects.set(id, next);
    return next;
  }
  listProjects(): Project[] {
    return [...this.projects.values()];
  }

  // Phases
  createPhase(p: Phase): Phase {
    this.phases.set(p.id, p);
    return p;
  }
  getPhase(id: string): Phase | undefined {
    return this.phases.get(id);
  }
  updatePhase(id: string, patch: Partial<Phase>): Phase {
    const cur = this.phases.get(id);
    if (!cur) throw new NotFoundError("phase");
    const next = { ...cur, ...patch };
    this.phases.set(id, next);
    return next;
  }
  listPhases(projectId: string): Phase[] {
    return [...this.phases.values()]
      .filter((p) => p.projectId === projectId)
      .sort((a, b) => a.order - b.order);
  }

  // Tasks
  createTask(t: Task): Task {
    this.tasks.set(t.id, t);
    return t;
  }
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }
  updateTask(id: string, patch: Partial<Task>): Task {
    const cur = this.tasks.get(id);
    if (!cur) throw new NotFoundError("task");
    const next = { ...cur, ...patch };
    this.tasks.set(id, next);
    return next;
  }
  listTasks(projectId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.projectId === projectId);
  }

  // Locks
  addLock(l: FileLock): FileLock {
    this.locks.set(l.lockId, l);
    return l;
  }
  getLock(lockId: string): FileLock | undefined {
    return this.locks.get(lockId);
  }
  removeLock(lockId: string): void {
    this.locks.delete(lockId);
  }
  listLocks(projectId: string): FileLock[] {
    return [...this.locks.values()].filter((l) => l.projectId === projectId);
  }
  listAllLocks(): FileLock[] {
    return [...this.locks.values()];
  }

  // Sessions
  upsertSession(s: Session): Session {
    this.sessions.set(s.id, s);
    return s;
  }
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  touchSession(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.lastSeen = new Date().toISOString();
  }
  listSessions(projectId: string): Session[] {
    return [...this.sessions.values()].filter(
      (s) => s.projectId === projectId,
    );
  }

  // Deltas
  addDelta(d: ContextDelta): ContextDelta {
    this.deltas.set(d.id, d);
    return d;
  }
  getDelta(id: string): ContextDelta | undefined {
    return this.deltas.get(id);
  }
  updateDelta(id: string, patch: Partial<ContextDelta>): ContextDelta {
    const cur = this.deltas.get(id);
    if (!cur) throw new NotFoundError("delta");
    const next = { ...cur, ...patch };
    this.deltas.set(id, next);
    return next;
  }
  listDeltas(projectId: string): ContextDelta[] {
    return [...this.deltas.values()]
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // Debates
  createDebate(d: Debate): Debate {
    this.debates.set(d.id, d);
    return d;
  }
  getDebate(id: string): Debate | undefined {
    return this.debates.get(id);
  }
  updateDebate(id: string, patch: Partial<Debate>): Debate {
    const cur = this.debates.get(id);
    if (!cur) throw new NotFoundError("debate");
    const next = { ...cur, ...patch };
    this.debates.set(id, next);
    return next;
  }
  listDebates(projectId: string): Debate[] {
    return [...this.debates.values()].filter(
      (d) => d.projectId === projectId,
    );
  }

  // Sync coordination
  getSyncToken(projectId: string): SyncToken | undefined {
    return this.syncTokens.get(projectId);
  }
  setSyncToken(token: SyncToken): void {
    this.syncTokens.set(token.projectId, token);
  }
  clearSyncToken(projectId: string): void {
    this.syncTokens.delete(projectId);
  }
  addSyncRecord(r: SyncRecord): void {
    this.syncRecords.push(r);
  }
  listSyncRecords(projectId: string): SyncRecord[] {
    return this.syncRecords.filter((r) => r.projectId === projectId);
  }
}
