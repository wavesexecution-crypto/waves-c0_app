"use client";

import { useActionState } from "react";
import { generateAiInsightAction, type InsightResult } from "@/lib/actions/intelligence";

const initial: InsightResult = { ok: false };

export function AiPanel() {
  const [state, formAction, pending] = useActionState(generateAiInsightAction, initial);

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-2 rounded-lg border bg-card p-4">
        <label className="text-xs text-muted-foreground">
          Ask anything about the company. Tick “include company data” to attach a real snapshot
          (lead corpus, campaigns, clients, system health) and optionally pull matching Obsidian
          notes by topic. You always see exactly what was sent.
          <textarea
            name="prompt"
            required
            minLength={10}
            maxLength={6000}
            rows={8}
            defaultValue={""}
            placeholder={`e.g.\nWhat should I fix first to make our first cold-email campaign viable?`}
            className="mt-1 w-full rounded-md border bg-transparent p-2 font-mono text-xs"
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="includeData" defaultChecked className="h-3.5 w-3.5" />
            Include company data
          </label>
          <label className="inline-flex items-center gap-2">
            Obsidian topic
            <input
              name="topic"
              placeholder="e.g. cold email SOP"
              className="w-48 rounded-md border bg-transparent px-2 py-1"
              maxLength={120}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Thinking…" : "Generate insight"}
        </button>
      </form>

      {state.error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-500">{state.error}</p>
      ) : null}
      {state.ok && state.text ? (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Response · Waves AI
          </p>
          <p className="whitespace-pre-line text-sm">{state.text}</p>
          {state.contextSent ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Context that was sent</summary>
              <pre className="mt-1 whitespace-pre-wrap font-mono">{state.contextSent}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
