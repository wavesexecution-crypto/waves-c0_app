import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { GeneratePanel } from "@/components/acquisition/generate-panel";
import { AutoRefresh } from "@/components/command/auto-refresh";

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Pipeline</p>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Lead Engine</h1>
          <p className="mt-1 font-sans text-[13px] leading-5 text-muted-foreground">
            Trigger the real pipeline. Progress is tracked from the engine&apos;s own process and logs.
          </p>
        </div>
        <AutoRefresh intervalMs={5_000} />
      </div>
      <GeneratePanel lastRequestId={last?.requestId ?? null} />
    </div>
  );
}
