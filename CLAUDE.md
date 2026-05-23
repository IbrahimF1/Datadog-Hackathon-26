# PeerCode: Distributed LLM Context Consensus for Parallel Development

A web-based orchestration platform where multiple Claude Code sessions coordinate through a central server, featuring visual planning (tree roadmap + Kanban), real-time MCP-based agent communication, file-level concurrency control, and automated GitHub synchronization to the `peer-progress` branch.

---

## Core Problem

When teams parallelize work via Claude Code, each developer's local context drifts as they discover constraints, change approaches, or uncover dependencies. Today's solutions require humans to manually sync these changes through Slack, PRs, or meetings. The LLMs themselves—the entities actually doing the work—have no mechanism to:
- Detect when their local context contradicts the shared plan
- Auto-propagate significant context changes to peers
- Receive and integrate peer context updates without human intervention
- Resolve contradictions through structured "debate" before humans get involved

---

## Ultimate Feature: The Context Propagation Layer

The killer capability is a **live, bidirectional context consensus protocol** that sits between Claude Code sessions via MCP. When Developer A's Claude discovers the API needs to change, that context delta doesn't sit in A's session—it propagates to the shared plan, and Developer B's Claude *sees* the delta via WebSocket notification, evaluates if it conflicts with B's current work, and either auto-adapts or flags for debate.

Humans only step in when LLMs can't reach consensus after 5 debate rounds.

---

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web App UI    │────▶│  PeerCode API   │◄────│   GitHub API    │
│ (Roadmap +      │     │   Server        │     │  (peer-progress │
│   Kanban)       │     └────────┬────────┘     │     branch)     │
└─────────────────┘              │                └─────────────────┘
                    ┌────────────┼────────────┐
                    │            │            │
              ┌─────▼─────┐ ┌────▼────┐ ┌────▼────┐
              │  Claude A │ │ Claude B│ │ Claude C│
              │  (MCP)    │ │  (MCP)  │ │  (MCP)  │
              └───────────┘ └─────────┘ └─────────┘
