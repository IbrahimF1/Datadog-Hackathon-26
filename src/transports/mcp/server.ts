import { randomUUID } from "node:crypto";
import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Services } from "../../services/container.js";
import { annotate, traceSpan } from "../../observability/datadog.js";
import { newId } from "../../util/id.js";
import { NotFoundError } from "../../services/errors.js";

type ToolArgs = Record<string, any>;

// Wrap every tool call in a Datadog agent-action span, auto-register presence,
// and convert domain errors into structured MCP error results.
async function invoke(
  services: Services,
  name: string,
  args: ToolArgs,
  fn: () => unknown,
) {
  return traceSpan({ kind: "tool", name: `mcp.${name}` }, async () => {
    annotate({
      inputData: args,
      tags: { tool: name, sessionId: args.sessionId, projectId: args.projectId },
    });
    try {
      if (args.projectId && args.sessionId) {
        services.presence.register(args.projectId, args.sessionId);
      }
      const result = await fn();
      annotate({ outputData: result });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const e = err as { message?: string; code?: string };
      const payload = { error: e?.message ?? String(err), code: e?.code ?? "error" };
      annotate({ outputData: payload, tags: { error: true } });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        isError: true,
      };
    }
  });
}

const severity = z.enum(["info", "warning", "blocking"]);
const deltaType = z.enum([
  "discovery",
  "contract_change",
  "dependency_found",
  "scope_change",
]);

