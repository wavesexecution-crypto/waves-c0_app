import { withTenantContext } from "@wavesco/db";
import { auth } from "@/lib/auth";
import { requireSession } from "@wavesco/auth";
import { MilestoneNotificationCenter } from "@/components/milestone-notification-center";

/**
 * Server wrapper for the milestone notification center.
 * Loads the initial list/state under withTenantContext so RLS (`app.tenant_id`)
 * scopes the read to the authenticated tenant — never a client-supplied tenant.
 */
export async function MilestoneNotificationCenterServer() {
  const session = await auth();
  const user = requireSession(session);

  const { notifications, unreadCount } = await withTenantContext(
    user.tenantId,
    async (tx) => {
      const [items, unread] = await Promise.all([
        tx.notification.findMany({
          where: { tenantId: user.tenantId, channel: "in_app" },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            eventType: true,
            title: true,
            message: true,
            cycleId: true,
            campaignId: true,
            resourceType: true,
            resourceHref: true,
            channel: true,
            read: true,
            readAt: true,
            createdAt: true,
          },
        }),
        tx.notification.count({ where: { tenantId: user.tenantId, channel: "in_app", read: false } }),
      ]);
      return {
        notifications: items.map((n) => ({
          ...n,
          cycleId: n.cycleId ?? null,
          campaignId: n.campaignId ?? null,
          resourceType: n.resourceType ?? null,
          resourceHref: n.resourceHref ?? null,
          readAt: n.readAt ? n.readAt.toISOString() : null,
          createdAt: n.createdAt.toISOString(),
        })),
        unreadCount: unread,
      };
    },
  );

  return (
    <MilestoneNotificationCenter
      initial={{ notifications, total: notifications.length, unreadCount }}
    />
  );
}