```

---

## Web Application: Dual-Pane Interface

The UI combines a **vertical tree roadmap** (showing phases, tasks, dependencies) with a **Kanban board** (showing work in progress).

```
┌─────────────────────────────────────────────────────────────┐
│  [Plan] [Board] [Graph] | Project: E-Commerce API v2        │
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
│   🔒 MERGE POINT: Auth API   │   └─────────────────────┘     │
│   Contract Locked            │   ┌─────────────────────┐     │
│                              │   │ MERGE POINTS 🔒      │     │
│                              │   ├─────────────────────┤     │
│                              │   │ • Auth API Contract │     │
│                              │   │   (Ready to merge)  │     │
│                              │   └─────────────────────┘     │
└──────────────────────────────┴──────────────────────────────┘
```

**Key UI Elements:**
- **Kanban Columns:** TODO → IN PROGRESS → REVIEW → MERGE POINT → DONE
- **Lock Indicators:** 🔒 shows files/sections being edited
- **Presence:** Real-time avatars showing who's online and editing what
- **Conflict Badges:** Notifications when debates or context conflicts arise
- **Merge Points:** Contract lock indicators at phase boundaries

---

## Conceptual Flow

### Phase 1: Project Decomposition (Interactive)

**Input:** Goal description + team composition (2 frontend, 1 backend, 1 DevOps)

**Process:**
1. Lead Claude breaks goal into submodules with dependency graph
2. Each team member's Claude reviews the proposed submodule assigned to them
3. Claude sessions can object: "This assumes OAuth is ready, but that's my dependency"
4. Interactive refinement until all Claude sessions converge on acceptable boundaries
5. System auto-restructures to minimize blocking dependencies

**Output:**
- Submodule definitions with interfaces/contracts
- Dependency graph optimized for parallelization
- Context templates for each assigned submodule

### Phase 2: Parallel Execution with Context Monitoring

**Setup:**
Each Claude Code session loads:
- Their assigned submodule context
- A watcher on the shared plan file
- Local context buffer (what they've learned/discovered)

**Runtime Loop:**
```
Developer works → Local context evolves → Claude detects drift → 
Pushes delta to shared plan → Other Claude sessions notified → 
Evaluate impact → Auto-adapt OR flag conflict
```

**Drift Detection Triggers:**
- Interface contract changes ("I need to add a field to the auth response")
- New dependency discovered ("This requires Redis, not in the plan")
- Strategy pivot ("REST won't work, need GraphQL")
- Scope change ("This submodule is actually 3x larger")

### Phase 3: Context Integration & Conflict Resolution

**When a delta arrives:**

1. **Auto-Adapt:** If no conflict, receiving Claude silently updates local context and continues
2. **Conflict Flag:** If contradiction detected (e.g., B already built assuming REST), Claude flags it
3. **Debate Mode:** Both Claude sessions enter structured negotiation:
   - Each presents their constraint/requirement
   - They propose alternatives
   - If consensus reached → update plan
   - If deadlock after 5 rounds → escalate to humans with full context

**Conflict Examples:**
- A changes API contract that B already implemented against
- A and B both discovered they need the same shared resource
- A's approach makes B's approach obsolete

---

## File Locking System

Before editing files, Claude sessions must acquire locks through the MCP server to prevent conflicts.

**Lock Granularity:**
- **File level:** `src/auth/login.ts`
- **Section level:** `src/auth/login.ts:15-45` (function or class)
- **Line level:** `src/auth/login.ts:30` (specific line)

**Lock Rules:**
1. **Hierarchical blocking:** If a file is locked, no sub-locks allowed. If a section is locked, no overlapping locks.
2. **Auto-expiry:** Locks expire after 30 minutes of inactivity
3. **Heartbeat:** Claude sessions must heartbeat every 5 minutes to maintain locks
4. **Merge point locks:** When a task reaches MERGE POINT status, its contracts are locked until synced to GitHub

---

## GitHub Integration: peer-progress Branch

All Claude sessions push work to a shared `peer-progress` branch (not individual branches).

**Sync Flow:**
1. Agent completes work and calls `peercode_sync_github`
2. Server pulls latest `peer-progress`, applies changes, attempts commit
3. If conflicts detected → agent must resolve before proceeding
4. If clean → pushes to `peer-progress` and notifies other agents
5. Other agents pull before next work session

**Merge Points:**
At phase boundaries, contracts are locked and a merge point is created:
- All tasks in phase must be in MERGE POINT status
- All interface contracts approved by relevant agents
- Server creates PR from `peer-progress` to `main`
- Humans review and approve
- After merge, `peer-progress` resets from `main`

---

## MCP Tools for Claude Sessions

Claude Code communicates with the PeerCode server via these MCP tools:

| Tool | Purpose |
|------|---------|
| `peercode_push_delta` | Push context discovery/change to shared plan |
| `peercode_get_deltas` | Check for pending context updates from peers |
| `peercode_ack_delta` | Mark a delta as acknowledged (no conflict) |
| `peercode_lock_file` | Acquire lock on file or section |
| `peercode_release_lock` | Release a file lock |
| `peercode_start_debate` | Flag conflict and start structured debate |
| `peercode_respond_debate` | Respond in active debate |
| `peercode_get_debate` | Check status of active debates |
| `peercode_sync_github` | Sync work to `peer-progress` branch |
| `peercode_get_project` | Get full project state including locks |

**Claude Workflow:**
1. **Before work:** Call `peercode_get_deltas` to sync context, `peercode_lock_file` for files to edit
2. **During work:** Call `peercode_push_delta` when discovering something significant
3. **On conflict:** Call `peercode_start_debate`, engage until resolved or escalated
4. **After work:** Release locks, call `peercode_sync_github` if at merge point

---

## Debate Protocol

When context deltas conflict, Claude sessions engage in structured negotiation:

**Example Flow:**
```
Round 1:
  Alice: "I need to add 'refreshToken' to AuthResponse"
  Bob: "That breaks my implementation in src/dashboard/api.ts:30"

Round 2:
  Alice: "What if we make it optional?"
  Bob: "Still need to handle it in my types"

Round 3:
  Alice: "I'll update your types file too, section 15-25"
  Bob: "Approved, add comments explaining"

