"use client";

import { useState } from "react";

export function LeadsExportButton({
  filters,
}: {
  filters: Record<string, string | undefined>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handleExport() {
    setPending(true);
    setError(null);
    setNote(null);
    try {
      // sanitize filters: drop empty
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== "") body[k] = v;
      }
      // cap limit client-side as well
      body.limit = 1000;
      const res = await fetch("/api/acquisition/leads/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const rec = j as { error?: string; reason?: string; whatNext?: string };
        throw new Error(rec.whatNext ?? rec.reason ?? rec.error ?? `Export failed (${res.status})`);
      }
      // Say so when the cap truncated the result — a client must not read a
      // partial file as the complete filtered set.
      const truncated = res.headers.get("x-truncated") === "true";
      const exported = res.headers.get("x-exported-rows");
      const total = res.headers.get("x-total-rows");
      if (truncated) {
        setNote(`Exported the top ${exported ?? "?"} of ${total ?? "?"} matching leads — narrow the filters for the rest.`);
      } else if (exported) {
        setNote(`Exported ${exported} lead${exported === "1" ? "" : "s"}.`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disp = res.headers.get("content-disposition") ?? "";
      const m = /filename="?([^";]+)"?/.exec(disp);
      a.href = url;
      a.download = m?.[1] ?? `leads-export-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleExport}
        disabled={pending}
        className="rounded-lg border border-border/80 px-3 py-1.5 font-sans text-[13px] font-medium hover:bg-accent disabled:opacity-50"
        title="Export the leads currently shown, as CSV (up to 1000 rows)"
      >
        {pending ? "Exporting…" : "Export CSV"}
      </button>
      {error ? (
        <span className="max-w-[220px] truncate text-xs text-red-500" title={error}>
          {error}
        </span>
      ) : null}
      {note && !error ? <span className="max-w-[260px] text-xs text-muted-foreground">{note}</span> : null}
    </span>
  );
}