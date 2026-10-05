"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { answersToPayload, payloadToAnswers, type Answers } from "@/lib/wavesco/flash-profile-map";

// --- Steps: 15 friendly questions -> internal AcquisitionProfile fields
type FlashField = {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "number";
  required?: boolean;
};

type FlashStep = {
  id: string;
  question: string;
  subtitle: string;
  fields: FlashField[];
};

const STEPS: FlashStep[] = [
  {
    id: "companyName",
    question: "What is your company name?",
    subtitle: "This is how your business will be introduced.",
    fields: [{ key: "companyName", label: "Company name", placeholder: "WavesCo Pvt Ltd", type: "text", required: true }],
  },
  {
    id: "website",
    question: "What is your website?",
    subtitle: "We use this to understand your brand and offering.",
    fields: [{ key: "website", label: "Website", placeholder: "https://wavesco.in", type: "text", required: true }],
  },
  {
    id: "industry",
    question: "What industry are you in?",
    subtitle: "Helps us speak your customers language.",
    fields: [{ key: "industry", label: "Industry", placeholder: "B2B services, hospitality, healthcare...", type: "text", required: true }],
  },
  {
    id: "whatWeSell",
    question: "What does your company sell?",
    subtitle: "Tell us in plain language what you do for customers.",
    fields: [{ key: "whatWeSell", label: "What you sell", placeholder: "We build the operating system that lets founder-led teams run without constant founder involvement...", type: "textarea", required: true }],
  },
  {
    id: "priorityOffer",
    question: "Which product or service should we focus on first?",
    subtitle: "Pick the offer you most want new customers for.",
    fields: [{ key: "priorityProductService", label: "Priority offer", placeholder: "Acquisition OS rental, audit, implementation...", type: "text" }],
  },
  {
    id: "idealCustomer",
    question: "Who is your ideal customer?",
    subtitle: "Describe the type of customer you do your best work with.",
    fields: [{ key: "icp_targetCustomer", label: "Ideal customer", placeholder: "Founder-led companies with 5 to 50 employees in services...", type: "textarea", required: true }],
  },
  {
    id: "targetIndustries",
    question: "Which industries do you want to reach?",
    subtitle: "The categories where your ideal customers operate.",
    fields: [{ key: "icp_industry", label: "Target industries", placeholder: "Professional services, F&B, retail, clinics...", type: "text" }],
  },
  {
    id: "geography",
    question: "Where are your ideal customers located?",
    subtitle: "City, region, or areas you want to focus on.",
    fields: [{ key: "icp_geography", label: "Geography", placeholder: "Navi Mumbai — Vashi, Nerul, Panvel...", type: "text", required: true }],
  },
  {
    id: "companyType",
    question: "What kind of companies are they?",
    subtitle: "Size, stage, and who makes decisions.",
    fields: [
      { key: "icp_companySize", label: "Company size", placeholder: "5 to 50 employees, single owner, early growth...", type: "text" },
      { key: "icp_decisionMakerTitles", label: "Decision makers", placeholder: "Founder, Owner, Director, Partner...", type: "text" },
      { key: "icp_characteristics", label: "Other characteristics", placeholder: "Uses WhatsApp for ops, has a website, team of 5-15...", type: "text" },
    ],
  },
  {
    id: "problem",
    question: "What main problem do you solve for them?",
    subtitle: "The outcome customers hire you to deliver.",
    fields: [{ key: "offer_valueProp", label: "Main problem you solve", placeholder: "Founders spend nights fixing operations instead of leading the company...", type: "textarea" }],
  },
  {
    id: "differentiator",
    question: "What makes you different?",
    subtitle: "Why customers choose you over alternatives.",
    fields: [{ key: "offer_differentiators", label: "Differentiator", placeholder: "Boring is a feature — reliable OS, no theatrics, installs in 30 days...", type: "textarea" }],
  },
  {
    id: "offer",
    question: "What are you offering right now?",
    subtitle: "Your current offer, pricing, and next step for a new customer.",
    fields: [
      { key: "offer_productService", label: "Product / service", placeholder: "Acquisition OS — monthly rental, includes ops install", type: "text", required: true },
      { key: "offer_pricing", label: "Pricing / typical deal size", placeholder: "₹25,000 per month, no tiers...", type: "text" },
      { key: "offer_cta", label: "What should a new lead do next?", placeholder: "Book an Architecture Review at cal.com/...", type: "text" },
    ],
  },
  {
    id: "proof",
    question: "Why do customers actually say they chose you?",
    subtitle: "Proof, results, or reasons in their own words.",
    fields: [{ key: "offer_proof", label: "Why they choose you", placeholder: "We helped a 4-outlet cafe stop stockouts and save 12 hours a week...", type: "textarea" }],
  },
  {
    id: "outcome",
    question: "What should Acquisition OS achieve for you?",
    subtitle: "The outcome you are renting the OS to deliver.",
    fields: [
      { key: "acquisitionObjective", label: "What to acquire", placeholder: "Qualified leads, meetings, customers...", type: "text", required: true },
      { key: "primaryObjective", label: "Primary objective in one sentence", placeholder: "30 qualified leads in 30 days", type: "text", required: true },
      { key: "targetQuantity", label: "How many?", placeholder: "30", type: "number" },
      { key: "targetTimeframe", label: "In what time frame?", placeholder: "30 days", type: "text" },
    ],
  },
  {
    id: "exclusions",
    question: "Who should we avoid and how should we reach out?",
    subtitle: "Exclusions and preferences so outreach stays respectful and precise.",
    fields: [
      { key: "icp_disqualifiers", label: "Companies you do NOT want", placeholder: "Government, >500 employees, outside Navi Mumbai...", type: "text" },
      { key: "rules_industriesExclude", label: "Industries to exclude", placeholder: "Gambling, adult, regulated...", type: "text" },
      { key: "rules_outreachRestrictions", label: "Outreach preferences", placeholder: "No calls after 8pm, max two follow-ups, approve every email...", type: "textarea" },
      { key: "brand_toneOfVoice", label: "How should we sound on your behalf?", placeholder: "Direct, plain English, confident but not glossy...", type: "text" },
    ],
  },
];

