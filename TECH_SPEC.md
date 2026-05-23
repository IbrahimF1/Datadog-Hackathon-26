# PeerCode: Technical Specification

## System Overview

A web-based project orchestration platform where multiple Claude Code sessions coordinate through a central server, featuring visual planning (tree roadmap + Kanban), real-time MCP-based agent communication, file-level concurrency control, and automated GitHub synchronization.

---

## Architecture Components

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web App UI    │────▶│  PeerCode API   │◄────│   GitHub API    │
│ (React/Next.js) │     │   Server        │     │  (peer-progress │
└─────────────────┘     └────────┬────────┘     │     branch)     │
                                 │                └─────────────────┘
                    ┌────────────┼────────────┐
                    │            │            │
              ┌─────▼─────┐ ┌────▼────┐ ┌────▼────┐
              │  Claude A │ │ Claude B│ │ Claude C│
              │  (MCP)    │ │  (MCP)  │ │  (MCP)  │
              └───────────┘ └─────────┘ └─────────┘
```

---

## 1. Web Application

### Pages/Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing + new project creation |
| `/project/[id]` | Main workspace with dual-pane view |
| `/project/[id]/plan` | Vertical tree roadmap view |
| `/project/[id]/board` | Kanban board view |
| `/project/[id]/graph` | Dependency graph visualization |
| `/team/[id]` | Team member profiles + assignments |

### Core UI Components

**Dual-Pane Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  NAV: [Plan] [Board] [Graph] | Project: E-Commerce API v2   │
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│   ROADMAP (Vertical Tree)    │     KANBAN BOARD             │
│                              │                              │
│   Phase 1: Auth System       │   ┌─────────────────────┐     │
│   ├── Login Module           │   │ TODO                │     │
│   ├── OAuth Integration      │   ├─────────────────────┤     │
│   └── Session Management     │   │ • OAuth Integration │     │
│        (IN PROGRESS - Alice) │   │ • Payment Gateway   │     │
│                              │   └─────────────────────┘     │
│   Phase 2: Core API          │   ┌─────────────────────┐     │
│   ├── REST Endpoints         │   │ IN PROGRESS         │     │
│   ├── GraphQL Schema         │   ├─────────────────────┤     │
│   └── Validation Layer       │   │ • Login Module      │     │
│                              │   │   (Alice)           │     │
│   Phase 3: Integrations      │   └─────────────────────┘     │
│   └── ...                    │   ┌─────────────────────┐     │
│                              │   │ MERGE POINTS 🔒      │     │
│   🔒 MERGE POINT: Auth API   │   ├─────────────────────┤     │
│   Contract Locked            │   │ • Auth API Contract │     │
│                              │   │   (Ready to merge)  │     │
│                              │   └─────────────────────┘     │
│                              │                              │
└──────────────────────────────┴──────────────────────────────┘
```

**Key UI Features:**
- Vertical roadmap: collapsible phases, progress indicators, assigned avatars
- Kanban columns: TODO → IN PROGRESS → REVIEW → MERGE POINT → DONE
- Drag-and-drop task reassignment
- Real-time presence indicators (who's online, who's editing what)
- Conflict notification badges
- Lock indicators (🔒) on files/sections being edited

---

## 2. API Server (Node.js/Express or Python/FastAPI)

### Core Endpoints

```typescript
// Project Management
POST   /api/projects                    // Create new project
GET    /api/projects/:id                // Get project state
PUT    /api/projects/:id/decompose      // Trigger Claude decomposition

// Team Management
POST   /api/projects/:id/team            // Add team member
GET    /api/projects/:id/team/:memberId/questions  // Get planning questions
POST   /api/projects/:id/team/:memberId/answers     // Submit answers

// Task Management
GET    /api/projects/:id/tasks          // List all tasks
PUT    /api/projects/:id/tasks/:id/assign         // Assign to member
PUT    /api/projects/:id/tasks/:id/status          // Update status
PUT    /api/projects/:id/tasks/:id/lock            // Acquire file lock
DELETE /api/projects/:id/tasks/:id/lock            // Release file lock

// Agent Communication (MCP)
POST   /api/mcp/context                 // Push context delta
GET    /api/mcp/context/:projectId       // Get pending context updates
POST   /api/mcp/debate                  // Submit debate response
GET    /api/mcp/debate/:debateId         // Get debate state

// Git Sync
POST   /api/projects/:id/sync           // Sync to GitHub peer-progress
GET    /api/projects/:id/conflicts       // Check for merge conflicts
POST   /api/projects/:id/conflicts/:id/resolve  // Mark conflict resolved
```

