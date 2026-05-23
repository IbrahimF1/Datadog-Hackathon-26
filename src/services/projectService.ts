import type {
  ContextDelta,
  Debate,
  FileLock,
  Phase,
  PlanningQuestion,
  Project,
  Role,
  Session,
  Task,
  TeamMember,
} from "../domain/types.js";
import type { LiveStore } from "../storage/liveStore.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { newId, now } from "../util/id.js";

export interface CreateProjectParams {
  name: string;
  description: string;
  githubRepo?: string;
  team?: { name: string; role: Role; skills?: string[] }[];
}

export interface ProjectFullState {
  project: Project;
  phases: Phase[];
  tasks: Task[];
  locks: FileLock[];
  deltas: ContextDelta[];
  debates: Debate[];
  sessions: Session[];
}

export class ProjectService {
  constructor(private readonly store: LiveStore) {}

  create(p: CreateProjectParams): Project {
    if (!p.name?.trim()) throw new ValidationError("project name is required");
    const team: TeamMember[] = (p.team ?? []).map((m) => ({
      id: newId("member"),
      name: m.name,
      role: m.role,
      skills: m.skills ?? [],
      confidenceScores: {},
    }));
    const ts = now();
    const project: Project = {
      id: newId("proj"),
      name: p.name,
      description: p.description ?? "",
      githubRepo: p.githubRepo ?? "",
      githubBranch: "peer-progress",
      status: "planning",
      team,
      phaseIds: [],
      questions: [],
      createdAt: ts,
      updatedAt: ts,
    };
    return this.store.createProject(project);
  }

  get(id: string): Project {
    const project = this.store.getProject(id);
    if (!project) throw new NotFoundError("project");
    return project;
  }

  list(): Project[] {
    return this.store.listProjects();
  }

  getFullState(id: string): ProjectFullState {
    const project = this.get(id);
    return {
      project,
      phases: this.store.listPhases(id),
      tasks: this.store.listTasks(id),
      locks: this.store.listLocks(id),
      deltas: this.store.listDeltas(id),
      debates: this.store.listDebates(id),
      sessions: this.store.listSessions(id),
    };
  }

  addTeamMember(
    projectId: string,
    member: { name: string; role: Role; skills?: string[] },
  ): TeamMember {
    const project = this.get(projectId);
    const m: TeamMember = {
      id: newId("member"),
      name: member.name,
      role: member.role,
      skills: member.skills ?? [],
      confidenceScores: {},
    };
    this.store.updateProject(projectId, { team: [...project.team, m] });
    return m;
  }

  setStatus(id: string, status: Project["status"]): Project {
    this.get(id);
    return this.store.updateProject(id, { status });
  }

  getQuestions(projectId: string, memberId: string): PlanningQuestion[] {
    const project = this.get(projectId);
    return project.questions.filter((q) => q.memberId === memberId);
  }

  submitAnswers(
    projectId: string,
    memberId: string,
    answers: { question: string; answer: string }[],
  ): PlanningQuestion[] {
    const project = this.get(projectId);
    const byQuestion = new Map(answers.map((a) => [a.question, a.answer]));
    const questions = project.questions.map((q) =>
      q.memberId === memberId && byQuestion.has(q.question)
        ? { ...q, answer: byQuestion.get(q.question) }
        : q,
    );
    this.store.updateProject(projectId, { questions });
    return questions.filter((q) => q.memberId === memberId);
  }
}
