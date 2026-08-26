import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { GeneratePanel } from "@/components/acquisition/generate-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lead Engine" };

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lead Engine</h1>
        <p className="text-sm text-muted-foreground">
          Trigger the real pipeline. Progress is tracked from the engine&apos;s own process and logs.
        </p>
      </div>
      <GeneratePanel lastRequestId={last?.requestId ?? null} />
    </div>
  );
}
