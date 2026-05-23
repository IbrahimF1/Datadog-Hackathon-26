import { describe, expect, it } from "vitest";
import { buildServices } from "../src/services/container.js";
import { SyncBusyError } from "../src/services/errors.js";

function setup() {
  const s = buildServices();
  const project = s.project.create({
    name: "t", description: "", team: [{ name: "Alice", role: "backend" }],
  });
  const projectId = project.id;
  const memberId = project.team[0].id;
  s.presence.register(projectId, "alice", memberId);

  s.liveStore.createTask({
    id: "task_1", projectId, phaseId: "ph1", title: "x", description: "",
    status: "merge_point", dependencies: [], requiredSkills: [],
    interfaceContracts: [{ id: "c1", type: "api_endpoint", name: "Auth", definition: "{}", locked: false, approvedBy: [] }],
    contextHistory: [],
  });
  s.liveStore.createPhase({
    id: "ph1", projectId, name: "P1", order: 0, taskIds: ["task_1"],
    mergePoint: { reached: false, syncedSessionIds: [] }, contractsLocked: false,
  });
  s.task.assign(projectId, "task_1", memberId);
  return { s, projectId };
}

describe("SyncCoordinationService", () => {
  it("serializes pushes with a sync token", () => {
    const { s, projectId } = setup();
    const start = s.sync.startSync(projectId, "alice");
    expect(start.status).toBe("go");
    expect(() => s.sync.startSync(projectId, "bob")).toThrow(SyncBusyError);
  });

  it("only the token holder can complete a sync", () => {
    const { s, projectId } = setup();
    s.sync.startSync(projectId, "alice");
    expect(() => s.sync.completeSync(projectId, "bob", "sha1")).toThrow();
    expect(() => s.sync.completeSync(projectId, "alice", "sha1")).not.toThrow();
  });

  it("reaches the merge-point barrier and locks contracts once everyone is in sync", () => {
    const { s, projectId } = setup();
    s.sync.startSync(projectId, "alice");
    const res = s.sync.completeSync(projectId, "alice", "sha1");
    expect(res.mergePointsReached).toContain("ph1");

    const phase = s.liveStore.getPhase("ph1")!;
    expect(phase.mergePoint.reached).toBe(true);
    expect(phase.contractsLocked).toBe(true);
    const task = s.liveStore.getTask("task_1")!;
    expect(task.interfaceContracts[0].locked).toBe(true);
  });
});
