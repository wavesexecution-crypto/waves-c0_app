import { NextResponse } from "next/server";
import { acquisitionDenied, auditControl, requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { onCampaignResultsFinalized } from "@/lib/wavesco/notify";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = ["launch", "pause", "resume", "stop"] as const;
type Action = (typeof VALID_ACTIONS)[number];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, userId, session } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    // Launching and stopping a campaign sends real email. The equivalent server
    // action already refuses non-admins; this route must not be the bypass.
    // The role comes from the session requireControlAuth already resolved.
    if (!can({ role: sessionRole(session) }, "admin", "acquisition")) {
      return NextResponse.json(
        { error: "Your role cannot change campaign status. Ask a workspace owner or admin." },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;

    let body: Record<string, unknown> = {};
    try {
      const raw = await req.text();
      if (raw) body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // invalid JSON -> will be caught as invalid action
    }

    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (!VALID_ACTIONS.includes(action as Action)) {
      return NextResponse.json(
        { error: "invalid action", valid: VALID_ACTIONS, received: action || null },
        { status: 400 }
      );
    }

    const result: any = await withTenantContext(tenantId, async (tx: any) => {
      const campaign = await tx.campaign.findFirst({ where: { id, tenantId } });
      if (!campaign) return { notFound: true };

      const before = { status: campaign.status };
      let nextStatus: string | null = null;
      let invalidReason: string | null = null;

      if (action === "launch" && campaign.status === "draft") nextStatus = "scheduled";
      else if (action === "pause" && campaign.status === "running") nextStatus = "paused";
      else if (action === "resume" && campaign.status === "paused") nextStatus = "running";
      else if (action === "stop" && ["running", "paused", "scheduled"].includes(campaign.status))
        nextStatus = "stopped";
      else {
        invalidReason = `cannot ${action} from ${campaign.status}`;
      }

      if (!nextStatus) {
        return { invalid: true, reason: invalidReason ?? `cannot ${action} from ${campaign.status}`, currentStatus: campaign.status, before };
      }

      await tx.campaign.update({ where: { id: campaign.id }, data: { status: nextStatus } });
      await auditControl({
        tenantId,
        userId,
        action: `campaign.${action}`,
        model: "Campaign",
        recordId: campaign.id,
        before,
        after: { status: nextStatus },
      });

      // Real transition: a campaign concluded (running/paused/scheduled -> stopped)
      // means its results are now final.
      if (nextStatus === "stopped") {
        onCampaignResultsFinalized(
          tenantId,
          campaign.id,
          undefined,
          {},
          userId ?? undefined,
          `campaign-stop-${campaign.id}`,
        );
      }

      return { ok: true, status: nextStatus, campaignId: campaign.id, before };
    });

    if (result.notFound) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }
    if (result.invalid) {
      return NextResponse.json({ error: result.reason, currentStatus: result.currentStatus }, { status: 400 });
    }
    return NextResponse.json({ status: result.status, id: result.campaignId }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as { digest?: string })?.digest as string | undefined;
    const isUnauthorized =
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT") ||
      (digest !== undefined && digest.includes("NEXT_REDIRECT"));
    if (isUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // Never ship the raw driver message to the browser; log it server-side.
    console.error("[campaigns:control] unhandled error", e);
    return NextResponse.json(
      { error: "We could not change the campaign status. Try again in a moment." },
      { status: 500 }
    );
  }
}
