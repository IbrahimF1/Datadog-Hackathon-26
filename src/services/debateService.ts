import { config } from "../config.js";
import type { Debate, DebateMessage, DebateStatus } from "../domain/types.js";
import type { LiveStore } from "../storage/liveStore.js";
import type { StreamStore } from "../storage/streamStore.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { EventBus } from "./eventBus.js";
import { newId, now } from "../util/id.js";

export interface StartDebateParams {
  projectId: string;
  sessionId: string; // initiator
  conflictingDeltaId?: string;
  topic?: string;
  position: string;
  constraints: string[];
  proposedAlternatives: string[];
  responderSessionId?: string;
}

export interface RespondDebateParams {
  projectId: string;
  debateId: string;
  sessionId: string;
  message: string;
  proposeResolution?: boolean;
  escalateToHuman?: boolean;
}

export class DebateService {
  constructor(
    private readonly store: LiveStore,
    private readonly bus: EventBus,
    private readonly stream: StreamStore,
  ) {}

  start(p: StartDebateParams): Debate {
    if (!this.store.getProject(p.projectId)) {
      throw new NotFoundError("project");
    }
    const delta = p.conflictingDeltaId
      ? this.store.getDelta(p.conflictingDeltaId)
      : undefined;
    const responder = p.responderSessionId ?? delta?.sourceSessionId;

    const debateId = newId("debate");
    const firstMessage: DebateMessage = {
      id: newId("msg"),
      debateId,
      projectId: p.projectId,
      sessionId: p.sessionId,
      round: 1,
      message: formatPosition(p.position, p.constraints, p.proposedAlternatives),
      proposeResolution: false,
      timestamp: now(),
    };

    const debate: Debate = {
      id: debateId,
      projectId: p.projectId,
      topic: p.topic ?? delta?.content ?? "context conflict",
      conflictingDeltaId: p.conflictingDeltaId,
      initiatorSessionId: p.sessionId,
      responderSessionId: responder,
      status: "active",
      round: 1,
      position: p.position,
      constraints: p.constraints,
      proposedAlternatives: p.proposedAlternatives,
      messages: [firstMessage],
      createdAt: firstMessage.timestamp,
      lastActivityAt: firstMessage.timestamp,
    };

    this.store.createDebate(debate);
    void this.stream.appendDebateMessage(firstMessage);
    this.bus.emit("debate_update", p.projectId, { debate });
    return debate;
  }

  respond(p: RespondDebateParams): Debate {
    const debate = this.store.getDebate(p.debateId);
    if (!debate || debate.projectId !== p.projectId) {
      throw new NotFoundError("debate");
    }
    if (debate.status !== "active") {
      throw new ValidationError(`debate is ${debate.status}, not active`);
    }

    const round = debate.round + 1;
    const message: DebateMessage = {
      id: newId("msg"),
      debateId: debate.id,
      projectId: p.projectId,
      sessionId: p.sessionId,
      round,
      message: p.message,
      proposeResolution: !!p.proposeResolution,
      timestamp: now(),
    };
    void this.stream.appendDebateMessage(message);

    let status: DebateStatus = debate.status;
    let proposedResolution = debate.proposedResolution;

    if (p.escalateToHuman) {
      status = "escalated";
    } else if (p.proposeResolution) {
      const prev = debate.messages[debate.messages.length - 1];
      // Two-party handshake: both sides propose resolution back-to-back -> resolved.
      if (prev && prev.proposeResolution && prev.sessionId !== p.sessionId) {
        status = "resolved";
        proposedResolution = p.message;
      } else {
        proposedResolution = p.message;
      }
    }

    if (status === "active" && round > config.debateMaxRounds) {
      status = "escalated"; // TECH_SPEC §8: max 5 rounds before escalation
    }

    const updated = this.store.updateDebate(debate.id, {
      messages: [...debate.messages, message],
      round,
      status,
      proposedResolution,
      lastActivityAt: message.timestamp,
    });

    if (status === "resolved" && debate.conflictingDeltaId) {
      this.acknowledgeResolvedDelta(debate);
    }

    this.bus.emit("debate_update", p.projectId, { debate: updated });
    return updated;
  }

  get(projectId: string, debateId?: string): Debate[] {
    if (debateId) {
      const d = this.store.getDebate(debateId);
      return d && d.projectId === projectId ? [d] : [];
    }
    return this.store.listDebates(projectId);
  }

  // Sweeper hook: escalate debates idle longer than the timeout.
  escalateTimedOut(projectId: string): Debate[] {
    const cutoff = Date.now() - config.debateTimeoutMs;
    const escalated: Debate[] = [];
    for (const d of this.store.listDebates(projectId)) {
      if (d.status !== "active") continue;
      if (new Date(d.lastActivityAt).getTime() < cutoff) {
        const u = this.store.updateDebate(d.id, { status: "escalated" });
        this.bus.emit("debate_update", projectId, { debate: u });
        escalated.push(u);
      }
    }
    return escalated;
  }

  private acknowledgeResolvedDelta(debate: Debate): void {
    const delta = this.store.getDelta(debate.conflictingDeltaId!);
    if (!delta) return;
    const ackers = new Set(delta.acknowledgedBy);
    ackers.add(debate.initiatorSessionId);
    if (debate.responderSessionId) ackers.add(debate.responderSessionId);
    this.store.updateDelta(delta.id, { acknowledgedBy: [...ackers] });
  }
}

function formatPosition(
  position: string,
  constraints: string[],
  alternatives: string[],
): string {
  return [
    `Position: ${position}`,
    `Constraints: ${constraints.join("; ") || "none stated"}`,
    `Proposals: ${alternatives.join("; ") || "none stated"}`,
  ].join("\n");
}