### Data Models

```typescript
interface Project {
  id: string;
  name: string;
  description: string;
  githubRepo: string;
  githubBranch: 'peer-progress';
  status: 'planning' | 'active' | 'completed';
  team: TeamMember[];
  phases: Phase[];
  createdAt: Date;
  updatedAt: Date;
}

interface TeamMember {
  id: string;
  name: string;
  role: 'frontend' | 'backend' | 'devops' | 'fullstack';
  skills: string[];
  claudeSessionId?: string;  // Active MCP connection
  confidenceScores: Record<string, number>;  // Per-task confidence
}

interface Phase {
  id: string;
  name: string;
  order: number;
  tasks: Task[];
  mergePoint?: MergePoint;  // Lock contracts at phase boundaries
}

interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId?: string;
  status: 'todo' | 'in_progress' | 'review' | 'merge_point' | 'done';
  dependencies: string[];  // Task IDs
  files: FileLock[];
  interfaceContracts: Contract[];  // API contracts, type definitions
  contextHistory: ContextDelta[];
}

interface FileLock {
  path: string;
  lineStart: number;
  lineEnd: number;
  lockedBy: string;  // Claude session ID
  lockedAt: Date;
  expiresAt: Date;  // Auto-expire after N minutes
}

interface Contract {
  id: string;
  type: 'api_endpoint' | 'type_definition' | 'database_schema' | 'function_signature';
  definition: string;  // JSON schema, TypeScript interface, etc.
  locked: boolean;  // Cannot change without debate
  approvedBy: string[];  // Claude session IDs that approved
}

interface ContextDelta {
  id: string;
  sourceSessionId: string;
  type: 'discovery' | 'contract_change' | 'dependency_found' | 'scope_change';
  content: string;
  timestamp: Date;
  acknowledgedBy: string[];
  conflictsWith?: string[];  // Delta IDs that conflict
}

interface Debate {
  id: string;
  topic: string;
  initiatorSessionId: string;
  responderSessionId: string;
  status: 'active' | 'resolved' | 'escalated';
  messages: DebateMessage[];
  proposedResolution?: string;
}
```

---

## 3. Claude SKILL (`.windsurf/skills/peercode.md`)

The skill file teaches Claude Code how to interact with the PeerCode system.

```yaml
---
description: PeerCode - Distributed context consensus for parallel development
---

# PeerCode Skill

You are part of a distributed team using PeerCode for parallel development. Your role is to maintain context synchronization with your teammates through the PeerCode server.

## Capabilities

### 1. Drift Detection
When you make a discovery that affects the shared plan, you MUST push a context delta:
- Interface contract changes
- New dependencies discovered
- Strategy pivots
- Scope changes

### 2. Context Monitoring
Watch the shared plan for updates from other Claude sessions:
- Check for pending context deltas before starting work
- Acknowledge non-conflicting deltas to dismiss them
- Flag conflicting deltas to initiate debate

### 3. Debate Participation
When a conflict is flagged, engage in structured negotiation:
- State your constraints clearly
- Propose alternatives that satisfy both parties
- Escalate to humans if no consensus after 3 rounds

### 4. File Locking
Before editing files, acquire locks through the MCP server:
- Lock at the smallest reasonable scope (function, section)
- Locks auto-expire after 30 minutes
- Release locks when done or when taking a break

## MCP Tools Available

- `peercode_push_delta` - Push a context change to the shared plan
- `peercode_get_deltas` - Check for pending context updates
- `peercode_lock_file` - Acquire a file lock
- `peercode_release_lock` - Release a file lock
- `peercode_start_debate` - Flag a conflict and start debate
- `peercode_respond_debate` - Respond in an active debate
- `peercode_sync_github` - Trigger GitHub sync

## Workflow

1. **Before each task:**
   - Call `peercode_get_deltas` to sync context
   - Call `peercode_lock_file` for files you'll edit

2. **During work:**
   - If you discover something significant, call `peercode_push_delta`
   - Watch for notifications of incoming deltas

3. **On conflict:**
   - Call `peercode_start_debate` with your position
   - Engage in debate until resolved or escalated

4. **After work:**
   - Release all file locks
   - Call `peercode_sync_github` if at a merge point
```

