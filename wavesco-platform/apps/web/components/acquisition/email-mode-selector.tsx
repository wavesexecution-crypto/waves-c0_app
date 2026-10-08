"use client";

/**
 * Email operating mode selector — the client-facing choice:
 *
 *   [ Use our email system ]  → client_managed: recorded as a preference with
 *     status `setup_pending` (a Waves specialist connects the client mailbox
 *     with the client — concierge setup). Never shown as active until real
 *     credentials exist.
 *   [ Have Waves handle it ]  → waves_managed: active immediately; Waves
 *     operates the outbound infrastructure.
 *
 * Both modes feed the SAME campaign lifecycle. The choice is persisted on the
 * tenant profile via POST /api/acquisition/email/mode (session-authenticated,
 * tenant-scoped, audit-logged). No internal infrastructure terms are shown.
 */

import { useState } from "react";
import { StatusPill } from "@/components/command/primitives";

type EmailMode = "waves_managed" | "client_managed";

interface ModeState {
  mode: EmailMode;
  label: string;
  status: string;
  description: string;
}

function modeState(mode: EmailMode): ModeState {
  return mode === "waves_managed"
    ? {
        mode,
        label: "WAVES handles it",
        status: "active",
        description:
          "WAVES sends your outreach for you. Nothing for you to configure.",
      }
    : {
        mode,
        label: "Connect my email",
        status: "setup_pending",
        description:
          "We've recorded that you want your own mailbox used. A Waves specialist will connect it with you — until then your campaigns keep sending through WAVES-managed email.",
      };
}

const CARDS: { mode: EmailMode; title: string; subtitle: string; cta: string }[] = [
  {
    mode: "client_managed",
    title: "Connect my email",
    subtitle: "Send outreach from your existing business email.",
    cta: "Connect email →",
  },
  {
    mode: "waves_managed",
    title: "Have WAVES handle it",
    subtitle: "WAVES sends your outreach for you. Nothing for you to configure.",
    cta: "Set up WAVES →",
  },
];

export function EmailModeSelector({ initialMode }: { initialMode: EmailMode }) {
  const [current, setCurrent] = useState<ModeState>(() => modeState(initialMode));
  const [saving, setSaving] = useState<EmailMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(mode: EmailMode) {
    if (mode === current.mode || saving) return;
    setSaving(mode);
    setError(null);
    try {
      const res = await fetch("/api/acquisition/email/mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          data?.detail ??
            data?.error ??
            "Could not save your preference. Please try again.",
        );
        return;
      }
      setCurrent({
        mode: data.mode,
        label: data.label,
        status: data.status,
        description: data.description,
      });
    } catch {
      setError("Could not save your preference. Check your connection and try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-lg border border-border/80 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-[13px] font-semibold">Your choice</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick one. Either way, sending only happens after you approve a campaign.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill
            state={current.status === "active" ? "connected" : "pending"}
          />
          <span className="font-sans text-[13px] font-medium tracking-[-0.01em]">{current.label}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => {
          const selected = c.mode === current.mode;
          return (
            <button
              key={c.mode}
              type="button"
              onClick={() => void choose(c.mode)}
              disabled={saving !== null}
              aria-pressed={selected}
              className={`rounded-lg border border-border/80 p-3 text-left transition-colors disabled:opacity-60 ${
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-sans text-[13px] font-medium">{c.title}</span>
                {selected ? (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    Selected
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.subtitle}</p>
              <p className="mt-2 text-xs font-medium text-foreground">{c.cta}</p>
              {saving === c.mode ? (
                <p className="mt-2 text-[11px] text-muted-foreground">Saving…</p>
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{current.description}</p>

      {error ? (
        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          <button
            type="button"
            className="mt-1 text-[11px] underline underline-offset-2"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </section>
  );
}
