import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { config } from "../config.js";
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

export class ClickHouseLiveStore implements LiveStore {
  private client: ClickHouseClient | null;
  private ready = false;
  private readonly db = config.clickhouse.database;

  constructor() {
    this.client = config.clickhouse.url
      ? createClient({
          url: config.clickhouse.url,
          username: config.clickhouse.username,
          password: config.clickhouse.password,
        })
      : null;
  }

  async init(): Promise<void> {
    if (!this.client) {
      console.warn("[clickhouse-live] CLICKHOUSE_URL not set; using in-memory fallback");
      throw new Error("ClickHouse not configured");
    }
    try {
      await this.client.command({ query: `CREATE DATABASE IF NOT EXISTS ${this.db}` });

      // Projects table
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.projects (
            id String,
            name String,
            description String,
            github_repo String,
            github_branch String,
            status String,
            team String, -- JSON array
            phase_ids String, -- JSON array
            questions String, -- JSON array
            created_at String,
            updated_at String,
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY id`,
      });

      // Phases table
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.phases (
            id String,
            project_id String,
            name String,
            order_index Int32,
            task_ids String, -- JSON array
            merge_point String, -- JSON object
            contracts_locked UInt8,
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY id`,
      });

      // Tasks table
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.tasks (
            id String,
            project_id String,
            phase_id String,
            title String,
            description String,
            assignee_id String,
            status String,
            dependencies String, -- JSON array
            required_skills String, -- JSON array
            interface_contracts String, -- JSON array
            context_history String, -- JSON array
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY id`,
      });

      // Locks table
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.locks (
            lock_id String,
            project_id String,
            locked_by String,
            path String,
            line_start Int32,
            line_end Int32,
            reason String,
            locked_at String,
            expires_at String,
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY lock_id`,
      });