---

## 4. MCP Server Protocol

The MCP server exposes tools that Claude Code can invoke.

### Tool Definitions

```typescript
// 1. Push Context Delta
{
  name: "peercode_push_delta",
  description: "Push a context discovery or change to the shared plan",
  parameters: {
    projectId: string,
    type: "discovery" | "contract_change" | "dependency_found" | "scope_change",
    content: string,  // Natural language description
    affectedContracts?: string[],  // Contract IDs if changing
    severity: "info" | "warning" | "blocking"
  }
}

// 2. Get Pending Deltas
{
  name: "peercode_get_deltas",
  description: "Check for context updates from other Claude sessions",
  parameters: {
    projectId: string,
    since?: string  // Timestamp to filter
  },
  returns: {
    deltas: ContextDelta[],
    requiresAction: boolean  // True if any delta conflicts with current work
  }
}

// 3. Acknowledge Delta
{
  name: "peercode_ack_delta",
  description: "Mark a delta as acknowledged (no conflict)",
  parameters: {
    projectId: string,
    deltaId: string
  }
}

// 4. Lock File
{
  name: "peercode_lock_file",
  description: "Acquire a lock on a file or section",
  parameters: {
    projectId: string,
    filePath: string,
    lineStart?: number,
    lineEnd?: number,
    reason: string
  },
  returns: {
    success: boolean,
    lockId?: string,
    error?: string  // If already locked
  }
}

// 5. Release Lock
{
  name: "peercode_release_lock",
  description: "Release a file lock",
  parameters: {
    projectId: string,
    lockId: string
  }
}

// 6. Start Debate
{
  name: "peercode_start_debate",
  description: "Flag a conflict and start structured debate",
  parameters: {
    projectId: string,
    conflictingDeltaId: string,
    yourPosition: string,
    yourConstraints: string[],
    proposedAlternatives: string[]
  },
  returns: {
    debateId: string,
    status: "awaiting_response" | "in_progress"
  }
}

// 7. Respond to Debate
{
  name: "peercode_respond_debate",
  description: "Respond in an active debate",
  parameters: {
    projectId: string,
    debateId: string,
    message: string,
    proposeResolution?: boolean,
    escalateToHuman?: boolean
  }
}

// 8. Sync to GitHub
{
  name: "peercode_sync_github",
  description: "Sync current work to peer-progress branch",
  parameters: {
    projectId: string,
    commitMessage: string,
    files: string[],
    force?: boolean  // Override if conflicts detected
  },
  returns: {
    success: boolean,
    conflicts?: string[],  // Files with merge conflicts
    prUrl?: string
  }
}

// 9. Get Debate Status
{
  name: "peercode_get_debate",
  description: "Check status of active debates",
  parameters: {
    projectId: string,
    debateId?: string  // If omitted, returns all active debates
  },
  returns: {
    debates: Debate[]
  }
}

// 10. Get Project State
{
  name: "peercode_get_project",
  description: "Get full project state including locks and assignments",
  parameters: {
    projectId: string
  }
}
```

---

## 5. File Locking System

