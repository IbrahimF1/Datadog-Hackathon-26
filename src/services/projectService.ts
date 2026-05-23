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

  async create(p: CreateProjectParams): Promise<Project> {
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
    return await this.store.createProject(project);
  }

  async get(id: string): Promise<Project> {
    const project = await this.store.getProject(id);
    if (!project) throw new NotFoundError("project");
    return project;
  }

  async list(): Promise<Project[]> {
    return await this.store.listProjects();
  }

  async getFullState(id: string): Promise<ProjectFullState> {
    const [project, phases, tasks, locks, deltas, debates, sessions] = await Promise.all([
      this.store.getProject(id),
      this.store.listPhases(id),
      this.store.listTasks(id),
      this.store.listLocks(id),
      this.store.listDeltas(id),
      this.store.listDebates(id),
      this.store.listSessions(id),
    ]);
    if (!project) throw new NotFoundError("project");
    return {
      project,
      phases,
      tasks,
      locks,
      deltas,
      debates,
      sessions,
    };
  }

  async addTeamMember(
    projectId: string,
    member: { name: string; role: Role; skills?: string[] },
  ): Promise<TeamMember> {
    const project = await this.get(projectId);
    const m: TeamMember = {
      id: newId("member"),
      name: member.name,
      role: member.role,
      skills: member.skills ?? [],
      confidenceScores: {},
    };
    await this.store.updateProject(projectId, { team: [...project.team, m] });
    return m;
  }

  async setStatus(id: string, status: Project["status"]): Promise<Project> {
    await this.get(id);
    return await this.store.updateProject(id, { status });
  }

  async getQuestions(projectId: string, memberId: string): Promise<PlanningQuestion[]> {
    const project = await this.get(projectId);
    return project.questions.filter((q) => q.memberId === memberId);
  }

  async submitAnswers(
    projectId: string,
    memberId: string,
    answers: { question: string; answer: string }[],
  ): Promise<PlanningQuestion[]> {
    const project = await this.get(projectId);
    const byQuestion = new Map(answers.map((a) => [a.question, a.answer]));
    const questions = project.questions.map((q) =>
      q.memberId === memberId && byQuestion.has(q.question)
        ? { ...q, answer: byQuestion.get(q.question) }
        : q,
    );
    await this.store.updateProject(projectId, { questions });
    return questions.filter((q) => q.memberId === memberId);
  }
}
