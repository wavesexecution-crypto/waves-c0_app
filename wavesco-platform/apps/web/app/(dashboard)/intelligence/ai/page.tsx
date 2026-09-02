import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { AiPanel } from "@/components/intelligence/ai-panel";
import { WaveAiBeam, WaveAiHeaderBeam } from "@/components/intelligence/wave-ai-beam";
import { BorderBeam } from "@/components/ui/border-beam";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Waves AI" };

export default async function AiPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const cfg = await withTenantContext(tenantId, async (tx) => {
    const row = await tx.clientAiConfig.findUnique({
      where: { tenantId },
      select: { aiEnabled: true },
    });
    return { aiEnabled: row?.aiEnabled ?? false };
  });

  return (
    <div className="space-y-6">
      <WaveAiHeaderBeam>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          Waves AI
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-mono text-primary">Nemotron 3 Super</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          On-demand analysis grounded in your workspace data. The console never auto-sends your data — you choose
          exactly what goes into each prompt.
        </p>
      </WaveAiHeaderBeam>

      {!cfg.aiEnabled ? (
        <BorderBeam size="md" colorVariant="colorful">
          <div className="rounded-xl border border-dashed p-6 text-sm bg-card">
            <p className="font-medium">Waves AI is unavailable for your plan</p>
            <p className="mt-1 text-muted-foreground">Reach out to WavesCo to add the AI capability to your workspace.</p>
            <p className="mt-2 text-xs text-muted-foreground">Everything else in your workspace continues to work normally.</p>
          </div>
        </BorderBeam>
      ) : (
        <>
          <WaveAiBeam />
          <AiPanel />
        </>
      )}
    </div>
  );
}
