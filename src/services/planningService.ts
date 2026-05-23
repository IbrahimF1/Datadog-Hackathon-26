import type { Contract, Phase, Project, Task } from "../domain/types.js";
import type { LiveStore } from "../storage/liveStore.js";
import type { AnthropicClient } from "../integrations/anthropicClient.js";
import { NotFoundError } from "./errors.js";
import type { EventBus } from "./eventBus.js";
import { newId } from "../util/id.js";

export class PlanningService {
  constructor(
    private readonly store: LiveStore,
    private readonly anthropic: AnthropicClient,
    private readonly bus: EventBus,
  ) {}

  // Calls Claude to decompose the project, then materialises phases/tasks/
  // contracts/questions into the live store. Replaces any prior plan.
  async decompose(projectId: string): Promise<Project> {
    const project = this.store.getProject(projectId);
    if (!project) throw new NotFoundError("project");

    const memberName = (id: string) =>
      project.team.find((m) => m.id === id)?.name ?? "team";
    const answers = project.questions
      .filter((q) => q.answer)
      .map((q) => ({
        memberName: memberName(q.memberId),
        question: q.question,
        answer: q.answer!,
      }));

    const result = await this.anthropic.decompose({
      description: project.description,
      team: project.team.map((m) => ({
        name: m.name,
        role: m.role,
        skills: m.skills,
      })),
      answers,
    });

    const titleToTaskId = new Map<string, string>();
    const pendingDeps: { taskId: string; depTitles: string[] }[] = [];
    const phaseIds: string[] = [];

    result.phases.forEach((ph, idx) => {
      const phaseId = newId("phase");
      const taskIds: string[] = [];

      for (const pt of ph.tasks) {
        const taskId = newId("task");
        const contracts: Contract[] = pt.interfaceContracts.map((c) => ({
          id: newId("contract"),
          type: c.type,
          name: c.name,
          definition: c.definition,
          locked: false,
          approvedBy: [],
        }));
        const task: Task = {
          id: taskId,
          projectId,
          phaseId,
          title: pt.title,
          description: pt.description,
          status: "todo",
          dependencies: [],
          requiredSkills: pt.requiredSkills,
          interfaceContracts: contracts,
          contextHistory: [],
        };
        this.store.createTask(task);
        titleToTaskId.set(pt.title, taskId);
        taskIds.push(taskId);
        pendingDeps.push({ taskId, depTitles: pt.dependencies });
      }

      const phase: Phase = {
        id: phaseId,
        projectId,
        name: ph.name,
        order: idx,
        taskIds,
        mergePoint: { reached: false, syncedSessionIds: [] },
        contractsLocked: false,
      };
      this.store.createPhase(phase);
      phaseIds.push(phaseId);
    });

    // Resolve dependency titles -> task ids (unknown titles dropped).
    for (const { taskId, depTitles } of pendingDeps) {
      const deps = depTitles
        .map((t) => titleToTaskId.get(t))
        .filter((id): id is string => !!id);
      this.store.updateTask(taskId, { dependencies: deps });
    }

    const questions = result.questions.map((q) => ({
      memberId: matchMemberId(project, q.memberName),
      question: q.question,
    }));

    const updated = this.store.updateProject(projectId, {
      phaseIds,
      questions,
      status: "active",
    });

    this.bus.emit("task_update", projectId, {
      type: "decomposed",
      phases: phaseIds.length,
      tasks: titleToTaskId.size,
    });
    return updated;
  }
}

function matchMemberId(project: Project, name: string): string {
  const lower = name.trim().toLowerCase();
  const exact = project.team.find((m) => m.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = project.team.find(
    (m) => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()),
  );
  return partial?.id ?? "";
}
