import { describe, expect, it } from "vitest";
import { buildServices } from "../src/services/container.js";
import type { Task } from "../src/domain/types.js";

function setup() {
  const s = buildServices();
  const p = s.project.create({ name: "t", description: "" });
  return { s, projectId: p.id };
}

function seedTaskWithContract(s: ReturnType<typeof buildServices>, projectId: string, contractName: string): Task {
  const task: Task = {
    id: "task_1", projectId, phaseId: "ph", title: "Dashboard", description: "",
    status: "in_progress", dependencies: [], requiredSkills: [],
    interfaceContracts: [{ id: "c1", type: "type_definition", name: contractName, definition: "{}", locked: false, approvedBy: [] }],
    contextHistory: [],
  };
  return s.liveStore.createTask(task);
}

describe("DeltaService", () => {
  it("contract_change conflicts with another task referencing the contract", () => {
    const { s, projectId } = setup();
    seedTaskWithContract(s, projectId, "AuthResponse");
    const delta = s.delta.push({
      projectId, sessionId: "alice", type: "contract_change",
      content: "add refreshToken", severity: "warning", affectedContracts: ["AuthResponse"],
    });
    expect(delta.conflictsWith).toContain("task_1");
  });

  it("discovery deltas never auto-conflict", () => {
    const { s, projectId } = setup();
    seedTaskWithContract(s, projectId, "AuthResponse");
    const delta = s.delta.push({
      projectId, sessionId: "alice", type: "discovery", content: "needs redis", severity: "info",
    });
    expect(delta.conflictsWith).toHaveLength(0);
  });

  it("requiresAction is true for an unacked blocking delta from a peer", () => {
    const { s, projectId } = setup();
    s.delta.push({ projectId, sessionId: "alice", type: "scope_change", content: "3x bigger", severity: "blocking" });
    const forBob = s.delta.getDeltas(projectId, "bob");
    expect(forBob.requiresAction).toBe(true);
    const forAlice = s.delta.getDeltas(projectId, "alice"); // author doesn't need to act
    expect(forAlice.requiresAction).toBe(false);
  });

  it("acking clears the action requirement", () => {
    const { s, projectId } = setup();
    const d = s.delta.push({ projectId, sessionId: "alice", type: "scope_change", content: "x", severity: "blocking" });
    s.delta.ack(projectId, d.id, "bob");
    expect(s.delta.getDeltas(projectId, "bob").requiresAction).toBe(false);
  });
});
