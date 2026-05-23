import { describe, expect, it } from "vitest";
import { buildServices } from "../src/services/container.js";
import { config } from "../src/config.js";

function setup() {
  const s = buildServices();
  const p = s.project.create({ name: "t", description: "" });
  return { s, projectId: p.id };
}

describe("DebateService", () => {
  it("starts active at round 1", () => {
    const { s, projectId } = setup();
    const d = s.debate.start({ projectId, sessionId: "alice", position: "need refreshToken", constraints: [], proposedAlternatives: [] });
    expect(d.status).toBe("active");
    expect(d.round).toBe(1);
  });

  it("resolves when both sides propose resolution back-to-back", () => {
    const { s, projectId } = setup();
    const d = s.debate.start({ projectId, sessionId: "alice", position: "p", constraints: [], proposedAlternatives: [] });
    s.debate.respond({ projectId, debateId: d.id, sessionId: "bob", message: "make it optional?", proposeResolution: true });
    const resolved = s.debate.respond({ projectId, debateId: d.id, sessionId: "alice", message: "agreed", proposeResolution: true });
    expect(resolved.status).toBe("resolved");
  });

  it("escalates after the max round cap", () => {
    const { s, projectId } = setup();
    const d = s.debate.start({ projectId, sessionId: "alice", position: "p", constraints: [], proposedAlternatives: [] });
    let last = d;
    for (let i = 0; i < config.debateMaxRounds + 1; i++) {
      if (last.status !== "active") break;
      last = s.debate.respond({ projectId, debateId: d.id, sessionId: i % 2 ? "alice" : "bob", message: "still disagree" });
    }
    expect(last.status).toBe("escalated");
  });

  it("escalateToHuman ends the debate immediately", () => {
    const { s, projectId } = setup();
    const d = s.debate.start({ projectId, sessionId: "alice", position: "p", constraints: [], proposedAlternatives: [] });
    const out = s.debate.respond({ projectId, debateId: d.id, sessionId: "bob", message: "no", escalateToHuman: true });
    expect(out.status).toBe("escalated");
  });
});