export function buildMcpServer(services: Services): McpServer {
  const server = new McpServer({ name: "peercode", version: "0.1.0" });

  server.registerTool(
    "peercode_get_project",
    {
      description: "Get full project state: phases, tasks, locks, deltas, debates, sessions.",
      inputSchema: { projectId: z.string(), sessionId: z.string().optional() },
    },
    (a) => invoke(services, "peercode_get_project", a, () => services.project.getFullState(a.projectId)),
  );

  server.registerTool(
    "peercode_lock_file",
    {
      description: "Acquire a lock on a file or line range before editing.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        filePath: z.string(),
        lineStart: z.number().optional(),
        lineEnd: z.number().optional(),
        reason: z.string().default(""),
      },
    },
    (a) =>
      invoke(services, "peercode_lock_file", a, () =>
        services.lock.acquire({
          projectId: a.projectId,
          sessionId: a.sessionId,
          path: a.filePath,
          lineStart: a.lineStart,
          lineEnd: a.lineEnd,
          reason: a.reason ?? "",
        }),
      ),
  );

  server.registerTool(
    "peercode_release_lock",
    {
      description: "Release a lock you hold.",
      inputSchema: { projectId: z.string(), sessionId: z.string(), lockId: z.string() },
    },
    (a) =>
      invoke(services, "peercode_release_lock", a, () => {
        services.lock.release(a.projectId, a.sessionId, a.lockId);
        return { released: a.lockId };
      }),
  );

  server.registerTool(
    "peercode_heartbeat",
    {
      description: "Extend a lock's expiry (call within the heartbeat interval).",
      inputSchema: { projectId: z.string(), sessionId: z.string(), lockId: z.string() },
    },
    (a) =>
      invoke(services, "peercode_heartbeat", a, () =>
        services.lock.heartbeat(a.projectId, a.sessionId, a.lockId),
      ),
  );

  server.registerTool(
    "peercode_push_delta",
    {
      description: "Push a context discovery or change to the shared plan.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        type: deltaType,
        content: z.string(),
        severity: severity.default("info"),
        affectedContracts: z.array(z.string()).optional(),
        taskId: z.string().optional(),
      },
    },
    (a) =>
      invoke(services, "peercode_push_delta", a, () =>
        services.delta.push({
          projectId: a.projectId,
          sessionId: a.sessionId,
          taskId: a.taskId,
          type: a.type,
          content: a.content,
          severity: a.severity ?? "info",
          affectedContracts: a.affectedContracts,
        }),
      ),
  );

  server.registerTool(
    "peercode_get_deltas",
    {
      description: "Check for context updates from peers. requiresAction flags conflicts.",
      inputSchema: { projectId: z.string(), sessionId: z.string(), since: z.string().optional() },
    },
    (a) =>
      invoke(services, "peercode_get_deltas", a, () =>
        services.delta.getDeltas(a.projectId, a.sessionId, a.since),
      ),
  );

  server.registerTool(
    "peercode_ack_delta",
    {
      description: "Acknowledge a delta as non-conflicting.",
      inputSchema: { projectId: z.string(), sessionId: z.string(), deltaId: z.string() },
    },
    (a) =>
      invoke(services, "peercode_ack_delta", a, () =>
        services.delta.ack(a.projectId, a.deltaId, a.sessionId),
      ),
  );

  server.registerTool(
    "peercode_start_debate",
    {
      description: "Flag a conflict and start a structured debate with a peer.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        conflictingDeltaId: z.string().optional(),
        topic: z.string().optional(),
        position: z.string(),
        constraints: z.array(z.string()).default([]),
        proposedAlternatives: z.array(z.string()).default([]),
        responderSessionId: z.string().optional(),
      },
    },
    (a) =>
      invoke(services, "peercode_start_debate", a, () =>
        services.debate.start({
          projectId: a.projectId,
          sessionId: a.sessionId,
          conflictingDeltaId: a.conflictingDeltaId,
          topic: a.topic,
          position: a.position,
          constraints: a.constraints ?? [],
          proposedAlternatives: a.proposedAlternatives ?? [],
          responderSessionId: a.responderSessionId,
        }),
      ),
  );

  server.registerTool(
    "peercode_respond_debate",
    {
      description: "Respond in an active debate. Set proposeResolution or escalateToHuman as needed.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        debateId: z.string(),
        message: z.string(),
        proposeResolution: z.boolean().optional(),
        escalateToHuman: z.boolean().optional(),
      },
    },
    (a) =>
      invoke(services, "peercode_respond_debate", a, () =>
        services.debate.respond({
          projectId: a.projectId,
          debateId: a.debateId,
          sessionId: a.sessionId,
          message: a.message,
          proposeResolution: a.proposeResolution,
          escalateToHuman: a.escalateToHuman,
        }),
      ),
  );

  server.registerTool(
    "peercode_get_debate",
    {
      description: "Get a debate by id, or all active debates for the project.",
      inputSchema: { projectId: z.string(), debateId: z.string().optional(), sessionId: z.string().optional() },
    },
    (a) =>
      invoke(services, "peercode_get_debate", a, () => ({
        debates: services.debate.get(a.projectId, a.debateId),
      })),
  );

  server.registerTool(
    "peercode_sync_github",
    {
      description:
        "Coordinate a push to peer-progress. action=start grants a sync token + commits to pull first; action=complete reports your new commit SHA. You perform the actual git push yourself.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        action: z.enum(["start", "complete"]).default("start"),
        commitSha: z.string().optional(),
      },
    },
    (a) =>
      invoke(services, "peercode_sync_github", a, () =>
        a.action === "complete"
          ? services.sync.completeSync(a.projectId, a.sessionId, a.commitSha ?? "")
          : services.sync.startSync(a.projectId, a.sessionId),
      ),
  );

  // --- Dynamic Planning Tools (for autonomous agent replanning) ---

  server.registerTool(
    "peercode_create_phase",
    {
      description: "Create a new phase dynamically during execution. Use when the team discovers a new major milestone or structural boundary.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        name: z.string(),
        order: z.number().optional(),
      },
    },
    (a) =>
      invoke(services, "peercode_create_phase", a, async () => {
        const phase = await services.liveStore.createPhase({
          id: newId("phase"),
          projectId: a.projectId,
          name: a.name,
          order: a.order ?? 0,
          taskIds: [],
          mergePoint: { reached: false, syncedSessionIds: [] },
          contractsLocked: false,
        });
        services.bus.emit("task_update", a.projectId, {
          type: "phase_created",
          phaseId: phase.id,
          name: phase.name,
        });
        return phase;
      }),
  );

  server.registerTool(
    "peercode_create_task",
    {
      description: "Create a new task dynamically. Use when discovering unplanned work, splitting tasks, or adding dependencies.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        phaseId: z.string(),
        title: z.string(),
        description: z.string(),
        assigneeId: z.string().optional(),
        dependencies: z.array(z.string()).optional(),
        requiredSkills: z.array(z.string()).optional(),
      },
    },
    (a) =>
      invoke(services, "peercode_create_task", a, async () => {
        const task = await services.liveStore.createTask({
          id: newId("task"),
          projectId: a.projectId,
          phaseId: a.phaseId,
          title: a.title,
          description: a.description,
          assigneeId: a.assigneeId,
          status: "todo",
          dependencies: a.dependencies ?? [],
          requiredSkills: a.requiredSkills ?? [],
          interfaceContracts: [],
          contextHistory: [],
        });
        // Add task to phase
        const phase = await services.liveStore.getPhase(a.phaseId);
        if (phase) {
          await services.liveStore.updatePhase(a.phaseId, {
            taskIds: [...phase.taskIds, task.id],
          });
        }
        services.bus.emit("task_update", a.projectId, {
          type: "task_created",
          taskId: task.id,
          title: task.title,
          phaseId: a.phaseId,
        });
        return task;
      }),
  );

  server.registerTool(
    "peercode_update_task",
    {
      description: "Update a task's properties dynamically. Use for reassigning, changing status, adding dependencies, or modifying scope.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        taskId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        assigneeId: z.string().optional(),
        status: z.enum(["todo", "in_progress", "review", "merge_point", "done"]).optional(),
        dependencies: z.array(z.string()).optional(),
      },
    },
    (a) =>
      invoke(services, "peercode_update_task", a, async () => {
        const patch: any = {};
        if (a.title !== undefined) patch.title = a.title;
        if (a.description !== undefined) patch.description = a.description;
        if (a.assigneeId !== undefined) patch.assigneeId = a.assigneeId;
        if (a.status !== undefined) patch.status = a.status;
        if (a.dependencies !== undefined) patch.dependencies = a.dependencies;
        
        const task = await services.liveStore.updateTask(a.taskId, patch);
        services.bus.emit("task_update", a.projectId, {
          type: "task_updated",
          taskId: task.id,
          changes: Object.keys(patch),
        });
        if (a.status === "merge_point") {
          services.task.onStatusChange?.(task);
        }
        return task;
      }),
  );

  server.registerTool(
    "peercode_move_task",
    {
      description: "Move a task to a different phase. Use when replanning work across milestones.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        taskId: z.string(),
        targetPhaseId: z.string(),
      },
    },
    (a) =>
      invoke(services, "peercode_move_task", a, async () => {
        const task = await services.liveStore.getTask(a.taskId);
        if (!task) throw new NotFoundError("task");
        const oldPhaseId = task.phaseId;
        
        // Update task's phase
        const updated = await services.liveStore.updateTask(a.taskId, { phaseId: a.targetPhaseId });
        
        // Remove from old phase
        const oldPhase = await services.liveStore.getPhase(oldPhaseId);
        if (oldPhase) {
          await services.liveStore.updatePhase(oldPhaseId, {
            taskIds: oldPhase.taskIds.filter((id: string) => id !== a.taskId),
          });
        }
        
        // Add to new phase
        const newPhase = await services.liveStore.getPhase(a.targetPhaseId);
        if (newPhase) {
          await services.liveStore.updatePhase(a.targetPhaseId, {
            taskIds: [...newPhase.taskIds, a.taskId],
          });
        }
        
        services.bus.emit("task_update", a.projectId, {
          type: "task_moved",
          taskId: a.taskId,
          fromPhase: oldPhaseId,
          toPhase: a.targetPhaseId,
        });
        return updated;
      }),
  );

  server.registerTool(
    "peercode_replan",
    {
      description: "Trigger AI replanning based on current project reality. Call when the team detects significant divergence from plan. Requires ANTHROPIC_API_KEY to be configured on the server.",
      inputSchema: {
        projectId: z.string(),
        sessionId: z.string(),
        reason: z.string(),
        context: z.string().optional(),
      },
    },
    (a) =>
      invoke(services, "peercode_replan", a, async () => {
        // Get current state for context
        const phases = await services.liveStore.listPhases(a.projectId);
        const tasks = await services.liveStore.listTasks(a.projectId);
        
        // Push a delta documenting the replan trigger
        const replanDelta = await services.delta.push({
          projectId: a.projectId,
          sessionId: a.sessionId,
          type: "scope_change",
          content: `Replanning triggered: ${a.reason}`,
          severity: "warning",
        });
        
        // Trigger decomposition with current reality as context
        const updated = await services.planning.decompose(a.projectId);
        
        services.bus.emit("task_update", a.projectId, {
          type: "replanned",
          reason: a.reason,
          deltaId: replanDelta.id,
          phases: updated.phaseIds?.length ?? 0,
        });
        
        return {
          replanned: true,
          project: updated,
          phases,
          tasks,
          contextUsed: a.context,
        };
      }),
  );

  // Nimble web search is only exposed when configured (debates/planning use).
  if (services.nimble.available()) {
    server.registerTool(
      "peercode_web_search",
      {
        description:
          "Search the web via Nimble. Use ONLY during debates (to resolve technical disagreements with current facts) or planning Q&A — not for general lookups.",
        inputSchema: { sessionId: z.string().optional(), query: z.string(), limit: z.number().optional() },
      },
      (a) =>
        invoke(services, "peercode_web_search", a, async () => ({
          results: await services.nimble.search(a.query, a.limit ?? 5),
        })),
    );
  }

  return server;
}

// Express router implementing the Streamable HTTP transport with per-session
// transports keyed by the mcp-session-id header.
export function buildMcpRouter(services: Services): Router {
  const router = Router();
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  router.post("/", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) delete transports[transport!.sessionId];
      };
      const server = buildMcpServer(services);
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session ID provided" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  const handleSession = async (req: any, res: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  };

  router.get("/", handleSession);
  router.delete("/", handleSession);

  return router;
}
