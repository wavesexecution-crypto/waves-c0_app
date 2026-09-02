"use client";

import { useState } from "react";

export function DocumentsGenerateControl() {
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [tier, setTier] = useState("all");
  const [count, setCount] = useState(10);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const params: Record<string, unknown> = {};
      if (category.trim()) params.category = category.trim();
      if (city.trim()) params.city = city.trim();
      if (tier && tier !== "all") params.tier = tier;
      if (count) params.count = count;

      if (Object.keys(params).length === 0) {
        setResult({ ok: false, error: "Provide at least one param (category, city, tier, count)" });
        setPending(false);
        return;
      }

      const res = await fetch("/api/acquisition/documents/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, error: json.error ?? `Request failed (${res.status})` });
      } else {
        setResult({ ok: true, message: `Queued batch ${json.batchId ?? json.requestId} — ${json.status}` });
        // optional refresh
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setPending(false);
    }
  }

  async function handleQuickGenerate() {
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/acquisition/documents/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: { count: 10 } }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, error: json.error ?? `Request failed (${res.status})` });
      } else {
        setResult({ ok: true, message: `Queued batch ${json.batchId} — ${json.status}` });
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Generate Documents</h3>
          <p className="text-xs text-muted-foreground">Queue a new GenerationBatch — tenant-scoped, audit-logged. Produces PDF/XLSX via Lead Engine.</p>
        </div>
        <button
          type="button"
          onClick={handleQuickGenerate}
          disabled={pending}
          className="rounded-md border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Queuing…" : "Quick Generate (10)"}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="text-xs">
          <span className="text-muted-foreground">Category</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Salon, Clinic…"
            className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">City</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Pune, Mumbai…"
            className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="all">all</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Count</span>
          <input
            type="number"
            min={1}
            max={60}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
          />
        </label>
        <div className="sm:col-span-4 flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Queuing…" : "Generate"}
          </button>
          <span className="text-xs text-muted-foreground">Creates GenerationBatch queued → engine pipeline.</span>
        </div>
      </form>

      {result ? (
        <p className={`mt-3 text-xs ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
    </div>
  );
}
