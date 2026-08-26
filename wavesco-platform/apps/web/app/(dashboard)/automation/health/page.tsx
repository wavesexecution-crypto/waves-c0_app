import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { requireInternalAccess } from "@/lib/tenant";
import { computeIntegrationStatuses } from "@/lib/wavesco/integrations";
import { StatusPill } from "@/components/command/primitives";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Health" };

export default async function AutomationHealthPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);
  requireInternalAccess(session);
  const systems = await computeIntegrationStatuses(tenantId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
        <p className="text-sm text-muted-foreground">
          Every integration probed live on each request. States are never cached as &quot;connected&quot;
          without evidence.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {systems.map((s) => (
          <div key={s.key} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{s.label}</p>
              <StatusPill state={s.state} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{s.detail}</p>
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              Checked {formatIST(s.lastCheckedAt)}
              {s.lastOkAt && s.state !== "connected" ? ` · last OK ${formatIST(s.lastOkAt)}` : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
