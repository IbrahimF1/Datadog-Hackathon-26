import { config } from "../config.js";
import type { LiveStore } from "../storage/liveStore.js";
import type { DebateService } from "./debateService.js";
import type { EventBus } from "./eventBus.js";

// Periodic background maintenance: expire stale locks and escalate idle debates.
export class Sweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: LiveStore,
    private readonly bus: EventBus,
    private readonly debates: DebateService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), config.sweeperIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    const nowMs = Date.now();
    for (const lock of this.store.listAllLocks()) {
      if (new Date(lock.expiresAt).getTime() < nowMs) {
        this.store.removeLock(lock.lockId);
        this.bus.emit("lock_changed", lock.projectId, {
          action: "expired",
          lockId: lock.lockId,
          path: lock.path,
        });
      }
    }
    for (const project of this.store.listProjects()) {
      this.debates.escalateTimedOut(project.id);
    }
  }
}