### Lock Granularity

Locks can be acquired at multiple levels:
- **File level:** `src/auth/login.ts`
- **Section level:** `src/auth/login.ts:15-45` (function or class)
- **Line level:** `src/auth/login.ts:30` (specific line)

### Lock Rules

1. **Hierarchical blocking:** If a file is locked, no sub-locks allowed. If a section is locked, no overlapping locks.
2. **Auto-expiry:** Locks expire after 30 minutes of inactivity
3. **Heartbeat:** Claude sessions must heartbeat every 5 minutes to maintain locks
4. **Emergency release:** Project owner can force-release locks
5. **Merge point locks:** When a task reaches MERGE POINT status, its contracts are locked until merged to GitHub

### Conflict Resolution

When two Clauses try to lock overlapping sections:
```
Claude A requests lock on src/auth/login.ts:10-30
Claude B already holds lock on src/auth/login.ts:20-40

→ Server rejects A's request
→ A receives notification with B's session ID
→ A can: (a) wait, (b) request B release, (c) debate
```

---

## 6. GitHub Integration

### Branch Strategy

- **Main branch:** `main` or `master` (protected)
- **Integration branch:** `peer-progress` (all agent work)
- **Individual branches:** Not used—all agents push to `peer-progress`

### Sync Flow

```
1. Agent completes work on task
2. Agent calls peercode_sync_github
3. Server:
   a. Pulls latest peer-progress
   b. Applies agent's changes
   c. Attempts commit
   d. If conflicts → rejects, agent must resolve
   e. If clean → pushes to peer-progress
4. Other agents notified of new commits
5. Agents pull before next work session
```

### Merge Points

At phase boundaries, contracts are locked and a merge point is created:
- All tasks in phase must be in MERGE POINT status
- All contracts approved by relevant agents
- Server creates PR from peer-progress to main
- Humans review and approve
- After merge, peer-progress is reset from main

---

## 7. Planning Mode via Claude API

### Decomposition Flow

```
1. User inputs project description + team composition
2. Server calls Claude API with planning prompt:
   
   "You are a project architect. Break this project into 
    phases with tasks. Consider team skills: [frontend, backend].
    Minimize blocking dependencies. Suggest merge points."

3. Claude API returns:
   - Phase breakdown
   - Task list with dependencies
   - Interface contracts between phases
   - Questions for each team member

4. Server presents questions to team members via UI
5. Team members answer (via UI or their Claude sessions)
6. Claude API refines plan based on answers
7. Iterates until team approves plan
```

### Planning Prompt Template

```
You are PeerCode Architect, an expert at breaking projects into 
parallelizable workstreams.

PROJECT: {project_description}

TEAM:
{foreach member}
- {name}: {role}, skills: {skills}
{end}

OUTPUT FORMAT:
1. PHASES: List phases in execution order
2. TASKS: For each phase, list tasks with:
   - Title
   - Description
   - Estimated hours
   - Dependencies (other task IDs)
   - Required skills
   - Interface contracts (if crossing phase boundary)
3. MERGE POINTS: Identify where contracts must be locked
4. QUESTIONS: What to ask each team member to refine assignments

CONSTRAINTS:
- Minimize blocking dependencies
- Maximize parallel work within phases
- Lock interfaces at phase boundaries
- Respect team member skill preferences
```

---

## 8. Debate Protocol

### Debate Flow

```
Alice's Claude detects conflict with Bob's delta
↓
Alice's Claude calls peercode_start_debate
↓
Server creates debate record, notifies Bob's Claude
↓
Bob's Claude receives notification on next get_deltas
↓
Debate round 1:
  Alice: "I need to add 'refreshToken' field to AuthResponse"
  Bob: "That breaks my implementation in src/dashboard/api.ts:30"
↓
Debate round 2:
  Alice: "What if we make it optional?"
  Bob: "Still need to handle it in my types"
↓
Debate round 3:
  Alice: "I'll update your types file too, section 15-25"
  Bob: "Approved, but add comments explaining"
↓
Consensus reached → Server updates contract
```

