// Domain model — implements TECH_SPEC §2 plus coordination additions.

export type Role = "frontend" | "backend" | "devops" | "fullstack";

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "review"
  | "merge_point"
  | "done";

export type ContractType =
  | "api_endpoint"
  | "type_definition"
  | "database_schema"
  | "function_signature";

export type DeltaType =
  | "discovery"
  | "contract_change"
  | "dependency_found"
  | "scope_change";

export type DeltaSeverity = "info" | "warning" | "blocking";

export type DebateStatus = "active" | "resolved" | "escalated";

export type ProjectStatus = "planning" | "active" | "completed";

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  skills: string[];
  claudeSessionId?: string;
  confidenceScores: Record<string, number>;
}

export interface Contract {
  id: string;
  type: ContractType;
  name: string;
  definition: string;
  locked: boolean;
  approvedBy: string[];
}

export interface FileLock {
  lockId: string;
  projectId: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  lockedBy: string; // session id
  reason: string;
  lockedAt: string;
  expiresAt: string;
}

export interface ContextDelta {
  id: string;
  projectId: string;
  taskId?: string;
  sourceSessionId: string;
  type: DeltaType;
  content: string;
  severity: DeltaSeverity;
  affectedContracts: string[];
  acknowledgedBy: string[];
  conflictsWith: string[]; // task ids this delta conflicts with
  timestamp: string;
}

export interface DebateMessage {
  id: string;
  debateId: string;
  projectId: string;
  sessionId: string;
  round: number;
  message: string;
  proposeResolution: boolean;
  timestamp: string;
}

export interface Debate {
  id: string;
  projectId: string;
  topic: string;
  conflictingDeltaId?: string;
  initiatorSessionId: string;
  responderSessionId?: string;
  status: DebateStatus;
  round: number;
  position: string;
  constraints: string[];
  proposedAlternatives: string[];
  proposedResolution?: string;
  messages: DebateMessage[];
  lastActivityAt: string;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  phaseId: string;
  title: string;
  description: string;
  assigneeId?: string;
  status: TaskStatus;
  dependencies: string[];
  requiredSkills: string[];
  interfaceContracts: Contract[];
  contextHistory: string[]; // delta ids
}

export interface MergePointState {
  reached: boolean;
  syncedSessionIds: string[];
  headSha?: string;
}

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  order: number;
  taskIds: string[];
  mergePoint: MergePointState;
  contractsLocked: boolean;
}

export interface PlanningQuestion {
  memberId: string;
  question: string;
  answer?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  githubRepo: string;
  githubBranch: "peer-progress";
  status: ProjectStatus;
  team: TeamMember[];
  phaseIds: string[];
  questions: PlanningQuestion[];
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  memberId?: string;
  connectedAt: string;
  lastSeen: string;
}

export interface SyncRecord {
  projectId: string;
  sessionId: string;
  commitSha: string;
  syncedAt: string;
}

// The single global sync token enforcing serialized pushes per project.
export interface SyncToken {
  projectId: string;
  sessionId: string;
  acquiredAt: string;
}
