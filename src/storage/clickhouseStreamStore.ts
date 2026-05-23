import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { config } from "../config.js";
import type { ContextDelta, DebateMessage } from "../domain/types.js";
import type {
  AuditEntry,
  StreamEvent,
  StreamStore,
} from "./streamStore.js";

export class ClickHouseStreamStore implements StreamStore {
  private client: ClickHouseClient | null;
  private ready = false;
  private readonly db = config.clickhouse.database;

  constructor() {
    // No URL -> no client (avoid the @clickhouse/client default local endpoint).
    this.client = config.clickhouse.url
      ? createClient({
          url: config.clickhouse.url,
          username: config.clickhouse.username,
          password: config.clickhouse.password,
          // database is created in init(); connect without it first
        })
      : null;
  }

  async init(): Promise<void> {
    if (!this.client) {
      console.warn("[clickhouse] CLICKHOUSE_URL not set; stream logging disabled");
      return;
    }
    try {
      await this.client.command({
        query: `CREATE DATABASE IF NOT EXISTS ${this.db}`,
      });

      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.context_deltas (
            id String, project_id String, task_id String,
            source_session_id String, type String, severity String,
            content String, affected_contracts String, ts DateTime64(3)
          ) ENGINE = MergeTree ORDER BY (project_id, ts)`,
      });

      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.debate_messages (
            id String, debate_id String, project_id String,
            session_id String, round UInt32, message String,
            propose_resolution UInt8, ts DateTime64(3)
          ) ENGINE = MergeTree ORDER BY (project_id, ts)`,
      });

      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.events (
            project_id String, type String, payload String, ts DateTime64(3)
          ) ENGINE = MergeTree ORDER BY (project_id, ts)`,
      });

      await this.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.db}.audit (
            project_id String, session_id String, action String,
            detail String, ts DateTime64(3)
          ) ENGINE = MergeTree ORDER BY (project_id, ts)`,
      });

      this.ready = true;
      console.log(`[clickhouse] connected, schema ready in "${this.db}"`);
    } catch (err) {
      this.ready = false;
      console.warn(
        `[clickhouse] unavailable, stream logging disabled: ${(err as Error).message}`,
      );
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
        values: [row],
        format: "JSONEachRow",
      });
    } catch (err) {
      console.warn(`[clickhouse] insert ${table} failed: ${(err as Error).message}`);
    }
  }

  private chTime(iso: string): string {
    // ClickHouse DateTime64 accepts 'YYYY-MM-DD HH:MM:SS.mmm'
    return iso.replace("T", " ").replace("Z", "");
  }

  async appendDelta(d: ContextDelta): Promise<void> {
    await this.insert("context_deltas", {
      id: d.id,
      project_id: d.projectId,
      task_id: d.taskId ?? "",
      source_session_id: d.sourceSessionId,
      type: d.type,
      severity: d.severity,
      content: d.content,
      affected_contracts: JSON.stringify(d.affectedContracts),
      ts: this.chTime(d.timestamp),
    });
  }

  async appendDebateMessage(m: DebateMessage): Promise<void> {
    await this.insert("debate_messages", {
      id: m.id,
      debate_id: m.debateId,
      project_id: m.projectId,
      session_id: m.sessionId,
      round: m.round,
      message: m.message,
      propose_resolution: m.proposeResolution ? 1 : 0,
      ts: this.chTime(m.timestamp),
    });
  }

  async appendEvent(e: StreamEvent): Promise<void> {
    await this.insert("events", {
      project_id: e.projectId,
      type: e.type,
      payload: JSON.stringify(e.payload),
      ts: this.chTime(e.ts),
    });
  }

  async appendAudit(a: AuditEntry): Promise<void> {
    await this.insert("audit", {
      project_id: a.projectId,
      session_id: a.sessionId,
      action: a.action,
      detail: JSON.stringify(a.detail),
      ts: this.chTime(a.ts),
    });
  }

  async recentEvents(projectId: string, limit: number): Promise<StreamEvent[]> {
    if (!this.ready || !this.client) return [];
    try {
      const rs = await this.client.query({
        query: `
          SELECT project_id, type, payload, toString(ts) AS ts
          FROM ${this.db}.events
          WHERE project_id = {pid:String}
          ORDER BY ts DESC LIMIT {lim:UInt32}`,
        query_params: { pid: projectId, lim: limit },
        format: "JSONEachRow",
      });
      const rows = await rs.json<{
        project_id: string;
        type: string;
        payload: string;
        ts: string;
      }>();
      return rows.map((r) => ({
        projectId: r.project_id,
        type: r.type,
        ts: r.ts,
        payload: safeParse(r.payload),
      }));
    } catch (err) {
      console.warn(`[clickhouse] recentEvents failed: ${(err as Error).message}`);
      return [];
    }
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
