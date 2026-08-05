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
