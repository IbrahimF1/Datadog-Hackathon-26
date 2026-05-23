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
    const project = await this.store.getProject(projectId);
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

    for (const [idx, ph] of result.phases.entries()) {
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
        // Resolve assignee: try suggested name first, fallback to skill matching
        const assigneeId = pt.suggestedAssignee
          ? matchMemberId(project, pt.suggestedAssignee)
          : findBestAssigneeBySkills(project, pt.requiredSkills);
        const task: Task = {
          id: taskId,
          projectId,
          phaseId,
          title: pt.title,
          description: pt.description,
          assigneeId,
          status: "todo",
          dependencies: [],
          requiredSkills: pt.requiredSkills,
          interfaceContracts: contracts,
          contextHistory: [],
        };
        await this.store.createTask(task);
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
      await this.store.createPhase(phase);
      phaseIds.push(phaseId);
    }

    // Resolve dependency titles -> task ids (unknown titles dropped).
    for (const { taskId, depTitles } of pendingDeps) {
      const deps = depTitles
        .map((t) => titleToTaskId.get(t))
        .filter((id): id is string => !!id);
      await this.store.updateTask(taskId, { dependencies: deps });
    }

    const questions = result.questions.map((q) => ({
      memberId: matchMemberId(project, q.memberName),
      question: q.question,
    }));

    const updated = await this.store.updateProject(projectId, {
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

// Fallback: find best assignee by skill match and workload balance
function findBestAssigneeBySkills(project: Project, requiredSkills: string[]): string | undefined {
  if (project.team.length === 0) return undefined;
  if (project.team.length === 1) return project.team[0].id;
  if (requiredSkills.length === 0) return project.team[0].id;

  // Score each member by skill match (case-insensitive)
  const memberScores = project.team.map((member) => {
    const skillMatches = requiredSkills.filter((reqSkill) =>
      member.skills.some(
        (memberSkill) => memberSkill.toLowerCase() === reqSkill.toLowerCase()
      )
    ).length;
    return { memberId: member.id, score: skillMatches };
  });

  // Find max score
  const maxScore = Math.max(...memberScores.map((m) => m.score));
  const topCandidates = memberScores.filter((m) => m.score === maxScore);

  // If tie, pick first (could be enhanced with workload tracking)
  return topCandidates[0]?.memberId;
}
