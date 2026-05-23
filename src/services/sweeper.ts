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

  private tick(): void {
    void this.runSweep();
  }

  private async runSweep(): Promise<void> {
    const nowMs = Date.now();
    const locks = await this.store.listAllLocks();
    for (const lock of locks) {
      if (new Date(lock.expiresAt).getTime() < nowMs) {
        await this.store.removeLock(lock.lockId);
        this.bus.emit("lock_changed", lock.projectId, {
          action: "expired",
          lockId: lock.lockId,
          path: lock.path,
        });
      }
    }
    const projects = await this.store.listProjects();
    for (const project of projects) {
      await this.debates.escalateTimedOut(project.id);
    }
  }
}
