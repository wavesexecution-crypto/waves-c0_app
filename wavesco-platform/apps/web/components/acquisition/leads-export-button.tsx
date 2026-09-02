"use client";

import { useState } from "react";

export function LeadsExportButton({
  filters,
}: {
  filters: Record<string, string | undefined>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setPending(true);
    setError(null);
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
        throw new Error((j as { error?: string }).error ?? `Export failed ${res.status}`);
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
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleExport}
        disabled={pending}
        className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        title="Export current filtered leads as CSV (max 1000, tenant-scoped)"
      >
        {pending ? "Exporting…" : "Export CSV"}
      </button>
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
    </span>
  );
}
