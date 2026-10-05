"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { LeaseInfo } from "@/lib/wavesco/pricing";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

type RazorpayPaymentResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type Status = "idle" | "creating" | "paying" | "verifying" | "done" | "error";

function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve(Boolean(window.Razorpay));
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Self-serve lease checkout for Acquisition OS.
 *
 * SECURITY: this component only receives the PUBLIC Razorpay key id from the
 * orders API (required by checkout.js) and the server-locked lease list. The
 * key secret and webhook secret never leave the server. Amounts are fixed by
 * the server (lib/wavesco/pricing.ts) — the client cannot influence them.
 */
export function CheckoutLeaseGrid({ leases }: { leases: LeaseInfo[] }) {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const busy = status === "creating" || status === "paying" || status === "verifying";

  const handleChoose = useCallback(
    async (lease: LeaseInfo) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setActive(lease.leaseType);
      setError(null);
      setStatus("creating");
      try {
        // 1) Create the Razorpay order server-side (price locked server-side).
        const res = await fetch("/api/billing/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leaseType: lease.leaseType,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Please sign in to lease Acquisition OS.");
          setStatus("error");
          return;
        }
        if (res.status === 403) {
          setError("Only workspace owners and admins can purchase a lease.");
          setStatus("error");
          return;
        }
        if (res.status === 503 || res.status === 400) {
          setError(
            data?.error === "payment_provider_not_configured"
              ? "Payments are not configured yet. Please try again shortly."
              : (data?.error ?? "Unable to create order."),
          );
          setStatus("error");
          return;
        }
        if (!res.ok || !data?.razorpayOrderId || !data?.keyId) {
          setError("Unable to create order. Please try again.");
          setStatus("error");
          return;
        }

        // 2) Razorpay Checkout — keyId is the PUBLIC key id (secret stays server-side).
        setStatus("paying");
        const loaded = await loadRazorpayCheckout();
        if (!loaded || !window.Razorpay) {
          setError("Razorpay checkout failed to load. Please retry.");
          setStatus("error");
          return;
        }

        const rzp = new window.Razorpay({
          key: data.keyId,
          order_id: data.razorpayOrderId,
          name: "WavesCo",
          description: `${lease.days}-day Acquisition OS lease — ${formatINR(lease.paise)}`,
          currency: data.currency ?? "INR",
          handler: async (response: RazorpayPaymentResponse) => {
            // 3) Verify server-side (HMAC + capture + amount check) then re-render.
            setStatus("verifying");
            const vres = await fetch("/api/billing/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            const vdata = await vres.json().catch(() => ({}));
            if (!vres.ok) {
              setError(vdata?.error ?? "Payment could not be verified. Please contact support.");
              setStatus("error");
              return;
            }
            setStatus("done");
            router.refresh();
          },
          modal: {
            ondismiss: () => {
              setStatus("idle");
              setActive(null);
            },
          },
          theme: { color: "#18181b" },
        });
        rzp.open();
      } catch {
        setError("Something went wrong. Please retry.");
        setStatus("error");
      } finally {
        busyRef.current = false;
      }
    },
    [router],
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {leases.map((lease) => {
          const isActive = active === lease.leaseType;
          const label =
            status === "done" && isActive
              ? "Lease active ✓"
              : status === "creating" && isActive
                ? "Creating order…"
                : status === "paying" && isActive
                  ? "Payment opened…"
                  : status === "verifying" && isActive
                    ? "Verifying payment…"
                    : status === "error" && isActive
                      ? "Retry lease"
                      : `Pay ${formatINR(lease.paise)}`;
          return (
            <div
              key={lease.leaseType}
              className="flex flex-col rounded-lg border bg-background p-4"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">{lease.days} days</span>
                {lease.save > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                    save ₹{lease.save.toLocaleString("en-IN")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                ₹{lease.rupees.toLocaleString("en-IN")} total
              </p>
              <p className="text-xs text-muted-foreground">
                ₹{lease.monthly.toLocaleString("en-IN")}/mo equivalent
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleChoose(lease)}
                className={`mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  status === "done" && isActive
                    ? "border-emerald-500/40 bg-emerald-50 text-emerald-700"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {busy && isActive && (
                  <span
                    aria-hidden="true"
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                <span>{label}</span>
              </button>
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Payment processed securely by Razorpay. No auto-renewal — renew anytime from this page.
      </p>
    </div>
  );
}