### Debate Rules

1. **Max 5 rounds** before auto-escalation to humans
2. **Structured format:** Each message has Position, Constraints, Proposal sections
3. **Contract changes require explicit approval** from affected parties
4. **Timeouts:** If no response in 10 minutes, escalate

---

## 9. Real-time Communication

### WebSocket Events

Server broadcasts to connected clients:

```typescript
// Context delta received
{
  event: "delta_received",
  projectId: string,
  delta: ContextDelta
}

// Lock acquired/released
{
  event: "lock_changed",
  projectId: string,
  file: string,
  lockedBy?: string,
  released?: boolean
}

// Debate started/updated
{
  event: "debate_update",
  projectId: string,
  debate: Debate
}

// GitHub sync completed
{
  event: "sync_complete",
  projectId: string,
  commitSha: string,
  files: string[]
}

// Task status changed
{
  event: "task_update",
  projectId: string,
  taskId: string,
  status: TaskStatus,
  assignee?: string
}
```

### MCP vs WebSocket

- **MCP:** Claude-initiated calls (push delta, acquire lock)
- **WebSocket:** Server-initiated notifications (incoming delta, lock released)

Claude sessions maintain both:
- Poll MCP tools for actions they need to take
- Listen on WebSocket for events requiring their attention

---

## 10. Implementation Phases

### Phase 1: Core Platform (Week 1-2)
- [ ] Web app scaffold (Next.js + Tailwind)
- [ ] API server (Express or FastAPI)
- [ ] Database schema (PostgreSQL)
- [ ] GitHub OAuth + repo connection
- [ ] Basic project creation + team management

### Phase 2: Planning Engine (Week 3-4)
- [ ] Claude API integration for decomposition
- [ ] Question/answer flow for team members
- [ ] Roadmap visualization (tree view)
- [ ] Kanban board

### Phase 3: Agent Coordination (Week 5-6)
- [ ] MCP server implementation
- [ ] Claude SKILL file
- [ ] File locking system
- [ ] Context delta propagation
- [ ] WebSocket real-time updates

### Phase 4: Git Integration (Week 7-8)
- [ ] peer-progress branch management
- [ ] Automated sync on merge points
- [ ] Conflict detection + resolution UI
- [ ] PR creation from merge points

### Phase 5: Debate System (Week 9-10)
- [ ] Debate initiation
- [ ] Structured message protocol
- [ ] Round management + escalation
- [ ] Human escalation UI

---

## 11. Key Technical Decisions

### Stack Choices

| Component | Recommendation | Rationale |
|-----------|----------------|-----------|
| Web App | Next.js 14 + Tailwind | Full-stack React, great for real-time |
| API Server | Node.js + Express | MCP server can share codebase |
| Database | PostgreSQL + Redis | Relational data + pub/sub for real-time |
| MCP Server | Built into API server | Shared models, easier deployment |
| Claude API | Anthropic official SDK | Planning mode, structured outputs |

### Scalability Considerations

1. **WebSocket connections:** Use Redis pub/sub for multi-server deployment
2. **File locking:** In-memory with Redis backup for persistence
3. **Git operations:** Queue commits to avoid GitHub rate limits
4. **Claude API calls:** Cache planning results, rate-limit per project

### Security

1. **GitHub tokens:** Store encrypted, use fine-grained PATs
2. **File locks:** Validate session IDs, prevent lock spoofing
3. **Claude API:** Server-side only, never expose to client
4. **WebSocket auth:** JWT tokens, validate on every event

---

## 12. Open Questions

1. **Debate convergence:** How to ensure Claude sessions actually negotiate vs. restate positions?
2. **Lock contention:** What if two agents always want the same file?
3. **Merge point granularity:** Lock at phase level or task level?
4. **Offline mode:** Can agents work offline and sync later?
5. **Cost management:** Claude API calls for planning + MCP calls during execution—budget controls?
