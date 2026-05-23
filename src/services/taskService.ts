import type { Task, TaskStatus } from "../domain/types.js";
import type { LiveStore } from "../storage/liveStore.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { EventBus } from "./eventBus.js";

export class TaskService {
  // Wired by the service container to let the sync coordinator re-evaluate a
  // phase's merge-point barrier whenever a task enters merge_point status.
  onStatusChange?: (task: Task) => void;

  constructor(
    private readonly store: LiveStore,
    private readonly bus: EventBus,
  ) {}

  list(projectId: string): Task[] {
    return this.store.listTasks(projectId);
  }

  get(taskId: string): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw new NotFoundError("task");
    return task;
  }

  assign(projectId: string, taskId: string, memberId: string): Task {
    const task = this.get(taskId);
    if (task.projectId !== projectId) throw new NotFoundError("task");
    const project = this.store.getProject(projectId);
    if (project && !project.team.some((m) => m.id === memberId)) {
      throw new ValidationError("member is not on the project team");
    }
    const updated = this.store.updateTask(taskId, { assigneeId: memberId });
    this.bus.emit("task_update", projectId, {
      taskId,
      status: updated.status,
      assignee: memberId,
    });
    return updated;
  }

  setStatus(projectId: string, taskId: string, status: TaskStatus): Task {
    const task = this.get(taskId);
    if (task.projectId !== projectId) throw new NotFoundError("task");
    const updated = this.store.updateTask(taskId, { status });
    this.bus.emit("task_update", projectId, {
      taskId,
      status,
      assignee: updated.assigneeId,
    });
    if (status === "merge_point") this.onStatusChange?.(updated);
    return updated;
  }
}
