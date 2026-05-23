import { describe, expect, it } from "vitest";
import { buildServices } from "../src/services/container.js";
import { LockConflictError } from "../src/services/errors.js";

function setup() {
  const s = buildServices();
  const p = s.project.create({ name: "t", description: "" });
  return { s, projectId: p.id };
}

describe("LockService", () => {
  it("file-level lock blocks any sub-lock", () => {
    const { s, projectId } = setup();
    s.lock.acquire({ projectId, sessionId: "a", path: "f.ts", reason: "" });
    expect(() =>
      s.lock.acquire({ projectId, sessionId: "b", path: "f.ts", lineStart: 1, lineEnd: 5, reason: "" }),
    ).toThrow(LockConflictError);
  });

  it("a sub-lock blocks a file-level lock", () => {
    const { s, projectId } = setup();
    s.lock.acquire({ projectId, sessionId: "a", path: "f.ts", lineStart: 10, lineEnd: 20, reason: "" });
    expect(() =>
      s.lock.acquire({ projectId, sessionId: "b", path: "f.ts", reason: "" }),
    ).toThrow(LockConflictError);
  });

  it("overlapping ranges conflict, disjoint ranges do not", () => {
    const { s, projectId } = setup();
    s.lock.acquire({ projectId, sessionId: "a", path: "f.ts", lineStart: 10, lineEnd: 20, reason: "" });
    expect(() =>
      s.lock.acquire({ projectId, sessionId: "b", path: "f.ts", lineStart: 15, lineEnd: 25, reason: "" }),
    ).toThrow(LockConflictError);
    expect(() =>
      s.lock.acquire({ projectId, sessionId: "b", path: "f.ts", lineStart: 21, lineEnd: 30, reason: "" }),
    ).not.toThrow();
  });

  it("only the owner can release", () => {
    const { s, projectId } = setup();
    const lock = s.lock.acquire({ projectId, sessionId: "a", path: "f.ts", reason: "" });
    expect(() => s.lock.release(projectId, "b", lock.lockId)).toThrow();
    expect(() => s.lock.release(projectId, "a", lock.lockId)).not.toThrow();
    // after release the path is free again
    expect(() => s.lock.acquire({ projectId, sessionId: "b", path: "f.ts", reason: "" })).not.toThrow();
  });

  it("heartbeat extends expiry", () => {
    const { s, projectId } = setup();
    const lock = s.lock.acquire({ projectId, sessionId: "a", path: "f.ts", reason: "" });
    const before = lock.expiresAt;
    const updated = s.lock.heartbeat(projectId, "a", lock.lockId);
    expect(new Date(updated.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});
