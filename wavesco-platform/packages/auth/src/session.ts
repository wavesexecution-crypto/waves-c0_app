export interface SessionUser {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  name?: string | null;
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<SessionUser>;
  return (
    typeof user.id === "string" &&
    typeof user.tenantId === "string" &&
    typeof user.email === "string" &&
    typeof user.role === "string"
  );
}

/**
 * Throws unless a well-formed session user is present. Returns the
 * normalized user.
 */
export function requireSession(session: unknown): SessionUser {
  const user = (session as { user?: unknown } | null)?.user;
  if (!isSessionUser(user)) {
    throw new UnauthorizedError("A valid session is required.");
  }
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    name: user.name ?? null,
  };
}

export function requireRole(user: SessionUser, ...roles: string[]): void {
  if (!roles.includes(user.role)) {
    throw new ForbiddenError(`Role "${user.role}" is not allowed here.`);
  }
}

export function getTenantId(user: SessionUser): string {
  return user.tenantId;
}