const LS_ANSWERS = "wavesco:flash-answers";
const LS_STEP = "wavesco:flash-step";

export function FlashProfile({ initialProfile }: { initialProfile: any | null }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(() => payloadToAnswers(initialProfile));
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"form" | "review" | "done">("form");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateMsg, setActivateMsg] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReview = mode === "review";
  const isDone = mode === "done";
  const total = STEPS.length;

  const current = STEPS[step];

  // Hydrate from localStorage + fetch latest profile
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // localStorage draft first
      try {
        const raw = localStorage.getItem(LS_ANSWERS);
        const rawStep = localStorage.getItem(LS_STEP);
        if (raw) {
          const parsed = JSON.parse(raw) as Answers;
          if (!cancelled && parsed && typeof parsed === "object") {
            setAnswers((prev) => {
              // prefer backend initialProfile values if non-empty, otherwise draft
              const merged: Answers = { ...parsed };
              for (const [k, v] of Object.entries(prev)) if (v && v.trim()) merged[k] = v;
              return merged;
            });
          }
        }
        if (rawStep) {
          const n = Number(rawStep);
          if (Number.isFinite(n) && n >= 0 && n < STEPS.length) setStep(n);
        }
      } catch {}
      // then fetch backend for truth
      setLoadingProfile(true);
      try {
        const res = await fetch("/api/acquisition/profile", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (j.profile && !cancelled) {
            const backendAnswers = payloadToAnswers(j.profile);
            setAnswers((prev) => {
              const merged: Answers = { ...prev };
              for (const [k, v] of Object.entries(backendAnswers)) if (v) merged[k] = v;
              return merged;
            });
            // if profile looks complete-ish, offer resume prompt (handled via effect)
          }
          // if backend already READY/ACTIVE, jump to review or done?
        }
      } catch {}
      setLoadingProfile(false);
      setHydrated(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to localStorage on answers/step change
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_ANSWERS, JSON.stringify(answers));
    } catch {}
  }, [answers, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_STEP, String(step));
    } catch {}
  }, [step, hydrated]);

  const payload = useMemo(() => answersToPayload(answers), [answers]);

  const doSave = useCallback(
    async (p: Record<string, unknown>) => {
      if (!Object.keys(p).length) return true;
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch("/api/acquisition/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            j.errors?.join?.(", ") ||
              j.reason ||
              (typeof j.error === "string" && j.error !== "internal" ? j.error : null) ||
              `Save failed (${res.status})`
          );
        }
        setLastSavedAt(new Date().toLocaleTimeString());
        return true;
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // Autosave debounced on answers
  useEffect(() => {
    if (!hydrated) return;
    // skip autosave when still loading profile initially? but we hydrated, so okay
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      doSave(payload);
    }, 900);
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [payload, hydrated, doSave]);

  function updateAnswer(key: string, value: string) {
    setAnswers((s) => ({ ...s, [key]: value }));
    setValidationError(null);
  }

  function validateCurrent(): boolean {
    const cur = current!;
    for (const f of cur.fields) {
      if (f.required) {
        const v = (answers[f.key] || "").trim();
        if (!v) {
          setValidationError(`Please fill in: ${f.label}`);
          return false;
        }
        if (f.key === "website" && v) {
          if (v.includes(" ") || v.includes("!")) {
            setValidationError("Website must be a valid URL");
            return false;
          }
        }
      }
    }
    setValidationError(null);
    return true;
  }

  async function handleNext() {
    if (!validateCurrent()) return;
    // immediate save before advancing
    await doSave(payload);
    if (step < total - 1) {
      setStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setMode("review");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleBack() {
    setValidationError(null);
    if (isReview) setMode("form");
    else if (step > 0) setStep((s) => s - 1);
  }

async function handleSaveExit() {
    const saved = await doSave(payload);
    // Do not leave the wizard implying success when the write failed.
    if (!saved) return;
    router.push("/acquisition");
  }

  async function handleActivate() {
    setActivating(true);
    setActivateMsg(null);
    try {
      // Activation is a real entitlement-bearing transition — confirm it.
      if (typeof window !== "undefined" && !window.confirm("Activate Acquisition OS? The OS will start operating on this brief.")) {
        return;
      }
      const res = await fetch("/api/acquisition/profile/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          j.reason ||
            j.whatNext ||
            (typeof j.error === "string" && j.error !== "internal" ? j.error : null) ||
            `Activation failed (${res.status})`
        );
      }
      setActivated(true);
      setActivateMsg("Activated — Acquisition OS is now operating.");
      // The page header renders server-side status; refresh so it clears.
      router.refresh();
    } catch (e) {
      setActivateMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(false);
    }
  }

  async function handleSubmit() {
    // Final validation: ensure required steps all filled
    for (let i = 0; i < STEPS.length; i++) {
      const s = STEPS[i]!;
      for (const f of s.fields) if (f.required) {
        if (!(answers[f.key] || "").trim()) {
          setStep(i);
          setMode("form");
          setValidationError(`Please fill in: ${f.label} (Step ${i + 1})`);
          return;
        }
      }
    }
    // Only show the green "ready" state when the write actually landed.
    const saved = await doSave(payload);
    if (!saved) return;
    setMode("done");
    try {
      localStorage.removeItem(LS_STEP);
    } catch {
      // non-critical
    }
  }

  const progress = isDone ? 100 : isReview ? 100 : ((step + 1) / total) * 100;
  const stepLabel = isDone ? "Complete" : isReview ? `Review` : `Step ${step + 1} of ${total}`;

  if (isDone) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 sm:py-16">
        <div className="rounded-lg border border-border/80 bg-card p-8 sm:p-10 text-center">
<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-white">
            <span className="text-xl">✓</span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Your Acquisition Profile is ready.</h1>
          <p className="mt-2 font-sans text-[13px] text-muted-foreground leading-relaxed">
            We have everything Acquisition OS needs to understand your company. Your profile is saved{activated ? " and the OS is activated" : ""}.{" "}
            {!activated && "One step left: activate so the OS starts operating on this brief."}
          </p>
          {/* A later autosave can fail after this screen mounted; never hide it. */}
          {saveError ? (
            <p className="mt-3 font-sans text-[13px] text-destructive">
              Some answers did not save: {saveError}. Review your answers before activating.
            </p>
          ) : null}
          {activateMsg && (
            <p className={`mt-3 font-sans text-[13px] ${activated ? "text-emerald-700" : "text-destructive"}`}>{activateMsg}</p>
          )}
<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {!activated ? (
              <button onClick={handleActivate} disabled={activating} className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {activating ? "Activating…" : "Activate Acquisition OS"}
              </button>
            ) : (
              <button onClick={() => router.push("/acquisition/generate")} className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
                Generate your first leads
              </button>
            )}
            <button onClick={() => router.push("/acquisition")} className="inline-flex h-10 items-center justify-center rounded-lg border border-border/80 px-6 font-sans text-[13px] font-medium hover:bg-accent">
              Go to Acquisition OS
            </button>
            <button onClick={() => { setMode("review"); }} className="inline-flex h-10 items-center justify-center rounded-lg border border-border/80 px-6 font-sans text-[13px] font-medium hover:bg-accent">
              Review answers
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isReview) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">Review</p>
            <span className="font-sans text-[13px] leading-5 text-muted-foreground">{saving ? "Saving…" : lastSavedAt ? `Saved ${lastSavedAt}` : "Autosaved"}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Review your answers</h1>
          <p className="mt-1 font-sans text-[13px] text-muted-foreground">Check everything before we finish. You can edit any answer.</p>
          <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="space-y-3">
          {STEPS.map((s, idx) => {
            const vals = s.fields.map((f) => answers[f.key]?.trim() || "—").join(" · ");
            const hasMissing = s.fields.some((f) => f.required && !(answers[f.key] || "").trim());
            return (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-border/80 bg-card p-4">
                <div className="min-w-0">
                  <p className="font-sans text-[13px] leading-5 text-muted-foreground">Step {idx + 1}</p>
                  <p className="font-sans text-[13px] font-medium leading-tight">{s.question}</p>
                  <p className={`mt-1 font-sans text-[13px] break-words ${hasMissing ? "text-amber-600" : "text-muted-foreground"}`}>{vals}</p>
                  {hasMissing && <p className="text-xs text-amber-600 mt-1">Missing required field</p>}
                </div>
                <button onClick={() => { setMode("form"); setStep(idx); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="shrink-0 rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-accent">
                  Edit
                </button>
              </div>
            );
          })}
        </div>

        {saveError && <p className="mt-4 font-sans text-[13px] text-destructive">{saveError}</p>}

<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button onClick={handleBack} className="inline-flex h-10 items-center justify-center rounded-lg border border-border/80 px-5 font-sans text-[13px] font-medium hover:bg-accent">Back</button>
          <div className="flex flex-col gap-3 sm:flex-row">
            {/* Previously `hidden sm:inline-flex` with no mobile replacement —
                on a phone a client who wanted out lost the affordance entirely. */}
            <button onClick={handleSaveExit} className="inline-flex h-10 w-full items-center justify-center rounded-lg px-4 font-sans text-[13px] text-muted-foreground hover:text-foreground sm:w-auto">
              Save & exit
            </button>
<button onClick={handleSubmit} disabled={saving} className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-6 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:w-auto">
              {saving ? "Saving…" : "Confirm — Profile ready"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Form flash-card
  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
      {/* Top meta */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Acquisition Profile</p>
          <button onClick={handleSaveExit} className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
            Save and continue later
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{stepLabel}</p>
          <span className="font-sans text-[13px] leading-5 text-muted-foreground">{saving ? "Saving…" : lastSavedAt ? `Saved • ${lastSavedAt}` : loadingProfile ? "Loading…" : "Autosaved"}</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-foreground transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Card */}
      <div className="rounded-lg border border-border/80 bg-card overflow-hidden">
        <div className="px-6 pt-7 pb-6 sm:px-8 sm:pt-8">
          <h1 className="text-xl font-semibold tracking-tight leading-tight sm:text-2xl">{current!.question}</h1>
          <p className="mt-2 font-sans text-[13px] text-muted-foreground leading-relaxed">{current!.subtitle}</p>

          <div className="mt-6 space-y-4">
            {current!.fields.map((f) => {
              const val = answers[f.key] || "";
              const isArea = f.type === "textarea" || f.label.length > 40;
              return (
                <label key={f.key} className="block">
                  <span className="text-xs font-medium text-muted-foreground">
                    {f.label} {f.required && <span className="text-destructive">*</span>}
                  </span>
                  {f.type === "textarea" || isArea ? (
                    <textarea
                      value={val}
                      onChange={(e) => updateAnswer(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      rows={f.key.includes("whatWeSell") || f.key.includes("valueProp") || f.key.includes("differentiators") ? 4 : 3}
                      className="mt-1.5 flex min-h-[96px] w-full rounded-lg border border-border/80 border-input bg-background px-3 py-2.5 font-sans text-[13px] shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  ) : (
                    <input
                      type={f.type === "number" ? "number" : "text"}
                      value={val}
                      onChange={(e) => updateAnswer(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="mt-1.5 flex h-10 w-full rounded-lg border border-border/80 border-input bg-background px-3 py-2 font-sans text-[13px] shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  )}
                </label>
              );
            })}
          </div>

          {validationError && <p className="mt-3 font-sans text-[13px] text-destructive">{validationError}</p>}
          {saveError && <p className="mt-3 font-sans text-[13px] text-destructive">{saveError}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-6 py-4 sm:px-8">
          <button onClick={handleBack} disabled={step === 0} className="inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-border/80 bg-background px-4 font-sans text-[13px] font-medium hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed">
            ← Back
          </button>
          <button onClick={handleNext} className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 font-sans text-[13px] font-medium text-primary-foreground shadow hover:bg-primary/90">
            {step === total - 1 ? "Review →" : "Continue →"}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">One Waves account across all platforms. Your progress is saved automatically.</p>

      {hydrated && Object.values(answers).some(Boolean) && step === 0 && (
        <div className="mt-3 text-center">
          <span className="font-sans text-[13px] leading-5 text-muted-foreground">Tip: use Back / Continue to move through the cards. You can leave any time — resume where you left off.</span>
        </div>
      )}
    </div>
  );
}
