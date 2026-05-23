import { config } from "../config.js";
import type { FileLock } from "../domain/types.js";
import type { LiveStore } from "../storage/liveStore.js";
import type { StreamStore } from "../storage/streamStore.js";
import { LockConflictError, NotFoundError, ValidationError } from "./errors.js";
import type { EventBus } from "./eventBus.js";
import { newId, now } from "../util/id.js";

export interface AcquireLockParams {
  projectId: string;
  sessionId: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  reason: string;
}

export class LockService {
  constructor(
    private readonly store: LiveStore,
    private readonly bus: EventBus,
    private readonly stream: StreamStore,
  ) {}

  // Hierarchical, overlap-aware acquisition.
  // NOTE: With async stores, lock checking is no longer atomic. Race conditions
  // possible under high contention. Consider adding distributed locking for production.
  async acquire(p: AcquireLockParams): Promise<FileLock> {
    if (p.lineStart !== undefined && p.lineEnd !== undefined && p.lineEnd < p.lineStart) {
      throw new ValidationError("lineEnd must be >= lineStart");
    }

    const isFileLevel = p.lineStart === undefined;
    const allLocks = await this.store.listLocks(p.projectId);
    const samePath = allLocks.filter((l) => l.path === p.path);

    for (const l of samePath) {
      const existingIsFile = l.lineStart === undefined;
      if (existingIsFile) {
        throw new LockConflictError(
          `${p.path} is locked at file level`,
          l.lockedBy,
        );
      }
      if (isFileLevel) {
        throw new LockConflictError(
          `cannot file-lock ${p.path}: sub-locks exist`,
          l.lockedBy,
        );
      }
      if (
        rangesOverlap(
          p.lineStart!,
          p.lineEnd ?? p.lineStart!,
          l.lineStart!,
          l.lineEnd ?? l.lineStart!,
        )
      ) {
        throw new LockConflictError(
          `${p.path}:${p.lineStart}-${p.lineEnd ?? p.lineStart} overlaps an existing lock`,
          l.lockedBy,
        );
      }
    }

    const lock: FileLock = {
      lockId: newId("lock"),
      projectId: p.projectId,
      path: p.path,
      lineStart: p.lineStart,
      lineEnd: p.lineEnd,
      lockedBy: p.sessionId,
      reason: p.reason,
      lockedAt: now(),
      expiresAt: new Date(Date.now() + config.lockTtlMs).toISOString(),
    };
    await this.store.addLock(lock);
    this.bus.emit("lock_changed", p.projectId, { action: "acquired", lock });
    void this.stream.appendAudit({
      projectId: p.projectId,
      sessionId: p.sessionId,
      action: "lock_acquire",
      ts: lock.lockedAt,
      detail: { path: p.path, lineStart: p.lineStart, lineEnd: p.lineEnd },
    });
    return lock;
  }

  async release(projectId: string, sessionId: string, lockId: string): Promise<void> {
    const lock = await this.store.getLock(lockId);
    if (!lock) throw new NotFoundError("lock");
    if (lock.lockedBy !== sessionId) {
      throw new ValidationError("lock is owned by another session");
    }
    await this.store.removeLock(lockId);
    this.bus.emit("lock_changed", projectId, {
      action: "released",
      lockId,
      path: lock.path,
    });
    void this.stream.appendAudit({
      projectId,
      sessionId,
      action: "lock_release",
      ts: now(),
      detail: { lockId, path: lock.path },
    });
  }

  async heartbeat(_projectId: string, sessionId: string, lockId: string): Promise<FileLock> {
    const lock = await this.store.getLock(lockId);
    if (!lock) throw new NotFoundError("lock");
    if (lock.lockedBy !== sessionId) {
      throw new ValidationError("lock is owned by another session");
    }
    lock.expiresAt = new Date(Date.now() + config.lockTtlMs).toISOString();
    await this.store.touchSession(sessionId);
    return lock;
  }

  async list(projectId: string): Promise<FileLock[]> {
    return await this.store.listLocks(projectId);
  }
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
