import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { FlashProfile } from "@/components/acquisition/flash-profile";
import { ProfileLifecycleControls } from "@/components/acquisition/profile-controls";
import { readinessCheck, type AcquisitionProfileRecord } from "@/lib/wavesco/acquisition-profile";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STEP_GROUPS: { label: string; keys: string[]; optional?: boolean }[] = [
  { label: "Business", keys: ["companyName", "website", "industry", "whatWeSell"] },
  { label: "Objective", keys: ["acquisitionObjective", "primaryObjective"] },
  { label: "Ideal customer", keys: ["icp.targetCustomer", "icp.geography"] },
  { label: "Offer", keys: ["offer.productService"] },
  { label: "Brand", keys: [], optional: true },
  { label: "Infrastructure", keys: [], optional: true },
  { label: "Rules", keys: [], optional: true },
  { label: "Review & Activate", keys: [] },
];

export default async function AcquisitionProfilePage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  let profile: AcquisitionProfileRecord | null = null;
  try {
    profile = await withTenantContext(tenantId, async (tx) => {
      const p = await tx.acquisitionProfile.findFirst({ where: { tenantId } });
      return p;
    });
  } catch {
    profile = null;
  }

  const readiness = readinessCheck(profile);
  // Optional sections were counted as complete unconditionally, so a brand-new
  // profile advertised "3 of 8 sections complete" with green ticks on three
  // sections the user never touched. They are now shown as optional until
  // populated, and only required sections count toward progress.
  const requiredGroups = STEP_GROUPS.filter((g) => !(g.optional ?? false));
  const doneCount = requiredGroups.filter(
    (g) => g.keys.length > 0 && g.keys.every((k) => Boolean(readiness.snapshot[k])),
  ).length;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <div className="flex items-center justify-between">
          <Link href="/acquisition" className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground">
            ← Back to Acquisition OS
          </Link>
          <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">One Waves account · tenant-isolated</span>
        </div>

        <div className="mt-4 rounded-lg border border-border/80 bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Onboarding · {doneCount} of {requiredGroups.length - 1} required sections complete · Status{" "}
                {profile?.status ?? "DRAFT"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {STEP_GROUPS.map((g) => {
                  const filled = g.keys.length > 0 && g.keys.every((k) => Boolean(readiness.snapshot[k]));
                  const isReview = g.keys.length === 0 && !g.optional;
                  // Optional sections read "optional" until they have content;
                  // they never present as done work the client did not do.
                  const showDone = filled || (isReview && readiness.ready);
                  return (
                    <span
                      key={g.label}
                      title={
                        g.optional
                          ? filled
                            ? "Optional section filled in"
                            : "Optional — improves results, never blocks activation"
                          : isReview
                            ? "Activate when all required sections are done"
                            : undefined
                      }
                      className={`rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] ${
                        showDone
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : g.optional
                            ? "border-dashed border-border/80 text-muted-foreground/70"
                            : "border-border/80 text-muted-foreground"
                      }`}
                    >
                      {showDone ? "✓ " : ""}
                      {g.label}
                      {g.optional && !filled ? " (optional)" : ""}
                    </span>
                  );
                })}
              </div>
              {!readiness.ready && readiness.missing.length > 0 && (
                <p className="mt-2 font-sans text-xs text-muted-foreground">Still needed: {readiness.missing.join(" · ")}</p>
              )}
            </div>
            <ProfileLifecycleControls status={profile?.status ?? "DRAFT"} ready={readiness.ready} />
          </div>
        </div>
      </div>
      <FlashProfile initialProfile={profile} />
    </div>
  );
}
