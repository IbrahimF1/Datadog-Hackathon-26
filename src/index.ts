import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { initObservability, flushObservability } from "./observability/datadog.js";
import { config } from "./config.js";
import { buildServices } from "./services/container.js";
import { buildRestRouter } from "./transports/rest/router.js";
import { buildMcpRouter } from "./transports/mcp/server.js";
import { attachWebSocket } from "./transports/ws/server.js";
import { isDomainError } from "./services/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  // Datadog LLM Observability first.
  initObservability();

  const services = buildServices();
  await services.streamStore.init();
  services.sweeper.start();

  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // MCP must be mounted before the JSON-heavy REST error handler; it manages
  // its own request lifecycle via the Streamable HTTP transport.
  app.use("/mcp", buildMcpRouter(services));
  app.use("/api", buildRestRouter(services));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, clickhouse: services.streamStore.healthy() });
  });

  // Static test UI.
  app.use(express.static(join(__dirname, "..", "public")));

  // Central error handler maps domain errors to HTTP responses.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isDomainError(err)) {
      res.status(err.httpStatus).json({
        error: err.message,
        code: err.code,
        details: err.details,
      });
      return;
    }
    console.error("[unhandled]", err);
    res.status(500).json({ error: (err as Error)?.message ?? "internal error" });
  });

  const httpServer = createServer(app);
  attachWebSocket(httpServer, services);

  httpServer.listen(config.port, () => {
    console.log(`[peercode] listening on http://localhost:${config.port}`);
    console.log(`[peercode]   REST  /api   MCP  /mcp   WS  /ws   UI  /`);
  });

  const shutdown = async () => {
    services.sweeper.stop();
    await flushObservability();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[peercode] fatal startup error", err);
  process.exit(1);
});
