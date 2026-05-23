import type { Session } from "../domain/types.js";
import type { LiveStore } from "../storage/liveStore.js";
import type { EventBus } from "./eventBus.js";
import { now } from "../util/id.js";

// Tracks which Claude sessions are connected to a project and links them to a
// team member. A session id is supplied by each MCP caller.
export class PresenceService {
  constructor(
    private readonly store: LiveStore,
    private readonly bus: EventBus,
  ) {}

  register(projectId: string, sessionId: string, memberId?: string): Session {
    const existing = this.store.getSession(sessionId);
    const session: Session = {
      id: sessionId,
      projectId,
      memberId: memberId ?? existing?.memberId,
      connectedAt: existing?.connectedAt ?? now(),
      lastSeen: now(),
    };
    this.store.upsertSession(session);

    // Link the session id onto the team member record if provided.
    if (memberId) {
      const project = this.store.getProject(projectId);
      if (project) {
        const team = project.team.map((m) =>
          m.id === memberId ? { ...m, claudeSessionId: sessionId } : m,
        );
        this.store.updateProject(projectId, { team });
      }
    }

    this.bus.emit("presence", projectId, {
      sessions: this.store.listSessions(projectId),
    });
    return session;
  }

  list(projectId: string): Session[] {
    return this.store.listSessions(projectId);
  }
}
