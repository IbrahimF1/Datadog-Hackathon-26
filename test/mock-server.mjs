#!/usr/bin/env node
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(__dirname, "..", "public");

const MOCK_TS = new Date().toISOString();

const DEMO_PROJECT_ID = "proj-demo001";

const fixtures = {
  project: {
    id: DEMO_PROJECT_ID,
    name: "E-Commerce API v2",
    description: "Build a modern e-commerce REST + GraphQL API with auth, payments, and inventory",
    githubRepo: "acme/ecommerce-api",
    githubBranch: "peer-progress",
    status: "active",
    team: [
      {
        id: "member-alice",
        name: "Alice",
        role: "backend",
        skills: ["node", "postgres", "graphql"],
        claudeSessionId: "sess-alice",
        confidenceScores: {},
      },
      {
        id: "member-bob",
        name: "Bob",
        role: "frontend",
        skills: ["react", "typescript"],
        claudeSessionId: "sess-bob",
        confidenceScores: {},
      },
      {
        id: "member-carol",
        name: "Carol",
        role: "devops",
        skills: ["docker", "k8s", "terraform"],
        confidenceScores: {},
      },
    ],
    phaseIds: ["ph-1", "ph-2", "ph-3"],
    questions: [],
    createdAt: MOCK_TS,
    updatedAt: MOCK_TS,
  },

  phases: [
    {
      id: "ph-1",
      projectId: DEMO_PROJECT_ID,
      name: "Phase 1: Authentication System",
      order: 0,
      taskIds: ["t-1", "t-2", "t-3"],
      mergePoint: { reached: false, syncedSessionIds: [] },
      contractsLocked: true,
    },
    {
      id: "ph-2",
      projectId: DEMO_PROJECT_ID,
      name: "Phase 2: Core API & Business Logic",
      order: 1,
      taskIds: ["t-4", "t-5", "t-6", "t-7"],
      mergePoint: { reached: false, syncedSessionIds: [] },
      contractsLocked: false,
    },
    {
      id: "ph-3",
      projectId: DEMO_PROJECT_ID,
      name: "Phase 3: Infrastructure & Deployment",
      order: 2,
      taskIds: ["t-8", "t-9"],
      mergePoint: { reached: false, syncedSessionIds: [] },
      contractsLocked: false,
    },
  ],

  tasks: [
    {
      id: "t-1",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-1",
      title: "Login Module",
      description: "JWT-based login with email/password",
      assigneeId: "member-alice",
      status: "in_progress",
      dependencies: [],
      requiredSkills: ["node"],
      interfaceContracts: [
        {
          id: "c-1",
          type: "api_endpoint",
          name: "POST /auth/login",
          definition: '{ email: string; password: string } => { token: string; refreshToken: string }',
          locked: true,
          approvedBy: ["sess-alice", "sess-bob"],
        },
      ],
      contextHistory: [],
    },
    {
      id: "t-2",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-1",
      title: "OAuth Integration",
      description: "Google and GitHub OAuth providers",
      assigneeId: "member-bob",
      status: "todo",
      dependencies: ["t-1"],
      requiredSkills: ["node", "react"],
      interfaceContracts: [],
      contextHistory: [],
    },
    {
      id: "t-3",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-1",
      title: "Session Management",
      description: "Refresh token rotation and session store",
      assigneeId: "member-alice",
      status: "review",
      dependencies: ["t-1"],
      requiredSkills: ["node", "postgres"],
      interfaceContracts: [],
      contextHistory: [],
    },
    {
      id: "t-4",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-2",
      title: "REST Endpoints",
      description: "CRUD endpoints for products, orders, users",
      assigneeId: "member-alice",
      status: "todo",
      dependencies: ["t-1", "t-3"],
      requiredSkills: ["node"],
      interfaceContracts: [
        {
          id: "c-2",
          type: "api_endpoint",
          name: "GET /products",
          definition: '{ page?: number; limit?: number } => Product[]',
          locked: false,
          approvedBy: [],
        },
      ],
      contextHistory: [],
    },
    {
      id: "t-5",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-2",
      title: "GraphQL Schema",
      description: "Type definitions and resolvers for product catalog",
      assigneeId: "member-bob",
      status: "done",
      dependencies: [],
      requiredSkills: ["graphql", "typescript"],
      interfaceContracts: [],
      contextHistory: [],
    },
    {
      id: "t-6",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-2",
      title: "Payment Gateway",
      description: "Stripe integration for checkout flow",
      assigneeId: null,
      status: "merge_point",
      dependencies: ["t-4", "t-5"],
      requiredSkills: ["node"],
      interfaceContracts: [],
      contextHistory: [],
    },
    {
      id: "t-7",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-2",
      title: "Validation Layer",
      description: "Zod schemas for all API inputs",
      assigneeId: "member-bob",
      status: "todo",
      dependencies: ["t-4"],
      requiredSkills: ["typescript"],
      interfaceContracts: [],
      contextHistory: [],
    },
    {
      id: "t-8",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-3",
      title: "Docker Compose Setup",
      description: "Multi-container dev environment",
      assigneeId: "member-carol",
      status: "todo",
      dependencies: ["t-4"],
      requiredSkills: ["docker"],
      interfaceContracts: [],
      contextHistory: [],
    },
    {
      id: "t-9",
      projectId: DEMO_PROJECT_ID,
      phaseId: "ph-3",
      title: "CI/CD Pipeline",
      description: "GitHub Actions workflow for test + deploy",
      assigneeId: "member-carol",
      status: "todo",
      dependencies: ["t-8"],
      requiredSkills: ["docker", "github-actions"],
      interfaceContracts: [],
      contextHistory: [],
    },
  ],

  locks: [
    {
      lockId: "lock-1",
      projectId: DEMO_PROJECT_ID,
      path: "src/auth/login.ts",
      lineStart: 15,
      lineEnd: 42,
      lockedBy: "sess-alice",
      reason: "Implementing JWT signing logic",
      lockedAt: MOCK_TS,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    },
    {
      lockId: "lock-2",
      projectId: DEMO_PROJECT_ID,
      path: "src/graphql/schema.graphql",
      lockedBy: "sess-bob",
      reason: "Finalizing product type resolvers",
      lockedAt: MOCK_TS,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    },
  ],

  sessions: [
    {
      id: "sess-alice",
      projectId: DEMO_PROJECT_ID,
      memberId: "member-alice",
      connectedAt: MOCK_TS,
      lastSeen: MOCK_TS,
    },
    {
      id: "sess-bob",
      projectId: DEMO_PROJECT_ID,
      memberId: "member-bob",
      connectedAt: MOCK_TS,
      lastSeen: MOCK_TS,
    },
  ],

  deltas: [
    {
      id: "delta-1",
      projectId: DEMO_PROJECT_ID,
      sourceSessionId: "sess-alice",
      type: "discovery",
      content: "Need to add refreshToken field to AuthResponse — current client code assumes it doesn't exist",
      severity: "warning",
      affectedContracts: ["c-1"],
      acknowledgedBy: ["sess-bob"],
      conflictsWith: [],
      timestamp: MOCK_TS,
    },
    {
      id: "delta-2",
      projectId: DEMO_PROJECT_ID,
      sourceSessionId: "sess-bob",
      taskId: "t-5",
      type: "contract_change",
      content: "Changed Product.price from number to { amount: number; currency: string } — multi-currency support needed",
      severity: "blocking",
      affectedContracts: ["c-2"],
      acknowledgedBy: [],
      conflictsWith: ["t-4"],
      timestamp: MOCK_TS,
    },
    {
      id: "delta-3",
      projectId: DEMO_PROJECT_ID,
      sourceSessionId: "sess-alice",
      type: "dependency_found",
      content: "REST endpoints depend on a shared validation layer — suggests adding it as Phase 2 prerequisite",
      severity: "info",
      affectedContracts: [],
      acknowledgedBy: ["sess-bob"],
      conflictsWith: [],
      timestamp: MOCK_TS,
    },
    {
      id: "delta-4",
      projectId: DEMO_PROJECT_ID,
      sourceSessionId: "sess-bob",
      type: "scope_change",
      content: "GraphQL schema now includes Order type — may affect payment gateway interface",
      severity: "warning",
      affectedContracts: [],
      acknowledgedBy: [],
      conflictsWith: ["t-6"],
      timestamp: MOCK_TS,
    },
  ],

  debates: [
    {
      id: "debate-1",
      projectId: DEMO_PROJECT_ID,
      topic: "AuthResponse shape — refreshToken field",
      conflictingDeltaId: "delta-2",
      initiatorSessionId: "sess-alice",
      responderSessionId: "sess-bob",
      status: "resolved",
      round: 3,
      position: "Add refreshToken as required field",
      constraints: ["Must not break existing client code"],
      proposedAlternatives: ["Make it optional", "Add new endpoint for refresh"],
      proposedResolution: "Make refreshToken optional with a deprecation notice on token-only responses",
      messages: [
        {
          id: "dm-1",
          debateId: "debate-1",
          projectId: DEMO_PROJECT_ID,
          sessionId: "sess-alice",
          round: 1,
          message: "I need to add refreshToken to POST /auth/login response. Current contract only returns token.",
          proposeResolution: false,
          timestamp: MOCK_TS,
        },
        {
          id: "dm-2",
          debateId: "debate-1",
          projectId: DEMO_PROJECT_ID,
          sessionId: "sess-bob",
          round: 1,
          message: "That breaks my implementation in src/dashboard/api.ts:30 — I'm deserializing the response directly.",
          proposeResolution: false,
          timestamp: MOCK_TS,
        },
        {
          id: "dm-3",
          debateId: "debate-1",
          projectId: DEMO_PROJECT_ID,
          sessionId: "sess-alice",
          round: 2,
          message: "What if we make it optional? I'll update your types file too.",
          proposeResolution: false,
          timestamp: MOCK_TS,
        },
        {
          id: "dm-4",
          debateId: "debate-1",
          projectId: DEMO_PROJECT_ID,
          sessionId: "sess-bob",
          round: 3,
          message: "Approved — make it optional with a @deprecated comment on the token-only path.",
          proposeResolution: true,
          timestamp: MOCK_TS,
        },
      ],
      lastActivityAt: MOCK_TS,
      createdAt: MOCK_TS,
    },
    {
      id: "debate-2",
      projectId: DEMO_PROJECT_ID,
      topic: "Product.price type change",
      conflictingDeltaId: "delta-2",
      initiatorSessionId: "sess-bob",
      responderSessionId: "sess-alice",
      status: "active",
      round: 1,
      position: "Multi-currency requires a structured price type",
      constraints: ["REST endpoint GET /products already returns number price", "Existing orders use flat number"],
      proposedAlternatives: ["Keep number, add currency field at order level"],
      proposedResolution: null,
      messages: [
        {
          id: "dm-5",
          debateId: "debate-2",
          projectId: DEMO_PROJECT_ID,
          sessionId: "sess-bob",
          round: 1,
          message: "Changed Product.price to { amount, currency } in GraphQL schema. Multi-currency is a requirement from stakeholders.",
          proposeResolution: false,
          timestamp: MOCK_TS,
        },
        {
          id: "dm-6",
          debateId: "debate-2",
          projectId: DEMO_PROJECT_ID,
          sessionId: "sess-alice",
          round: 1,
          message: "This breaks the REST /products endpoint — my serializer expects a number. Can we do this at the order level instead?",
          proposeResolution: false,
          timestamp: MOCK_TS,
        },
      ],
      lastActivityAt: MOCK_TS,
      createdAt: MOCK_TS,
    },
  ],
};

