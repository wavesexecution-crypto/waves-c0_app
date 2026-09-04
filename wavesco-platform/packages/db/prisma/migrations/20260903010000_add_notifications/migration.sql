-- Client-facing milestone notifications (idempotent, tenant-scoped).
-- The engine writes one Notification row per event x channel.
-- NotificationPreference toggles delivery by category x channel.
-- RLS: runtime role `wavesco_app` only sees/writes its own tenant's rows
-- (enforced by `SET LOCAL app.tenant_id` inside withTenantContext).

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "cycleId" TEXT,
    "campaignId" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "resourceHref" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");
CREATE INDEX "Notification_tenantId_read_createdAt_idx" ON "Notification"("tenantId", "read", "createdAt" DESC);
CREATE INDEX "Notification_tenantId_userId_idx" ON "Notification"("tenantId", "userId");
CREATE INDEX "Notification_tenantId_eventType_idx" ON "Notification"("tenantId", "eventType");

CREATE UNIQUE INDEX "NotificationPreference_tenantId_category_channel_key" ON "NotificationPreference"("tenantId", "category", "channel");
CREATE INDEX "NotificationPreference_tenantId_idx" ON "NotificationPreference"("tenantId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security -------------------------------------------------
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_isolation" ON "Notification" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "notificationpreference_isolation" ON "NotificationPreference" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "Notification", "NotificationPreference" TO wavesco_app;
