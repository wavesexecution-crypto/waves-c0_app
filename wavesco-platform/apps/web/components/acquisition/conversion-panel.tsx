"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type State = "MEETING" | "WON" | "LOST";

const COPY: Record<State, string> = {
  MEETING: "Meeting booked & confirmed",
  WON: "Won — paying customer",
  LOST: "Lost / disqualified",
};

/** Verified outcomes only. Recording MEETING/WON/LOST cancels pending
 *  automated follow-ups for this lead — the human relationship takes over.
 *  CTA clicks and sent counts are deliberately NOT here. */
export function ConversionPanel({
  leadKey,
  businessName,
  initial,
}: {
  leadKey: string;
  businessName: string | null;
  initial: { state: string; note: string | null; updatedAt: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<State | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [current, setCurrent] = useState(initial);

  async function record(state: State) {
    if (!window.confirm(`Mark "${businessName ?? leadKey}" as ${COPY[state]}? Pending automated follow-ups for this lead will stop.`)) return;
    setBusy(state);
    setMsg(null);
    try {
      const res = await fetch("/api/acquisition/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadKey, state, businessName }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.reason || j.error || `Failed (${res.status})`);
      setCurrent({ state, note: null, updatedAt: new Date().toISOString() });
      setMsg(`Recorded ${COPY[state]} — ${j.followUpsCancelled ?? 0} pending follow-up(s) stopped.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-border/80 bg-card p-4">
      <h2 className="mb-1 font-sans text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">Outcome</h2>
      <p className="font-sans text-[13px] leading-5 text-muted-foreground">
        {current
          ? <>Verified outcome: <span className="font-medium text-foreground">{COPY[current.state as State] ?? current.state}</span> · recorded {new Date(current.updatedAt).toLocaleDateString()}</>
          : "No verified outcome yet. Only meetings, wins and losses count — never clicks or sends."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(COPY) as State[]).map((s) => (
          <button
            key={s}
            onClick={() => record(s)}
            disabled={busy !== null || current?.state === s}
            className="rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {busy === s ? "Recording…" : `Mark ${COPY[s]}`}
          </button>
        ))}
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