→ Consensus reached → Contract updated
```

**Debate Rules:**
- **Max 5 rounds** before auto-escalation to humans
- **Structured format:** Position, Constraints, Proposal sections
- **Contract changes** require explicit approval from affected parties
- **Timeouts:** If no response in 10 minutes, escalate

---

## Planning Mode via Claude API

The system uses Claude API (not just individual sessions) for project decomposition:

**Flow:**
1. User inputs project description + team composition
2. Server calls Claude API with planning prompt to break project into phases
3. Claude API returns phase breakdown + questions for each team member
4. Questions presented to team via web UI
5. Team answers (via UI or their Claude sessions)
6. Claude API refines plan based on answers
7. Iterates until team approves

**Planning Prompt:**
- Break project into phases with tasks
- Consider team skills for assignment
- Minimize blocking dependencies
- Identify merge points where contracts lock
- Generate questions for each team member to refine assignments

---

## Key Design Decisions

### 1. Skill-Aware + Preference Hybrid Allocation

System proposes initial allocation based on skill tags, but:
- Developers can "claim" submodules they want
- Claude sessions can signal confidence levels ("I'm 90% confident I can do this")
- Re-allocation happens if confidence is low or conflicts arise

### 2. Auto-Restructure for Parallelization

Not just flagging dependencies—actively restructuring:
- Split submodules at dependency boundaries
- Create "interface stubs" that unblock parallel work
- Suggest "contract-first" development where interfaces are locked early

### 3. Web App + MCP Server Architecture

A centralized coordination system (not just file-based):
- **Web app** provides dual-pane UI (roadmap tree + Kanban) for visualization
- **MCP server** exposes tools for drift detection, locking, debating, Git sync
- **WebSocket** delivers real-time notifications to Claude sessions
- **File locking** prevents editing conflicts at file/section/line granularity
- **GitHub integration** syncs all work to `peer-progress` branch

### 4. Human Escalation Points

LLMs handle routine context sync. Humans step in for:
- Value judgments ("Is this feature worth the delay?")
- Resource reallocation ("Should we add a 5th person?")
- Irresolvable technical disagreements
- Final approval on contract changes that affect multiple submodules

---

## What Makes This Hard (Open Questions)

### Context Representation

What exactly gets propagated? Options:
- **A:** Full conversation history (too large, too noisy)
- **B:** Structured deltas ("API contract changed: X → Y")
- **C:** Semantic embeddings (compressed meaning)
- **D:** Hybrid: structured for contracts, summaries for discoveries

**Open Question:** How do we represent context such that another LLM can integrate it meaningfully without full history?

### Drift Detection Accuracy

When should a local discovery trigger propagation vs. stay local?
- Not every realization is worth broadcasting
- False positives create noise
- False negatives create drift

**Open Question:** What criteria determine "significant" context drift? Can we teach Claude sessions to self-censor routine discoveries?

### Debate Convergence

Two Claude sessions disagree. How do we ensure they:
- Actually listen to each other's constraints
- Don't just restate their position
- Recognize when they're at impasse vs. still exploring

**Open Question:** Is there a lightweight protocol for LLM negotiation that reliably converges or escalates appropriately?

### Temporal Coupling

What if A pushes a delta while B is mid-implementation of the old contract?
- Rollback B's work? (expensive)
- Adapt B's work? (risky)
- Block until B commits? (defeats parallelization)

**Open Question:** How do we handle in-flight work when contracts change?

---

## Success Criteria (Conceptual)

**Minimum Viable:**
- System breaks project into submodules with dependency graph
- Each developer works in parallel with shared plan as source of truth
- Major context changes are manually pushed and broadcast

**Target:**
- Automatic drift detection with 80% accuracy
- Bidirectional propagation without human action
- Debate mode resolves 70% of conflicts without escalation

**North Star:**
- Near-transparent context sync (developers rarely think about it)
- Zero-blocking parallelization for well-scoped projects
- Humans only handle value judgments, never coordination logistics

---

## Differentiation from Existing Solutions

| Approach | What's Missing |
|----------|---------------|
| Claude Code Agent Teams | Peer-to-peer context, not just orchestration |
| Ruflo (MCP server) | Bidirectional sync, not just shared memory |
| GitHub Projects | LLM-native context, not human-translated |
| Daily standups | Automated, continuous, not batched |

The gap: **No system treats LLMs as first-class participants in context synchronization.** Everything else makes humans the coordination layer.

---

## Open Questions for Iteration

1. **Granularity of Context:** Should we propagate at the statement level, the file level, or the semantic concept level?

2. **Privacy Boundaries:** Can a developer have "draft" context that doesn't sync until they're ready?

3. **Federation:** What if Developer A uses Claude Code, Developer B uses Cursor—can they still sync?

4. **Persistence:** Is the shared plan ephemeral (project duration) or should it become documentation?

5. **Metrics:** How do we measure "successful" context propagation vs. noise?

6. **Learning:** Can the system learn a team's communication patterns and auto-tune drift detection?

---

## Why This Matters

Current parallel development is coordination-bound, not cognition-bound. Humans spend 30-50% of "development time" in sync meetings, Slack threads, and PR back-and-forth. Not because the work is hard, but because context is fragmented.

If LLMs can maintain shared context automatically, we unlock true parallelization—where 4 developers on a project actually deliver 4x throughput, not 2.5x after coordination overhead.

This isn't about replacing humans. It's about removing the scaffolding work that keeps humans from focusing on the hard problems only they can solve.
