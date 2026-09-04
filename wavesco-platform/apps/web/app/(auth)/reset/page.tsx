import { redirect } from "next/navigation";

export const metadata = {
  title: "Reset password",
};

export default function ResetPage({ searchParams }: { searchParams?: { callbackUrl?: string } }) {
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
  redirect(`${wavesMain}/forgot-password?callbackUrl=${encodeURIComponent(appCallback)}`);
}
