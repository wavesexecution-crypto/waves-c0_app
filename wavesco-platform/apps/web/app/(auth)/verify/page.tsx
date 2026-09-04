import { redirect } from "next/navigation";

export const metadata = {
  title: "Check your email",
};

export default function VerifyPage() {
  const wavesMain = (process.env.WAVES_MAIN_URL || "https://wavesco.in").replace(//$/, "");
  redirect(`${wavesMain}/login`);
}
