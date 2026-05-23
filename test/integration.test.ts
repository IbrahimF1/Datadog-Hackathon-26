import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildServices } from "../src/services/container.js";
import { buildRestRouter } from "../src/transports/rest/router.js";
import { isDomainError } from "../src/services/errors.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const s = buildServices();
  const app = express();
  app.use(express.json());
  app.use("/api", buildRestRouter(s));
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (isDomainError(err)) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
    } else {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function jpost(path: string, body: unknown, session = "alice") {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": session },
    body: JSON.stringify(body),
  });
}
async function jput(path: string, body: unknown, session = "alice") {
  return fetch(base + path, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-session-id": session },
    body: JSON.stringify(body),
  });
}

describe("REST integration", () => {
  it("creates, lists, and fetches a project", async () => {
    const created = await (await jpost("/projects", { name: "P", description: "d" })).json();
    expect(created.id).toBeTruthy();
    const list = await (await fetch(base + "/projects")).json();
    expect(list.some((p: any) => p.id === created.id)).toBe(true);
    const full = await (await fetch(`${base}/projects/${created.id}`)).json();
    expect(full.project.id).toBe(created.id);
    expect(full.phases).toEqual([]);
  });

  it("acquires a lock and rejects a conflicting one with 409", async () => {
    const project = await (await jpost("/projects", { name: "L", description: "" })).json();
    const ok = await jput(`/projects/${project.id}/tasks/x/lock`, { path: "a.ts", reason: "r" }, "alice");
    expect(ok.status).toBe(201);
    const conflict = await jput(`/projects/${project.id}/tasks/x/lock`, { path: "a.ts", reason: "r" }, "bob");
    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    expect(body.code).toBe("lock_conflict");
  });

  it("pushes a delta and flags it for a peer", async () => {
    const project = await (await jpost("/projects", { name: "D", description: "" })).json();
    await jpost("/mcp/context", { projectId: project.id, type: "scope_change", content: "big", severity: "blocking" }, "alice");
    const deltas = await (await fetch(`${base}/mcp/context/${project.id}?sessionId=bob`)).json();
    expect(deltas.requiresAction).toBe(true);
  });
});
