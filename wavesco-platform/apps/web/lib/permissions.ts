export type Role = "owner" | "admin" | "member";
export type Action = "create" | "read" | "update" | "delete" | "admin";

function rankOf(role: string): number {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  return 1;
}

/**
 * Role-based capability check.
 *
 * - read: any role
 * - create / update: admin+
 * - delete / admin: owner
 *
 * `resource` is reserved for resource-level permissions (modules may
 * extend this in Phase 6 via their contracts).
 */
export function can(user: { role: string }, action: Action, _resource: string): boolean {
  const rank = rankOf(user.role);
  switch (action) {
    case "read":
      return rank >= 1;
    case "create":
    case "update":
      return rank >= 2;
    case "delete":
    case "admin":
      return rank >= 3;
  }
}
