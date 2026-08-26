import { withTenantContext } from "@wavesco/db";

/**
 * Shared loader for Client OS workspace pages. All reads run inside the
 * tenant context; returns null when the client does not belong to tenant.
 */
export async function getClientWorkspace(tenantId: string, clientId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const client = await tx.client.findFirst({ where: { id: clientId, tenantId } });
    if (!client) return null;
    const [steps, projects, activity] = await Promise.all([
      tx.onboardingStep.findMany({ where: { tenantId, clientId }, orderBy: { seq: "asc" } }),
      tx.project.findMany({ where: { tenantId, clientId }, orderBy: { createdAt: "desc" } }),
      tx.activityEvent.findMany({
        where: { tenantId, entityType: "client", entityId: clientId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    const projectIds = projects.map((p) => p.id);
    const [tasks, deliverables, projectActivity] = await Promise.all([
      projectIds.length > 0
        ? tx.projectTask.findMany({
            where: { tenantId, projectId: { in: projectIds } },
            orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          })
        : Promise.resolve([]),
      projectIds.length > 0
        ? tx.deliverable.findMany({
            where: { tenantId, projectId: { in: projectIds } },
            orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          })
        : Promise.resolve([]),
      projectIds.length > 0
        ? tx.activityEvent.findMany({
            where: { tenantId, entityType: "project", entityId: { in: projectIds } },
            orderBy: { createdAt: "desc" },
            take: 50,
          })
        : Promise.resolve([]),
    ]);
    const merged = [...activity, ...projectActivity]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
    return { client, steps, projects, tasks, deliverables, activity: merged };
  });
}

export type ClientWorkspace = NonNullable<Awaited<ReturnType<typeof getClientWorkspace>>>;
