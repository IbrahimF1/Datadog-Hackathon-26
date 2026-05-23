import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { Services } from "../../services/container.js";

// Per-project subscription. Clients connect to /ws?projectId=<id> and receive
// every DomainEvent emitted for that project (the 5 TECH_SPEC §9 events + presence).
export function attachWebSocket(httpServer: Server, services: Services): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      ws.close(1008, "projectId query param required");
      return;
    }

    const unsubscribe = services.bus.subscribe(projectId, (event) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(event));
        } catch {
          /* drop */
        }
      }
    });

    ws.on("close", unsubscribe);
    ws.on("error", () => {});

    ws.send(
      JSON.stringify({
        event: "connected",
        projectId,
        ts: new Date().toISOString(),
      }),
    );
  });

  return wss;
}
