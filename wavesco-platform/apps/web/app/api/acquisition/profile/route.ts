import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth, auditControl } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import {
  validateProfileInput,
  readinessCheck,
  type AcquisitionProfileRecord,
} from "@/lib/wavesco/acquisition-profile";

export const dynamic = "force-dynamic";

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const digest = (e as any)?.digest as string | undefined;
  return (
    msg === "UNAUTHORIZED" ||
    msg.includes("UNAUTHORIZED") ||
    msg.includes("NEXT_REDIRECT") ||
    (digest ? digest.includes("NEXT_REDIRECT") : false)
  );
}

/**
 * Strip server-side secrets before any profile leaves the server.
 * Never expose the encrypted storage credential blob to the browser.
 */
function sanitizeProfileForClient(
  profile: AcquisitionProfileRecord | null,
): AcquisitionProfileRecord | null {
  if (!profile) return profile;
  const clone = { ...profile } as Record<string, unknown>;
  const integrations = clone.integrations as Record<string, unknown> | null | undefined;
  if (integrations && typeof integrations === "object") {
    const safeIntegrations = JSON.parse(JSON.stringify(integrations)) as Record<string, unknown>;
    const storage = safeIntegrations.storage as Record<string, unknown> | null | undefined;
    if (storage && typeof storage === "object") {
      delete storage.cred; // encrypted credential blob — server-side only
    }
    clone.integrations = safeIntegrations;
  }
  return clone as AcquisitionProfileRecord;
}

// GET — tenant-isolated profile + readiness
export async function GET() {
  try {
    const { tenantId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const result = await withTenantContext(tenantId, async (tx: any) => {
      const profile = await (tx as any).acquisitionProfile.findFirst({
        where: { tenantId },
        include: { dataImports: { orderBy: { createdAt: "desc" }, take: 5 } },
      });
      return profile as AcquisitionProfileRecord | null;
    });

    if (!result) {
      const readiness = readinessCheck(null);
      return NextResponse.json({ profile: null, readiness, exists: false });
    }

    const readiness = readinessCheck(result as AcquisitionProfileRecord);
    const profile = sanitizeProfileForClient(result as AcquisitionProfileRecord);
    return NextResponse.json({ profile, readiness, exists: true });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Never ship the driver message: it carries SQL/RLS text the client cannot
    // act on. Full detail goes to the server log.
    console.error("[api:acquisition/profile] request failed", e);
    return NextResponse.json(
      { error: "We could not load your profile just now. Please try again." },
      { status: 500 }
    );
  }
}

// POST — create or upsert (idempotent per tenant)
export async function POST(req: Request) {
  try {
    const { tenantId, userId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const body = await req.json().catch(() => ({}));
    const input = (body ?? {}) as Record<string, unknown>;

    const { valid, errors, sanitized } = validateProfileInput(input);
    if (!valid) {
      return NextResponse.json({ error: "validation", errors }, { status: 400 });
    }

    const result = await withTenantContext(tenantId, async (tx: any) => {
      const existing = await (tx as any).acquisitionProfile.findFirst({ where: { tenantId } });

      // Build data to upsert — only allowlisted keys
      const data: Record<string, unknown> = { ...sanitized };

      // If existing, compute before for audit
      const before = existing ? { ...existing } : null;

      let profile: any;
      if (!existing) {
        // Check readiness with prospective data merged
        const prospective = { ...data, tenantId, status: "DRAFT" } as AcquisitionProfileRecord;
        const readiness = readinessCheck(prospective);
        const status = readiness.ready ? "READY" : readiness.status; // DRAFT or INCOMPLETE
        profile = await (tx as any).acquisitionProfile.create({
          data: {
            tenantId,
            status,
            readiness: readiness as any,
            ...data,
          },
        });
        await auditControl({
          tenantId,
          userId,
          action: "acquisition_profile.create",
          model: "AcquisitionProfile",
          recordId: profile.id,
          before: null,
          after: profile,
        });
      } else {
        const prospective = { ...existing, ...data } as AcquisitionProfileRecord;
        const readiness = readinessCheck(prospective);
        // Auto-transition DRAFT/INCOMPLETE ↔ READY based on readiness; keep ACTIVE/PAUSED/SUSPENDED
        let nextStatus = existing.status;
        if (["DRAFT", "INCOMPLETE", "READY"].includes(existing.status)) {
          nextStatus = readiness.ready ? "READY" : readiness.status;
        }
        // If was ACTIVE etc, keep but update readiness snapshot
        profile = await (tx as any).acquisitionProfile.update({
          where: { id: existing.id },
          data: {
            ...data,
            status: nextStatus,
            readiness: readiness as any,
            version: { increment: 1 },
          },
        });
        await auditControl({
          tenantId,
          userId,
          action: "acquisition_profile.update",
          model: "AcquisitionProfile",
          recordId: profile.id,
          before,
          after: profile,
        });
      }
      const readiness = readinessCheck(profile as AcquisitionProfileRecord);
      return { profile: sanitizeProfileForClient(profile as AcquisitionProfileRecord), readiness };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Never ship the driver message: it carries SQL/RLS text the client cannot
    // act on. Full detail goes to the server log.
    console.error("[api:acquisition/profile] save failed", e);
    return NextResponse.json(
      { error: "We could not save your profile. Nothing was changed — please try again." },
      { status: 500 }
    );
  }
}

// PATCH — alias to POST for partial updates
export async function PATCH(req: Request) {
  return POST(req);
}
