/**
 * GET  /api/acquisition/email/mode — current tenant email operating mode.
 * POST /api/acquisition/email/mode — record the client's email mode choice.
 *
 * Both modes feed the same campaign lifecycle. `waves_managed` is active
 * immediately (Waves-operated infrastructure). `client_managed` is recorded
 * as a preference with status `setup_pending` — delivery keeps running via
 * Waves-managed infrastructure until a client-managed connector is
 * provisioned (concierge setup). Never faked as connected.
 */

import { NextResponse } from "next/server";
import { requireControlAuth, auditControl } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import {
  emailModeLabel,
  isEmailMode,
  readEmailMode,
  withEmailMode,
  type EmailMode,
} from "@/lib/wavesco/mail-mode";

export const dynamic = "force-dynamic";

function modePayload(mode: EmailMode) {
  return {
    mode,
    label: emailModeLabel(mode),
    status: mode === "waves_managed" ? "active" : "setup_pending",
    description:
      mode === "waves_managed"
        ? "Waves manages the email infrastructure for your acquisition campaigns. Nothing for you to configure."
        : "We've recorded that you want your own mailbox used. A Waves specialist will connect it with you — until then your campaigns keep sending through Waves-managed email.",
  };
}

export async function GET() {
  try {
    const { tenantId } = await requireControlAuth();
    const mode = await withTenantContext(tenantId, async (tx: any) => {
      const profile = await tx.acquisitionProfile.findFirst({
        where: { tenantId },
        select: { integrations: true },
      });
      return readEmailMode(profile?.integrations);
    });
    return NextResponse.json(modePayload(mode));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "UNAUTHORIZED" || msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { tenantId, userId } = await requireControlAuth();
    const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
    if (!isEmailMode(body?.mode)) {
      return NextResponse.json(
        { error: "validation", errors: ["mode must be waves_managed or client_managed"] },
        { status: 400 },
      );
    }
    const mode = body.mode as EmailMode;

    const saved = await withTenantContext(tenantId, async (tx: any) => {
      const existing = await tx.acquisitionProfile.findFirst({
        where: { tenantId },
        select: { id: true, integrations: true },
      });
      if (!existing) return null;

      const before = { ...existing };
      const updated = await tx.acquisitionProfile.update({
        where: { id: existing.id },
        data: {
          integrations: withEmailMode(existing.integrations, mode),
          version: { increment: 1 },
        },
        select: { id: true, integrations: true },
      });
      await auditControl({
        tenantId,
        userId,
        action: "email_mode.update",
        model: "AcquisitionProfile",
        recordId: existing.id,
        before,
        after: updated,
      });
      return updated;
    });

    if (!saved) {
      return NextResponse.json(
        {
          error: "no_profile",
          detail:
            "Complete onboarding first — your email preference is saved with your company profile.",
        },
        { status: 409 },
      );
    }

    console.log(
      JSON.stringify({ event: "email_mode.update", tenantId, mode }),
    );
    return NextResponse.json({ ...modePayload(mode), saved: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "UNAUTHORIZED" || msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}
