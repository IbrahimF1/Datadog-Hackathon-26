import { Router, type Request } from "express";
import type { Services } from "../../services/container.js";
import { ValidationError } from "../../services/errors.js";

// Session id for REST callers (the test UI). MCP callers pass their own.
function sid(req: Request): string {
  return (
    (req.headers["x-session-id"] as string) ||
    (req.body?.sessionId as string) ||
    (req.query.sessionId as string) ||
    "ui"
  );
}

export function buildRestRouter(s: Services): Router {
  const r = Router();

  // --- Projects ---
  r.post("/projects", async (req, res) => {
    res.status(201).json(await s.project.create(req.body));
  });

  r.get("/projects", async (_req, res) => {
    res.json(await s.project.list());
  });

  r.get("/projects/:id", async (req, res) => {
    res.json(await s.project.getFullState(req.params.id));
  });

  r.put("/projects/:id/decompose", async (req, res) => {
    await s.planning.decompose(req.params.id);
    res.json(await s.project.getFullState(req.params.id));
  });

  // --- Team ---
  r.post("/projects/:id/team", async (req, res) => {
    res.status(201).json(await s.project.addTeamMember(req.params.id, req.body));
  });

  r.get("/projects/:id/team/:memberId/questions", async (req, res) => {
    res.json(await s.project.getQuestions(req.params.id, req.params.memberId));
  });

  r.post("/projects/:id/team/:memberId/answers", async (req, res) => {
    const answers = req.body?.answers ?? [];
    res.json(await s.project.submitAnswers(req.params.id, req.params.memberId, answers));
  });

  // --- Tasks ---
  r.get("/projects/:id/tasks", async (req, res) => {
    res.json(await s.task.list(req.params.id));
  });

  r.put("/projects/:id/tasks/:taskId/assign", async (req, res) => {
    if (!req.body?.memberId) throw new ValidationError("memberId is required");
    res.json(await s.task.assign(req.params.id, req.params.taskId, req.body.memberId));
  });

  r.put("/projects/:id/tasks/:taskId/status", async (req, res) => {
    if (!req.body?.status) throw new ValidationError("status is required");
    res.json(await s.task.setStatus(req.params.id, req.params.taskId, req.body.status));
  });

  r.put("/projects/:id/tasks/:taskId/lock", async (req, res) => {
    res.status(201).json(
      await s.lock.acquire({
        projectId: req.params.id,
        sessionId: sid(req),
        path: req.body.path,
        lineStart: req.body.lineStart,
        lineEnd: req.body.lineEnd,
        reason: req.body.reason ?? "",
      }),
    );
  });

  r.delete("/projects/:id/tasks/:taskId/lock", async (req, res) => {
    const lockId = (req.body?.lockId as string) || (req.query.lockId as string);
    if (!lockId) throw new ValidationError("lockId is required");
    await s.lock.release(req.params.id, sid(req), lockId);
    res.status(204).end();
  });

  // --- Context deltas (MCP-mirrored REST) ---
  r.post("/mcp/context", async (req, res) => {
    res.status(201).json(
      await s.delta.push({
        projectId: req.body.projectId,
        sessionId: sid(req),
        taskId: req.body.taskId,
        type: req.body.type,
        content: req.body.content,
        severity: req.body.severity ?? "info",
        affectedContracts: req.body.affectedContracts,
      }),
    );
  });

  r.get("/mcp/context/:projectId", async (req, res) => {
    res.json(
      await s.delta.getDeltas(
        req.params.projectId,
        sid(req),
        req.query.since as string | undefined,
      ),
    );
  });

  r.post("/mcp/context/:projectId/:deltaId/ack", async (req, res) => {
    res.json(await s.delta.ack(req.params.projectId, req.params.deltaId, sid(req)));
  });

  // --- Debates ---
  r.post("/mcp/debate", async (req, res) => {
    const b = req.body;
    if (b.action === "respond") {
      res.json(
        await s.debate.respond({
          projectId: b.projectId,
          debateId: b.debateId,
          sessionId: sid(req),
          message: b.message,
          proposeResolution: b.proposeResolution,
          escalateToHuman: b.escalateToHuman,
        }),
      );
    } else {
      res.status(201).json(
        await s.debate.start({
          projectId: b.projectId,
          sessionId: sid(req),
          conflictingDeltaId: b.conflictingDeltaId,
          topic: b.topic,
          position: b.position ?? "",
          constraints: b.constraints ?? [],
          proposedAlternatives: b.proposedAlternatives ?? [],
          responderSessionId: b.responderSessionId,
        }),
      );
    }
  });

  r.get("/mcp/debate/:debateId", async (req, res) => {
    const projectId = req.query.projectId as string;
    if (!projectId) throw new ValidationError("projectId query is required");
    const [debate] = await s.debate.get(projectId, req.params.debateId);
    res.json(debate ?? null);
  });

  // --- Sync coordination ---
  r.post("/projects/:id/sync", async (req, res) => {
    const action = req.body?.action;
    if (action === "complete") {
      res.json(
        await s.sync.completeSync(req.params.id, sid(req), req.body.commitSha),
      );
    } else {
      res.json(await s.sync.startSync(req.params.id, sid(req)));
    }
  });

  // --- Conflicts ---
  r.get("/projects/:id/conflicts", async (req, res) => {
    const deltaResult = await s.delta.getDeltas(req.params.id, sid(req));
    const deltas = deltaResult.deltas.filter((d: any) => d.conflictsWith.length > 0 || d.severity === "blocking");
    const debates = (await s.debate.get(req.params.id)).filter((d) => d.status === "active");
    res.json({ conflictingDeltas: deltas, activeDebates: debates });
  });

  r.post("/projects/:id/conflicts/:conflictId/resolve", async (req, res) => {
    res.json(await s.delta.ack(req.params.id, req.params.conflictId, sid(req)));
  });

  // --- Presence + event history (UI helpers) ---
  r.post("/projects/:id/presence", async (req, res) => {
    res.json(await s.presence.register(req.params.id, sid(req), req.body?.memberId));
  });

  r.get("/projects/:id/presence", async (req, res) => {
    res.json(await s.presence.list(req.params.id));
  });

  r.get("/projects/:id/events", async (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    res.json(await s.streamStore.recentEvents(req.params.id, limit));
  });

  return r;
}
