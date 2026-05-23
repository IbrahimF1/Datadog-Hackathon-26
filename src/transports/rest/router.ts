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
  r.post("/projects", (req, res) => {
    res.status(201).json(s.project.create(req.body));
  });

  r.get("/projects", (_req, res) => {
    res.json(s.project.list());
  });

  r.get("/projects/:id", (req, res) => {
    res.json(s.project.getFullState(req.params.id));
  });

  r.put("/projects/:id/decompose", async (req, res) => {
    await s.planning.decompose(req.params.id);
    res.json(s.project.getFullState(req.params.id));
  });

  // --- Team ---
  r.post("/projects/:id/team", (req, res) => {
    res.status(201).json(s.project.addTeamMember(req.params.id, req.body));
  });

  r.get("/projects/:id/team/:memberId/questions", (req, res) => {
    res.json(s.project.getQuestions(req.params.id, req.params.memberId));
  });

  r.post("/projects/:id/team/:memberId/answers", (req, res) => {
    const answers = req.body?.answers ?? [];
    res.json(s.project.submitAnswers(req.params.id, req.params.memberId, answers));
  });

  // --- Tasks ---
  r.get("/projects/:id/tasks", (req, res) => {
    res.json(s.task.list(req.params.id));
  });

  r.put("/projects/:id/tasks/:taskId/assign", (req, res) => {
    if (!req.body?.memberId) throw new ValidationError("memberId is required");
    res.json(s.task.assign(req.params.id, req.params.taskId, req.body.memberId));
  });

  r.put("/projects/:id/tasks/:taskId/status", (req, res) => {
    if (!req.body?.status) throw new ValidationError("status is required");
    res.json(s.task.setStatus(req.params.id, req.params.taskId, req.body.status));
  });

  r.put("/projects/:id/tasks/:taskId/lock", (req, res) => {
    res.status(201).json(
      s.lock.acquire({
        projectId: req.params.id,
        sessionId: sid(req),
        path: req.body.path,
        lineStart: req.body.lineStart,
        lineEnd: req.body.lineEnd,
        reason: req.body.reason ?? "",
      }),
    );
  });

  r.delete("/projects/:id/tasks/:taskId/lock", (req, res) => {
    const lockId = (req.body?.lockId as string) || (req.query.lockId as string);
    if (!lockId) throw new ValidationError("lockId is required");
    s.lock.release(req.params.id, sid(req), lockId);
    res.status(204).end();
  });

  // --- Context deltas (MCP-mirrored REST) ---
  r.post("/mcp/context", (req, res) => {
    res.status(201).json(
      s.delta.push({
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

  r.get("/mcp/context/:projectId", (req, res) => {
    res.json(
      s.delta.getDeltas(
        req.params.projectId,
        sid(req),
        req.query.since as string | undefined,
      ),
    );
  });

  r.post("/mcp/context/:projectId/:deltaId/ack", (req, res) => {
    res.json(s.delta.ack(req.params.projectId, req.params.deltaId, sid(req)));
  });

  // --- Debates ---
  r.post("/mcp/debate", (req, res) => {
    const b = req.body;
    if (b.action === "respond") {
      res.json(
        s.debate.respond({
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
        s.debate.start({
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

  r.get("/mcp/debate/:debateId", (req, res) => {
    const projectId = req.query.projectId as string;
    if (!projectId) throw new ValidationError("projectId query is required");
    const [debate] = s.debate.get(projectId, req.params.debateId);
    res.json(debate ?? null);
  });

  // --- Sync coordination ---
  r.post("/projects/:id/sync", (req, res) => {
    const action = req.body?.action;
    if (action === "complete") {
      res.json(
        s.sync.completeSync(req.params.id, sid(req), req.body.commitSha),
      );
    } else {
      res.json(s.sync.startSync(req.params.id, sid(req)));
    }
  });

  r.get("/projects/:id/sync/status", async (_req, res) => {
    res.json(await s.sync.remoteStatus());
  });

  // --- Conflicts ---
  r.get("/projects/:id/conflicts", (req, res) => {
    const deltas = s.delta
      .getDeltas(req.params.id, sid(req))
      .deltas.filter((d) => d.conflictsWith.length > 0 || d.severity === "blocking");
    const debates = s.debate.get(req.params.id).filter((d) => d.status === "active");
    res.json({ conflictingDeltas: deltas, activeDebates: debates });
  });

  r.post("/projects/:id/conflicts/:conflictId/resolve", (req, res) => {
    res.json(s.delta.ack(req.params.id, req.params.conflictId, sid(req)));
  });

  // --- Presence + event history (UI helpers) ---
  r.post("/projects/:id/presence", (req, res) => {
    res.json(s.presence.register(req.params.id, sid(req), req.body?.memberId));
  });

  r.get("/projects/:id/presence", (req, res) => {
    res.json(s.presence.list(req.params.id));
  });

  r.get("/projects/:id/events", async (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    res.json(await s.streamStore.recentEvents(req.params.id, limit));
  });

  return r;
}