      // Sessions table
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.sessions (
            id String,
            project_id String,
            member_id String,
            connected_at String,
            last_seen String,
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY id`,
      });

      // Deltas table (current state, stream store has history)
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.deltas (
            id String,
            project_id String,
            task_id String,
            source_session_id String,
            type String,
            severity String,
            content String,
            affected_contracts String, -- JSON array
            acknowledged_by String, -- JSON array
            conflicts_with String, -- JSON array
            timestamp String,
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY id`,
      });

      // Debates table
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.debates (
            id String,
            project_id String,
            topic String,
            conflicting_delta_id String,
            initiator_session_id String,
            responder_session_id String,
            status String,
            round UInt32,
            position String,
            constraints String, -- JSON array
            proposed_alternatives String, -- JSON array
            proposed_resolution String,
            messages String, -- JSON array (current state only)
            last_activity_at String,
            created_at String,
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY id`,
      });

      // Sync tokens table
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.sync_tokens (
            project_id String,
            session_id String,
            acquired_at String,
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY project_id`,
      });

      // Sync records table
      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.sync_records (
            project_id String,
            session_id String,
            commit_sha String,
            synced_at String,
            version UInt64 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(version)
          ORDER BY (project_id, synced_at)`,
      });

      this.ready = true;
      console.log(`[clickhouse-live] connected, schema ready in "${this.db}"`);
    } catch (err) {
      this.ready = false;
      console.warn(`[clickhouse-live] unavailable: ${(err as Error).message}`);
      throw err;
    }
  }

  healthy(): boolean {
    return this.ready;
  }

  private async insert(table: string, row: Record<string, unknown>): Promise<void> {
    if (!this.ready || !this.client) return;
    try {
      await this.client.insert({
        table: `${this.db}.${table}`,
        values: [{ ...row, version: Date.now() }],
        format: "JSONEachRow",
      });
    } catch (err) {
      console.warn(`[clickhouse-live] insert ${table} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  private async queryOne<T>(table: string, id: string): Promise<T | undefined> {
    if (!this.ready || !this.client) return undefined;
    try {
      const rs = await this.client.query({
        query: `SELECT * FROM ${this.db}.${table} WHERE id = {id:String} ORDER BY version DESC LIMIT 1`,
        query_params: { id },
        format: "JSONEachRow",
      });
      const rows = await rs.json<T>();
      return rows[0];
    } catch {
      return undefined;
    }
  }

  private async queryMany<T>(table: string, filter?: { column: string; value: string }): Promise<T[]> {
    if (!this.ready || !this.client) return [];
    try {
      const whereClause = filter ? `WHERE ${filter.column} = {val:String}` : "";
      const query = `SELECT * FROM ${this.db}.${table} ${whereClause} ORDER BY version DESC`;
      const rs = await this.client.query({
        query,
        query_params: filter ? { val: filter.value } : {},
        format: "JSONEachRow",
      });
      const rows = await rs.json<T>();
      // Deduplicate by id (keep highest version)
      const seen = new Set<string>();
      return rows.filter((r: any) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    } catch {
      return [];
    }
  }

  // Helper to parse JSON fields
  private parseJson<T>(s: string | undefined, fallback: T): T {
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  }

  // Projects
  async createProject(p: Project): Promise<Project> {
    await this.insert("projects", {
      id: p.id,
      name: p.name,
      description: p.description,
      github_repo: p.githubRepo,
      github_branch: p.githubBranch,
      status: p.status,
      team: JSON.stringify(p.team),
      phase_ids: JSON.stringify(p.phaseIds),
      questions: JSON.stringify(p.questions),
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    });
    return p;
  }

  async getProject(id: string): Promise<Project | undefined> {
    const row = await this.queryOne<any>("projects", id);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      githubRepo: row.github_repo,
      githubBranch: row.github_branch,
      status: row.status,
      team: this.parseJson(row.team, []),
      phaseIds: this.parseJson(row.phase_ids, []),
      questions: this.parseJson(row.questions, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const current = await this.getProject(id);
    if (!current) throw new NotFoundError("project");
    const next: Project = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await this.createProject(next); // ReplacingMergeTree will replace by version
    return next;
  }

  async listProjects(): Promise<Project[]> {
    const rows = await this.queryMany<any>("projects");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      githubRepo: r.github_repo,
      githubBranch: r.github_branch,
      status: r.status,
      team: this.parseJson(r.team, []),
      phaseIds: this.parseJson(r.phase_ids, []),
      questions: this.parseJson(r.questions, []),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // Phases
  async createPhase(p: Phase): Promise<Phase> {
    await this.insert("phases", {
      id: p.id,
      project_id: p.projectId,
      name: p.name,
      order_index: p.order,
      task_ids: JSON.stringify(p.taskIds),
      merge_point: JSON.stringify(p.mergePoint),
      contracts_locked: p.contractsLocked ? 1 : 0,
    });
    return p;
  }

  async getPhase(id: string): Promise<Phase | undefined> {
    const row = await this.queryOne<any>("phases", id);
    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      order: row.order_index,
      taskIds: this.parseJson(row.task_ids, []),
      mergePoint: this.parseJson(row.merge_point, { reached: false, syncedSessionIds: [] }),
      contractsLocked: row.contracts_locked === 1,
    };
  }

  async updatePhase(id: string, patch: Partial<Phase>): Promise<Phase> {
    const current = await this.getPhase(id);
    if (!current) throw new NotFoundError("phase");
    const next: Phase = { ...current, ...patch };
    await this.createPhase(next);
    return next;
  }

  async listPhases(projectId: string): Promise<Phase[]> {
    const rows = await this.queryMany<any>("phases", { column: "project_id", value: projectId });
    return rows
      .map((r) => ({
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        order: r.order_index,
        taskIds: this.parseJson(r.task_ids, []),
        mergePoint: this.parseJson(r.merge_point, { reached: false, syncedSessionIds: [] }),
        contractsLocked: r.contracts_locked === 1,
      }))
      .sort((a, b) => a.order - b.order);
  }

  // Tasks
  async createTask(t: Task): Promise<Task> {
    await this.insert("tasks", {
      id: t.id,
      project_id: t.projectId,
      phase_id: t.phaseId,
      title: t.title,
      description: t.description,
      assignee_id: t.assigneeId ?? "",
      status: t.status,
      dependencies: JSON.stringify(t.dependencies),
      required_skills: JSON.stringify(t.requiredSkills),
      interface_contracts: JSON.stringify(t.interfaceContracts),
      context_history: JSON.stringify(t.contextHistory),
    });
    return t;
  }

  async getTask(id: string): Promise<Task | undefined> {
    const row = await this.queryOne<any>("tasks", id);
    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      phaseId: row.phase_id,
      title: row.title,
      description: row.description,
      assigneeId: row.assignee_id || undefined,
      status: row.status,
      dependencies: this.parseJson(row.dependencies, []),
      requiredSkills: this.parseJson(row.required_skills, []),
      interfaceContracts: this.parseJson(row.interface_contracts, []),
      contextHistory: this.parseJson(row.context_history, []),
    };
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const current = await this.getTask(id);
    if (!current) throw new NotFoundError("task");
    const next: Task = { ...current, ...patch };
    await this.createTask(next);
    return next;
  }

  async listTasks(projectId: string): Promise<Task[]> {
    const rows = await this.queryMany<any>("tasks", { column: "project_id", value: projectId });
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      phaseId: r.phase_id,
      title: r.title,
      description: r.description,
      assigneeId: r.assignee_id || undefined,
      status: r.status,
      dependencies: this.parseJson(r.dependencies, []),
      requiredSkills: this.parseJson(r.required_skills, []),
      interfaceContracts: this.parseJson(r.interface_contracts, []),
      contextHistory: this.parseJson(r.context_history, []),
    }));
  }

  // Locks
  async addLock(l: FileLock): Promise<FileLock> {
    await this.insert("locks", {
      lock_id: l.lockId,
      project_id: l.projectId,
      locked_by: l.lockedBy,
      path: l.path,
      line_start: l.lineStart ?? 0,
      line_end: l.lineEnd ?? 0,
      reason: l.reason,
      locked_at: l.lockedAt,
      expires_at: l.expiresAt,
    });
    return l;
  }

  async getLock(lockId: string): Promise<FileLock | undefined> {
    const row = await this.queryOne<any>("locks", lockId);
    if (!row) return undefined;
    return {
      lockId: row.lock_id,
      projectId: row.project_id,
      lockedBy: row.locked_by,
      path: row.path,
      lineStart: row.line_start || undefined,
      lineEnd: row.line_end || undefined,
      reason: row.reason,
      lockedAt: row.locked_at,
      expiresAt: row.expires_at,
    };
  }

  async removeLock(lockId: string): Promise<void> {
    if (!this.ready || !this.client) return;
    // Soft delete by inserting with empty project_id
    await this.client.insert({
      table: `${this.db}.locks`,
      values: [{ lock_id: lockId, project_id: "", version: Date.now() }],
      format: "JSONEachRow",
    });
  }

  async listLocks(projectId: string): Promise<FileLock[]> {
    const rows = await this.queryMany<any>("locks", { column: "project_id", value: projectId });
    return rows
      .filter((r) => r.project_id && r.project_id !== "")
      .map((r) => ({
        lockId: r.lock_id,
        projectId: r.project_id,
        lockedBy: r.locked_by,
        path: r.path,
        lineStart: r.line_start || undefined,
        lineEnd: r.line_end || undefined,
        reason: r.reason,
        lockedAt: r.locked_at,
        expiresAt: r.expires_at,
      }));
  }

  async listAllLocks(): Promise<FileLock[]> {
    const rows = await this.queryMany<any>("locks");
    return rows
      .filter((r) => r.project_id && r.project_id !== "")
      .map((r) => ({
        lockId: r.lock_id,
        projectId: r.project_id,
        lockedBy: r.locked_by,
        path: r.path,
        lineStart: r.line_start || undefined,
        lineEnd: r.line_end || undefined,
        reason: r.reason,
        lockedAt: r.locked_at,
        expiresAt: r.expires_at,
      }));
  }

  // Sessions
  async upsertSession(s: Session): Promise<Session> {
    await this.insert("sessions", {
      id: s.id,
      project_id: s.projectId,
      member_id: s.memberId ?? "",
      connected_at: s.connectedAt,
      last_seen: s.lastSeen,
    });
    return s;
  }

  async getSession(id: string): Promise<Session | undefined> {
    const row = await this.queryOne<any>("sessions", id);
    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      memberId: row.member_id || undefined,
      connectedAt: row.connected_at,
      lastSeen: row.last_seen,
    };
  }

  async touchSession(id: string): Promise<void> {
    const s = await this.getSession(id);
    if (s) {
      await this.upsertSession({ ...s, lastSeen: new Date().toISOString() });
    }
  }

  async listSessions(projectId: string): Promise<Session[]> {
    const rows = await this.queryMany<any>("sessions", { column: "project_id", value: projectId });
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      memberId: r.member_id || undefined,
      connectedAt: r.connected_at,
      lastSeen: r.last_seen,
    }));
  }

  // Deltas
  async addDelta(d: ContextDelta): Promise<ContextDelta> {
    await this.insert("deltas", {
      id: d.id,
      project_id: d.projectId,
      task_id: d.taskId ?? "",
      source_session_id: d.sourceSessionId,
      type: d.type,
      severity: d.severity,
      content: d.content,
      affected_contracts: JSON.stringify(d.affectedContracts),
      acknowledged_by: JSON.stringify(d.acknowledgedBy),
      conflicts_with: JSON.stringify(d.conflictsWith),
      timestamp: d.timestamp,
    });
    return d;
  }

  async getDelta(id: string): Promise<ContextDelta | undefined> {
    const row = await this.queryOne<any>("deltas", id);
    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id || undefined,
      sourceSessionId: row.source_session_id,
      type: row.type,
      severity: row.severity,
      content: row.content,
      affectedContracts: this.parseJson(row.affected_contracts, []),
      acknowledgedBy: this.parseJson(row.acknowledged_by, []),
      conflictsWith: this.parseJson(row.conflicts_with, []),
      timestamp: row.timestamp,
    };
  }

  async updateDelta(id: string, patch: Partial<ContextDelta>): Promise<ContextDelta> {
    const current = await this.getDelta(id);
    if (!current) throw new NotFoundError("delta");
    const next: ContextDelta = { ...current, ...patch };
    await this.addDelta(next);
    return next;
  }

  async listDeltas(projectId: string): Promise<ContextDelta[]> {
    const rows = await this.queryMany<any>("deltas", { column: "project_id", value: projectId });
    return rows
      .map((r) => ({
        id: r.id,
        projectId: r.project_id,
        taskId: r.task_id || undefined,
        sourceSessionId: r.source_session_id,
        type: r.type,
        severity: r.severity,
        content: r.content,
        affectedContracts: this.parseJson(r.affected_contracts, []),
        acknowledgedBy: this.parseJson(r.acknowledged_by, []),
        conflictsWith: this.parseJson(r.conflicts_with, []),
        timestamp: r.timestamp,
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // Debates
  async createDebate(d: Debate): Promise<Debate> {
    await this.insert("debates", {
      id: d.id,
      project_id: d.projectId,
      topic: d.topic,
      conflicting_delta_id: d.conflictingDeltaId ?? "",
      initiator_session_id: d.initiatorSessionId,
      responder_session_id: d.responderSessionId ?? "",
      status: d.status,
      round: d.round,
      position: d.position ?? "",
      constraints: JSON.stringify(d.constraints ?? []),
      proposed_alternatives: JSON.stringify(d.proposedAlternatives ?? []),
      proposed_resolution: d.proposedResolution ?? "",
      messages: JSON.stringify(d.messages),
      last_activity_at: d.lastActivityAt,
      created_at: d.createdAt,
    });
    return d;
  }

  async getDebate(id: string): Promise<Debate | undefined> {
    const row = await this.queryOne<any>("debates", id);
    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      topic: row.topic,
      conflictingDeltaId: row.conflicting_delta_id || undefined,
      initiatorSessionId: row.initiator_session_id,
      responderSessionId: row.responder_session_id || undefined,
      status: row.status,
      round: row.round,
      position: row.position || undefined,
      constraints: this.parseJson(row.constraints, []),
      proposedAlternatives: this.parseJson(row.proposed_alternatives, []),
      proposedResolution: row.proposed_resolution || undefined,
      messages: this.parseJson(row.messages, []),
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
    };
  }

  async updateDebate(id: string, patch: Partial<Debate>): Promise<Debate> {
    const current = await this.getDebate(id);
    if (!current) throw new NotFoundError("debate");
    const next: Debate = { ...current, ...patch };
    await this.createDebate(next);
    return next;
  }

  async listDebates(projectId: string): Promise<Debate[]> {
    const rows = await this.queryMany<any>("debates", { column: "project_id", value: projectId });
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      topic: r.topic,
      conflictingDeltaId: r.conflicting_delta_id || undefined,
      initiatorSessionId: r.initiator_session_id,
      responderSessionId: r.responder_session_id || undefined,
      status: r.status,
      round: r.round,
      position: r.position || undefined,
      constraints: this.parseJson(r.constraints, []),
      proposedAlternatives: this.parseJson(r.proposed_alternatives, []),
      proposedResolution: r.proposed_resolution || undefined,
      messages: this.parseJson(r.messages, []),
      lastActivityAt: r.last_activity_at,
      createdAt: r.created_at,
    }));
  }

  // Sync coordination
  async getSyncToken(projectId: string): Promise<SyncToken | undefined> {
    const row = await this.queryOne<any>("sync_tokens", projectId);
    if (!row) return undefined;
    return {
      projectId: row.project_id,
      sessionId: row.session_id,
      acquiredAt: row.acquired_at,
    };
  }

  async setSyncToken(token: SyncToken): Promise<void> {
    await this.insert("sync_tokens", {
      project_id: token.projectId,
      session_id: token.sessionId,
      acquired_at: token.acquiredAt,
    });
  }

  async clearSyncToken(projectId: string): Promise<void> {
    if (!this.ready || !this.client) return;
    await this.client.insert({
      table: `${this.db}.sync_tokens`,
      values: [{ project_id: projectId, session_id: "", version: Date.now() }],
      format: "JSONEachRow",
    });
  }

  async addSyncRecord(r: SyncRecord): Promise<void> {
    await this.insert("sync_records", {
      project_id: r.projectId,
      session_id: r.sessionId,
      commit_sha: r.commitSha,
      synced_at: r.syncedAt,
    });
  }

  async listSyncRecords(projectId: string): Promise<SyncRecord[]> {
    const rows = await this.queryMany<any>("sync_records", { column: "project_id", value: projectId });
    return rows.map((r) => ({
      projectId: r.project_id,
      sessionId: r.session_id,
      commitSha: r.commit_sha,
      syncedAt: r.synced_at,
    }));
  }
}
