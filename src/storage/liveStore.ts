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

// Mutable, live coordination state. Implementations support both SYNC (InMemory)
// and ASYNC (ClickHouse) patterns. For async stores, callers must await to ensure
// read-modify-write sequences complete before next operation.
export interface LiveStore {
  // Projects
  createProject(p: Project): Promise<Project> | Project;
  getProject(id: string): Promise<Project | undefined> | Project | undefined;
  updateProject(id: string, patch: Partial<Project>): Promise<Project> | Project;
  listProjects(): Promise<Project[]> | Project[];

  // Phases
  createPhase(p: Phase): Promise<Phase> | Phase;
  getPhase(id: string): Promise<Phase | undefined> | Phase | undefined;
  updatePhase(id: string, patch: Partial<Phase>): Promise<Phase> | Phase;
  listPhases(projectId: string): Promise<Phase[]> | Phase[];

  // Tasks
  createTask(t: Task): Promise<Task> | Task;
  getTask(id: string): Promise<Task | undefined> | Task | undefined;
  updateTask(id: string, patch: Partial<Task>): Promise<Task> | Task;
  listTasks(projectId: string): Promise<Task[]> | Task[];

  // Locks
  addLock(l: FileLock): Promise<FileLock> | FileLock;
  getLock(lockId: string): Promise<FileLock | undefined> | FileLock | undefined;
  removeLock(lockId: string): Promise<void> | void;
  listLocks(projectId: string): Promise<FileLock[]> | FileLock[];
  listAllLocks(): Promise<FileLock[]> | FileLock[];

  // Sessions
  upsertSession(s: Session): Promise<Session> | Session;
  getSession(id: string): Promise<Session | undefined> | Session | undefined;
  touchSession(id: string): Promise<void> | void;
  listSessions(projectId: string): Promise<Session[]> | Session[];

  // Deltas (current mutable state; history is appended to the StreamStore)
  addDelta(d: ContextDelta): Promise<ContextDelta> | ContextDelta;
  getDelta(id: string): Promise<ContextDelta | undefined> | ContextDelta | undefined;
  updateDelta(id: string, patch: Partial<ContextDelta>): Promise<ContextDelta> | ContextDelta;
  listDeltas(projectId: string): Promise<ContextDelta[]> | ContextDelta[];

  // Debates
  createDebate(d: Debate): Promise<Debate> | Debate;
  getDebate(id: string): Promise<Debate | undefined> | Debate | undefined;
  updateDebate(id: string, patch: Partial<Debate>): Promise<Debate> | Debate;
  listDebates(projectId: string): Promise<Debate[]> | Debate[];

  // Sync coordination
  getSyncToken(projectId: string): Promise<SyncToken | undefined> | SyncToken | undefined;
  setSyncToken(token: SyncToken): Promise<void> | void;
  clearSyncToken(projectId: string): Promise<void> | void;
  addSyncRecord(r: SyncRecord): Promise<void> | void;
  listSyncRecords(projectId: string): Promise<SyncRecord[]> | SyncRecord[];
}
