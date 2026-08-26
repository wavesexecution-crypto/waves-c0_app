import { redirect } from "next/navigation";

export function getTenantIdFromSession(session: unknown): string | null {
  const user = (session as { user?: Record<string, unknown> } | null)?.user;
  return typeof user?.tenantId === "string" ? user.tenantId : null;
}

export function getUserFromSession(session: unknown): Record<string, unknown> | null {
  const user = (session as { user?: Record<string, unknown> } | null)?.user;
  return user ?? null;
}

export function requireTenantId(session: unknown): string {
  const tenantId = getTenantIdFromSession(session);
  if (!tenantId) redirect("/login");
  return tenantId;
}

/** Internal-operator surfaces (Automation OS, module registry) are
 *  restricted to owner/admin roles; clients are redirected silently. */
export function requireInternalAccess(session: unknown): void {
  const user = getUserFromSession(session);
  const role = typeof user?.role === "string" ? user.role : "member";
  if (role !== "owner" && role !== "admin") redirect("/command");
}

export function hasInternalAccess(session: unknown): boolean {
  const user = getUserFromSession(session);
  const role = typeof user?.role === "string" ? user.role : "member";
  return role === "owner" || role === "admin";
}
