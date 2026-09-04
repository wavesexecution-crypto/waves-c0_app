import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: { searchParams?: { callbackUrl?: string } }) {
  const session = await auth();
  const email = (session as any)?.user?.email as string | undefined;
  const tenantId = (session as any)?.user?.tenantId as string | undefined;
  const isRecognized = (typeof email === "string" && email.length > 0) || (typeof tenantId === "string" && tenantId.length > 0);

  // If Waves profile already recognized via shared .wavesco.in cookie — no app sign-in needed
  if (isRecognized) {
    const cb = searchParams?.callbackUrl;
    let safe: string | null = null;
    if (cb) {
      if (cb.startsWith("/") && !cb.startsWith("//")) safe = cb;
      else {
        try {
          const dest = new URL(cb);
          const allowed = ["wavesco.in", "app.wavesco.in", "www.wavesco.in", "localhost", "127.0.0.1"];
          if (allowed.some((h) => dest.hostname === h || dest.hostname.endsWith("." + h))) safe = cb;
        } catch {}
      }
    }
    const dest = safe ?? "/overview";
    if (dest.startsWith("http")) redirect(dest);
    redirect(dest);
  }

  // Not recognized — single auth system on main site
  const wavesMain = (process.env.WAVES_MAIN_URL || "https://wavesco.in").replace(/\/$/, "");
  const rawCb = searchParams?.callbackUrl ?? "/overview";
  let appCallback: string;
  if (rawCb.startsWith("/") && !rawCb.startsWith("//")) {
    appCallback = `https://app.wavesco.in${rawCb}`;
  } else {
    try {
      const dest = new URL(rawCb);
      const allowed = ["wavesco.in", "app.wavesco.in", "www.wavesco.in"];
      if (allowed.some((h) => dest.hostname === h || dest.hostname.endsWith("." + h))) appCallback = rawCb;
      else appCallback = "https://app.wavesco.in/overview";
    } catch {
      appCallback = "https://app.wavesco.in/overview";
    }
  }
  redirect(`${wavesMain}/login?callbackUrl=${encodeURIComponent(appCallback)}`);

}
