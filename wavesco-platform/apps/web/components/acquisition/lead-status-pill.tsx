import { outreachLabel, researchLabel, type LeadLike } from "@/lib/wavesco/lead-labels";

function pillClass(label: string): string {
  switch (label) {
    case "Replied":
    case "Researched":
    case "Ready to contact":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "Contacted":
      return "border-primary/30 bg-primary/5 text-foreground";
    case "Bounced":
    case "Opted out":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
}

/** Human-readable lead status pill. Never renders raw status codes. */
export function LeadStatusPill({ lead }: { lead: LeadLike }) {
  const research = researchLabel(lead);
  const outreach = outreachLabel(lead);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${pillClass(outreach)}`}
      >
        {outreach}
      </span>
      {research === "Research pending" ? (
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${pillClass(research)}`}
        >
          {research}
        </span>
      ) : null}
    </span>
  );
}