function getFullState(projectId) {
  if (projectId === DEMO_PROJECT_ID) {
    return {
      project: fixtures.project,
      phases: fixtures.phases,
      tasks: fixtures.tasks,
      locks: fixtures.locks,
      deltas: fixtures.deltas,
      debates: fixtures.debates,
      sessions: fixtures.sessions,
    };
  }
  return {
    project: {
      id: projectId,
      name: "New Project",
      description: "",
      githubRepo: "",
      githubBranch: "peer-progress",
      status: "planning",
      team: [],
      phaseIds: [],
      questions: [],
      createdAt: MOCK_TS,
      updatedAt: MOCK_TS,
    },
    phases: [],
    tasks: [],
    locks: [],
    deltas: [],
    debates: [],
    sessions: [],
  };
}

const createdProjects = new Map();

function app() {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(express.static(STATIC_DIR));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/projects", (_req, res) => {
    const demo = { id: DEMO_PROJECT_ID, name: fixtures.project.name, status: "active" };
    const extras = [...createdProjects.values()].map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
    }));
    res.json([demo, ...extras]);
  });

  app.post("/api/projects", (req, res) => {
    const id = `proj-${Date.now()}`;
    const p = {
      id,
      name: req.body.name || "Untitled",
      description: req.body.description || "",
      githubRepo: "",
      githubBranch: "peer-progress",
      status: "planning",
      team: (req.body.team || []).map((m, i) => ({
        id: `member-${Date.now()}-${i}`,
        name: m.name,
        role: m.role,
        skills: m.skills || [],
        confidenceScores: {},
      })),
      phaseIds: [],
      questions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    createdProjects.set(id, p);
    res.status(201).json(p);
  });

  app.get("/api/projects/:id", (req, res) => {
    res.json(getFullState(req.params.id));
  });

  app.put("/api/projects/:id/decompose", (req, res) => {
    if (createdProjects.has(req.params.id)) {
      createdProjects.get(req.params.id).status = "active";
    }
    res.json(getFullState(req.params.id));
  });

  app.post("/api/projects/:id/team", (req, res) => {
    const member = {
      id: `member-${Date.now()}`,
      name: req.body.name || "New Member",
      role: req.body.role || "fullstack",
      skills: req.body.skills || [],
      confidenceScores: {},
    };
    res.status(201).json(member);
  });

  app.get("/api/projects/:id/team/:memberId/questions", (_req, res) => res.json([]));

  app.post("/api/projects/:id/team/:memberId/answers", (_req, res) => res.json([]));

  app.get("/api/projects/:id/tasks", (req, res) => {
    res.json(getFullState(req.params.id).tasks);
  });

  app.put("/api/projects/:id/tasks/:taskId/assign", (req, res) => {
    res.json({ ok: true, taskId: req.params.taskId, assigneeId: req.body.memberId });
  });

  app.put("/api/projects/:id/tasks/:taskId/status", (req, res) => {
    res.json({ ok: true, taskId: req.params.taskId, status: req.body.status });
  });

  app.put("/api/projects/:id/tasks/:taskId/lock", (req, res) => {
    const lockId = `lock-${Date.now()}`;
    res.status(201).json({
      lockId,
      projectId: req.params.id,
      path: req.body.path,
      lockedBy: "ui",
      reason: req.body.reason || "",
      lockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  });

  app.delete("/api/projects/:id/tasks/:taskId/lock", (_req, res) => res.status(204).end());

  app.post("/mcp/context", (req, res) => {
    const delta = {
      id: `delta-${Date.now()}`,
      projectId: req.body.projectId,
      sourceSessionId: "ui",
      type: req.body.type || "discovery",
      content: req.body.content || "",
      severity: req.body.severity || "info",
      affectedContracts: req.body.affectedContracts || [],
      acknowledgedBy: [],
      conflictsWith: [],
      timestamp: new Date().toISOString(),
    };
    res.status(201).json(delta);
  });

  app.get("/mcp/context/:projectId", (req, res) => {
    const state = getFullState(req.params.projectId);
    res.json({ deltas: state.deltas, requiresAction: state.deltas.some((d) => d.severity === "blocking") });
  });

  app.post("/mcp/context/:projectId/:deltaId/ack", (req, res) => {
    res.json({ acknowledged: req.params.deltaId });
  });

  app.post("/mcp/debate", (req, res) => {
    if (req.body.action === "respond") {
      res.json({ ok: true, debateId: req.body.debateId });
    } else {
      res.status(201).json({
        id: `debate-${Date.now()}`,
        status: "awaiting_response",
        topic: req.body.topic,
      });
    }
  });

  app.get("/mcp/debate/:debateId", (_req, res) => res.json(null));

  app.post("/api/projects/:id/sync", (req, res) => {
    if (req.body?.action === "complete") {
      res.json({ synced: true });
    } else {
      res.json({ syncToken: `sync-${Date.now()}` });
    }
  });

  app.get("/api/projects/:id/conflicts", (req, res) => {
    const state = getFullState(req.params.id);
    res.json({ conflictingDeltas: state.deltas.filter((d) => d.conflictsWith.length > 0), activeDebates: state.debates.filter((d) => d.status === "active") });
  });

  app.post("/api/projects/:id/conflicts/:conflictId/resolve", (req, res) => {
    res.json({ resolved: req.params.conflictId });
  });

  app.post("/api/projects/:id/presence", (req, res) => {
    res.json({ sessionId: "ui", projectId: req.params.id, memberId: req.body?.memberId });
  });

  app.get("/api/projects/:id/presence", (req, res) => {
    res.json(getFullState(req.params.id).sessions);
  });

  app.get("/api/projects/:id/events", (_req, res) => res.json([]));

  app.use("/api", (req, res) => {
    console.log(`  [mock] unhandled: ${req.method} ${req.url}`);
    res.json({});
  });

  return app;
}

const PORT = Number(process.env.MOCK_PORT || 3001);
const expressApp = app();
const server = createServer(expressApp);

const wss = new WebSocketServer({ server, path: "/ws" });

const wsEvents = [
  { event: "task_update", taskId: "t-2", status: "in_progress", message: "Bob started OAuth Integration" },
  { event: "lock_changed", path: "src/auth/oauth.ts", lockedBy: "sess-bob", message: "Bob locked oauth.ts" },
  { event: "delta_received", deltaId: "delta-5", message: "New context delta from Alice" },
  { event: "debate_update", debateId: "debate-2", message: "Debate round 2 started" },
  { event: "presence", memberId: "member-carol", message: "Carol is now online" },
  { event: "sync_complete", commitSha: "abc1234", message: "Alice synced to peer-progress" },
];

let eventIndex = 0;

wss.on("connection", (ws, req) => {
  const params = new URL(req.url, `http://localhost`).searchParams;
  const projectId = params.get("projectId") || "unknown";
  console.log(`  [ws] client connected (project=${projectId})`);

  ws.on("message", (data) => {
    console.log(`  [ws] received: ${data}`);
  });

  const interval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(interval);
      return;
    }
    const evt = wsEvents[eventIndex % wsEvents.length];
    eventIndex++;
    const msg = {
      ...evt,
      projectId,
      ts: new Date().toISOString(),
    };
    ws.send(JSON.stringify(msg));
  }, 4000);

  ws.on("close", () => {
    console.log("  [ws] client disconnected");
    clearInterval(interval);
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────┐");
  console.log("  │  PeerCode Mock Server                                │");
  console.log(`  │  Frontend → http://localhost:${PORT}                    │`);
  console.log("  │  REST     → /api/*                                   │");
  console.log("  │  WebSocket → /ws?projectId=...                       │");
  console.log("  │                                                      │");
  console.log("  │  Pre-loaded demo project with phases, tasks, locks,  │");
  console.log("  │  deltas, and debates. WebSocket events every 4s.     │");
  console.log("  │                                                      │");
  console.log("  │  Press Ctrl+C to stop                                │");
  console.log("  └──────────────────────────────────────────────────────┘");
  console.log("");
});
