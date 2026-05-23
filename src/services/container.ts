import { InMemoryLiveStore } from "../storage/inMemoryLiveStore.js";
import type { LiveStore } from "../storage/liveStore.js";
import { ClickHouseStreamStore } from "../storage/clickhouseStreamStore.js";
import type { StreamStore } from "../storage/streamStore.js";
import { AnthropicClient } from "../integrations/anthropicClient.js";
import { GitHubClient } from "../integrations/githubClient.js";
import { NimbleClient } from "../integrations/nimbleClient.js";
import { EventBus } from "./eventBus.js";
import { ProjectService } from "./projectService.js";
import { TaskService } from "./taskService.js";
import { LockService } from "./lockService.js";
import { DeltaService } from "./deltaService.js";
import { DebateService } from "./debateService.js";
import { PlanningService } from "./planningService.js";
import { SyncCoordinationService } from "./syncCoordinationService.js";
import { PresenceService } from "./presenceService.js";
import { Sweeper } from "./sweeper.js";

export interface Services {
  liveStore: LiveStore;
  streamStore: StreamStore;
  bus: EventBus;
  nimble: NimbleClient;
  project: ProjectService;
  task: TaskService;
  lock: LockService;
  delta: DeltaService;
  debate: DebateService;
  planning: PlanningService;
  sync: SyncCoordinationService;
  presence: PresenceService;
  sweeper: Sweeper;
}

// Composition root. Wires storage, integrations, and services, including the
// one cross-service hook (task -> sync barrier re-evaluation).
export function buildServices(): Services {
  const liveStore: LiveStore = new InMemoryLiveStore();
  const streamStore: StreamStore = new ClickHouseStreamStore();
  const bus = new EventBus(streamStore);

  const nimble = new NimbleClient();
  const anthropic = new AnthropicClient(nimble);
  const github = new GitHubClient();

  const project = new ProjectService(liveStore);
  const task = new TaskService(liveStore, bus);
  const lock = new LockService(liveStore, bus, streamStore);
  const delta = new DeltaService(liveStore, bus, streamStore);
  const debate = new DebateService(liveStore, bus, streamStore);
  const planning = new PlanningService(liveStore, anthropic, bus);
  const sync = new SyncCoordinationService(liveStore, bus, streamStore, github);
  const presence = new PresenceService(liveStore, bus);
  const sweeper = new Sweeper(liveStore, bus, debate);

  task.onStatusChange = (t) => sync.evaluatePhase(t.phaseId);

  return {
    liveStore,
    streamStore,
    bus,
    nimble,
    project,
    task,
    lock,
    delta,
    debate,
    planning,
    sync,
    presence,
    sweeper,
  };
}
