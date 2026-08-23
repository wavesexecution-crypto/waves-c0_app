import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError, requireSession, type SessionUser } from "@wavesco/auth";

/**
 * API-route session guard. Unlike the page-level requireSession (which
 * throws and surfaces as a 500), this converts auth failures into proper
 * 401/403 JSON responses.
 */
export function requireApiUser(
  session: unknown,
): { user: SessionUser; response?: never } | { user?: never; response: NextResponse } {
  try {
    return { user: requireSession(session) };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    if (err instanceof UnauthorizedError) {
      return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
}
