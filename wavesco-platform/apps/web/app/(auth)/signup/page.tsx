import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const metadata = {
  title: "Sign up",
};

export default async function SignupPage({ searchParams }: { searchParams?: { callbackUrl?: string } }) {
  const session = await auth();
  const tenantId = (session as any)?.user?.tenantId as string | undefined;
  const email = (session as any)?.user?.email as string | undefined;
  const isRecognized = (typeof tenantId === "string" && tenantId.length > 0) || (typeof email === "string" && email.length > 0);
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
  const wavesMain = (process.env.WAVES_MAIN_URL || "https://wavesco.in").replace(/\/$/, "");
  const rawCb = searchParams?.callbackUrl ?? "/overview";
  let appCallback: string;
  if (rawCb.startsWith("/") && !rawCb.startsWith("//")) appCallback = `https://app.wavesco.in${rawCb}`;
  else {
    try {
      const dest = new URL(rawCb);
      const allowed = ["wavesco.in", "app.wavesco.in", "www.wavesco.in"];
      if (allowed.some((h) => dest.hostname === h || dest.hostname.endsWith("." + h))) appCallback = rawCb;
      else appCallback = "https://app.wavesco.in/overview";
    } catch { appCallback = "https://app.wavesco.in/overview"; }
  }
  redirect(`${wavesMain}/signup?callbackUrl=${encodeURIComponent(appCallback)}`);
}
