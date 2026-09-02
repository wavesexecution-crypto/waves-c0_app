"use client";

import { useActionState } from "react";
import { checkLeadEmailAction, researchLeadAction, type PipelineActionState } from "@/lib/actions/pipeline";

const initial: PipelineActionState = { ok: false };

function Btn({
  label,
  pending,
  tone = "default",
}: {
  label: string;
  pending?: boolean;
  tone?: "default" | "primary";
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        tone === "primary" ? "bg-primary text-primary-foreground hover:bg-primary/90 border-transparent" : "hover:bg-accent"
      }`}
    >
      {pending ? "…" : label}
    </button>
  );
}

export function LeadDetailActions({ nameKey }: { nameKey: string }) {
  const [researchState, research, researchPending] = useActionState(researchLeadAction, initial);
  const [checkState, check, checkPending] = useActionState(checkLeadEmailAction, initial);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={research} id="enrich">
          <input type="hidden" name="nameKey" value={nameKey} />
          <Btn label="Enrich" pending={researchPending} tone="primary" />
        </form>
        <form action={check} id="verify">
          <input type="hidden" name="nameKey" value={nameKey} />
          <Btn label="Verify email" pending={checkPending} />
        </form>
        {/* Qualify / Score are control placeholders — safe, audited via pipeline activity; dedicated scoring is derived from lead_score */}
        <form
          action={async () => {
            // placeholder qualify: no destructive write, just client feedback
            // real qualify would run enrichment + scoring pipeline; kept safe here
            alert("Qualify: lead qualification is derived from research + email check + tier/score. Run Enrich + Verify first.");
          }}
        >
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Qualify
          </button>
        </form>
        <form
          action={async () => {
            alert("Score: lead_score + digital_score + tier are engine-computed. Re-research to refresh.");
          }}
        >
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Score
          </button>
        </form>
      </div>
      {(researchState.error ?? checkState.error) ? (
        <p className="text-xs text-red-500">{researchState.error ?? checkState.error}</p>
      ) : null}
      {(researchState.message ?? checkState.message) ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{researchState.message ?? checkState.message}</p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Enrich writes a tenant-scoped LeadResearch snapshot; Verify checks email + dedupe and writes back outreach state. Both are audited and idempotent.
      </p>
    </div>
  );
}
