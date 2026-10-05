"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AgentToggle({ aiEnabled, hasConfig }: { aiEnabled: boolean; hasConfig: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function doAction(action: "enable" | "disable") {
    const confirmMsg =
      action === "enable"
        ? "Enable AI Gateway for this tenant?\n\nThis will set ClientAiConfig.aiEnabled=true (audited)."
        : "Disable AI Gateway?\n\nThis will set aiEnabled=false and block all gateway calls (audited).";
    if (typeof window !== "undefined" && !window.confirm(confirmMsg)) return;
    setPending(action);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/acquisition/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.reason ?? json.error ?? `Failed ${res.status}`);
      if (json.status === "error") throw new Error(json.reason ?? "agent error");
      setSuccess(`${action} → ok`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Control</span>
      {aiEnabled ? (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => doAction("disable")}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
        >
          {pending === "disable" ? "Disabling…" : "Disable gateway"}
        </button>
      ) : (
        <button
          type="button"
          disabled={!!pending}
          onClick={() => doAction("enable")}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending === "enable" ? "Enabling…" : hasConfig ? "Enable gateway" : "Enable (create config)"}
        </button>
      )}
      {error ? <span className="max-w-[260px] truncate text-[11px] text-red-500" title={error}>{error}</span> : null}
      {success ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{success}</span> : null}
    </div>
  );
}

export function AgentConfigureForm({
  initial,
}: {
  initial: { provider: string | null; model: string | null; baseUrl: string | null };
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(initial.provider ?? "ollama_cloud");
  const [model, setModel] = useState(initial.model ?? "gemma3:27b");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      // baseUrl is displayed masked (***); if user leaves *** we don't send update for baseUrl? But masked is protocol//***, not real.
      // If masked, we should treat as no change unless user typed a new URL.
      // Heuristic: if baseUrl contains "***", don't send baseUrl unless it looks like a real URL.
      let payloadBaseUrl: string | undefined = baseUrl.trim();
      if (payloadBaseUrl.includes("***")) payloadBaseUrl = undefined;
      if (payloadBaseUrl === "") payloadBaseUrl = "";
      const body: Record<string, unknown> = { action: "configure", config: {} as Record<string, unknown> };
      (body.config as Record<string, unknown>).provider = provider.trim();
      (body.config as Record<string, unknown>).model = model.trim();
      if (payloadBaseUrl !== undefined) (body.config as Record<string, unknown>).baseUrl = payloadBaseUrl;
      const res = await fetch("/api/acquisition/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.reason ?? json.error ?? `Failed ${res.status}`);
      if (json.status === "error") throw new Error(json.reason ?? "configure error");
      setSuccess("configure → ok");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border/80 bg-card p-4">
      <h3 className="font-sans text-[13px] font-semibold">Configure gateway</h3>
      <p className="font-sans text-[13px] leading-5 text-muted-foreground">Provider / model / baseUrl are server-side only. Credential is stored as credentialRef (env:VAR) and never shown.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="font-sans text-[13px] font-medium tracking-[-0.01em]">Provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full rounded-lg border border-border/80 bg-background px-2 py-1.5 font-sans text-[13px]">
            <option value="ollama_cloud">ollama_cloud</option>
            <option value="openai">openai</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-sans text-[13px] font-medium tracking-[-0.01em]">Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gemma3:27b" className="w-full rounded-lg border border-border/80 bg-background px-2 py-1.5 font-sans text-[13px]" />
        </label>
        <label className="space-y-1">
          <span className="font-sans text-[13px] font-medium tracking-[-0.01em]">Base URL (masked in display)</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://ollama.com/v1"
            className="w-full rounded-lg border border-border/80 bg-background px-2 py-1.5 font-mono font-sans text-[13px]"
          />
          <span className="text-[11px] text-muted-foreground">Leave masked value unchanged to keep existing, or enter a new URL.</span>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {pending ? "Saving…" : "Save configure"}
        </button>
        {error ? <span className="text-xs text-red-500">{error}</span> : null}
        {success ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{success}</span> : null}
      </div>
    </form>
  );
}

export function AgentControlViaAlt({ action }: { action: string }) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  async function run() {
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch("/api/acquisition/agents/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.reason ?? json.error ?? `Failed ${res.status}`);
      setMsg(`${action} via control → ok`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <button type="button" disabled={pending} onClick={run} className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
      {pending ? "…" : action}
      {msg ? <span className="ml-2 text-[11px] text-muted-foreground">{msg}</span> : null}
    </button>
  );
}
