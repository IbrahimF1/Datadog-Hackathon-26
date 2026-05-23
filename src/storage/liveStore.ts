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

// Mutable, live coordination state. Implementations are SYNCHRONOUS so that
// read-modify-write sequences (lock acquisition, sync-token claim) are atomic
// on Node's single thread with no interleaving await points. Moving to an
// async store later requires an explicit locking strategy.
export interface LiveStore {
  // Projects
  createProject(p: Project): Project;
  getProject(id: string): Project | undefined;
  updateProject(id: string, patch: Partial<Project>): Project;
  listProjects(): Project[];

  // Phases
  createPhase(p: Phase): Phase;
  getPhase(id: string): Phase | undefined;
  updatePhase(id: string, patch: Partial<Phase>): Phase;
  listPhases(projectId: string): Phase[];

  // Tasks
  createTask(t: Task): Task;
  getTask(id: string): Task | undefined;
  updateTask(id: string, patch: Partial<Task>): Task;
  listTasks(projectId: string): Task[];

  // Locks
  addLock(l: FileLock): FileLock;
  getLock(lockId: string): FileLock | undefined;
  removeLock(lockId: string): void;
  listLocks(projectId: string): FileLock[];
  listAllLocks(): FileLock[];

  // Sessions
  upsertSession(s: Session): Session;
  getSession(id: string): Session | undefined;
  touchSession(id: string): void;
  listSessions(projectId: string): Session[];

  // Deltas (current mutable state; history is appended to the StreamStore)
  addDelta(d: ContextDelta): ContextDelta;
  getDelta(id: string): ContextDelta | undefined;
  updateDelta(id: string, patch: Partial<ContextDelta>): ContextDelta;
  listDeltas(projectId: string): ContextDelta[];

  // Debates
  createDebate(d: Debate): Debate;
  getDebate(id: string): Debate | undefined;
  updateDebate(id: string, patch: Partial<Debate>): Debate;
  listDebates(projectId: string): Debate[];

  // Sync coordination
  getSyncToken(projectId: string): SyncToken | undefined;
  setSyncToken(token: SyncToken): void;
  clearSyncToken(projectId: string): void;
  addSyncRecord(r: SyncRecord): void;
  listSyncRecords(projectId: string): SyncRecord[];
}
