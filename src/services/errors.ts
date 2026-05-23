// Typed domain errors. Each transport maps these to its own failure shape
// (REST -> HTTP status, MCP -> structured error result, WS -> ignored).

export class DomainError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    httpStatus: number,
    details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(`${what} not found`, "not_found", 404);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "validation_error", 400, details);
  }
}

export class LockConflictError extends DomainError {
  constructor(message: string, public readonly heldBy: string) {
    super(message, "lock_conflict", 409, { heldBy });
  }
}

export class SyncBusyError extends DomainError {
  constructor(public readonly heldBy: string) {
    super(
      `Another session is currently syncing; wait and retry`,
      "sync_busy",
      409,
      { heldBy },
    );
  }
}

export class ExternalServiceError extends DomainError {
  constructor(service: string, message: string) {
    super(`${service}: ${message}`, "external_service_error", 502);
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
