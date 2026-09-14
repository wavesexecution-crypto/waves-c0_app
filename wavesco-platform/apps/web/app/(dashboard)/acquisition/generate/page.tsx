import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { GeneratePanel } from "@/components/acquisition/generate-panel";
import { AutoRefresh } from "@/components/command/auto-refresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Generate leads" };

export default async function GeneratePage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const last = await withTenantContext(tenantId, (tx) =>
    tx.generationBatch.findFirst({
      where: { tenantId, status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "desc" },
      select: { requestId: true },
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Generate leads</h1>
          <p className="text-sm text-muted-foreground">
            Find and research new prospects for your pipeline. You can watch progress here.
          </p>
        </div>
        <AutoRefresh intervalMs={5_000} />
      </div>
      <GeneratePanel lastRequestId={last?.requestId ?? null} />
    </div>
  );
}
