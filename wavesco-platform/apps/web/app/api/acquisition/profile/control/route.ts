import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth, auditControl } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { readinessCheck, nextStatusForAction } from "@/lib/wavesco/acquisition-profile";

export const dynamic = "force-dynamic";

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const digest = (e as any)?.digest as string | undefined;
  return msg === "UNAUTHORIZED" || msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT") || !!(digest && digest.includes("NEXT_REDIRECT"));
}

// POST { action: "activate" | "pause" | "resume" | "suspend" | "draft" }
export async function POST(req: Request) {
  try {
    const { tenantId, userId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const body = await req.json().catch(() => ({}));
    const action = (body as any)?.action as string;

    if (!["activate", "pause", "resume", "suspend", "draft"].includes(action)) {
      return NextResponse.json({ error: "invalid action", allowed: ["activate", "pause", "resume", "suspend"] }, { status: 400 });
    }

    const result = await withTenantContext(tenantId, async (tx: any) => {
      const profile = await (tx as any).acquisitionProfile.findFirst({ where: { tenantId } });
      if (!profile) {
        return { error: "not_found", status: 404 as const };
      }
      const readiness = readinessCheck(profile);

      let nextStatus: string | null = null;
      let error: string | undefined;

      if (action === "draft") {
        // force to DRAFT/INCOMPLETE based on readiness — admin reset
        nextStatus = readiness.ready ? "READY" : readiness.status;
      } else {
        const res = nextStatusForAction(profile.status, action as any, readiness);
        nextStatus = res.next;
        error = res.error;
      }

      if (!nextStatus) {
        return { error: error || "invalid transition", status: 400 as const, readiness, current: profile.status };
      }

      const before = { status: profile.status };
      const now = new Date();
      const data: Record<string, unknown> = { status: nextStatus, readiness: readiness as any, version: { increment: 1 } };
      if (nextStatus === "ACTIVE") data["activatedAt"] = now;
      if (nextStatus === "PAUSED") data["pausedAt"] = now;
      if (nextStatus === "SUSPENDED") data["suspendedAt"] = now;

      const updated = await (tx as any).acquisitionProfile.update({
        where: { id: profile.id },
        data,
      });

      await auditControl({
        tenantId,
        userId,
        action: `acquisition_profile.${action}`,
        model: "AcquisitionProfile",
        recordId: profile.id,
        before,
        after: { status: nextStatus },
        metadata: { readiness: readiness.missing.length ? { missing: readiness.missing } : undefined },
      });

      // Also log activity event for observability (best-effort)
      try {
        await (tx as any).activityEvent.create({
          data: {
            tenantId,
            type: `acquisition_profile.${action}`,
            title: `Acquisition profile ${action}d`,
            entityType: "AcquisitionProfile",
            entityId: profile.id,
            metadata: { from: before.status, to: nextStatus } as any,
            sourceKey: `acquisition_profile:${profile.id}`,
          },
        });
      } catch {}

      return { profile: updated, readiness, previousStatus: before.status, nextStatus };
    });

    if ((result as any).error) {
      const r: any = result;
      const status = r.status || 400;
      return NextResponse.json({ error: r.error, readiness: r.readiness, current: r.current }, { status });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
