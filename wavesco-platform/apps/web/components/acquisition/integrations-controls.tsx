"use client";

import { useState } from "react";

export function TestConnectionButton({ integrationKey, label }: { integrationKey: string; label: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ status: string; detail: string; latencyMs?: number; reason?: string; url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onTest() {
    const confirmMsg = `Test connection for ${label} (${integrationKey})?\n\nThis will make a server-side health probe (keys never leave server, URLs masked).`;
    if (typeof window !== "undefined" && !window.confirm(confirmMsg)) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/acquisition/integrations/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: integrationKey }),
      });
      const json = (await res.json().catch(() => ({} as Record<string, unknown>))) as {
        status?: string;
        detail?: string;
        reason?: string;
        latencyMs?: number;
        url?: string;
        error?: string;
        key?: string;
      };
      if (res.status === 401) throw new Error("unauthorized");
      // BLOCKED and error are reported as 200 with status field; treat as result
      if (json.status) {
        setResult({
          status: String(json.status),
          detail: String(json.detail ?? json.reason ?? ""),
          latencyMs: typeof json.latencyMs === "number" ? json.latencyMs : undefined,
          reason: json.reason ? String(json.reason) : undefined,
          url: json.url ? String(json.url) : undefined,
        });
        return;
      }
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `Failed ${res.status}`);
      setResult({ status: "ok", detail: "ok" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={onTest}
        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        {pending ? "Testing…" : "Test Connection"}
      </button>
      {result ? (
        <span
          className={`max-w-[220px] truncate text-[11px] ${
            result.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : result.status === "BLOCKED" ? "text-amber-600 dark:text-amber-400" : "text-red-500"
          }`}
          title={`${result.status}: ${result.detail} ${result.latencyMs != null ? `(${result.latencyMs}ms)` : ""} ${result.url ?? ""}`}
        >
          {result.status}: {result.detail.slice(0, 80)} {result.latencyMs != null ? `(${result.latencyMs}ms)` : ""}
        </span>
      ) : null}
      {error ? <span className="max-w-[220px] truncate text-[11px] text-red-500" title={error}>{error}</span> : null}
    </div>
  );
}
