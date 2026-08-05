"use server";

import { Resend } from "resend";
import { emailSchema } from "@wavesco/validators";

export interface ResetRequestResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function requestPasswordReset(
  _prev: ResetRequestResult,
  formData: FormData,
): Promise<ResetRequestResult> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Password reset email requires RESEND_API_KEY — missing key. Refusing to silently skip delivery (loud failure).",
    );
  }

  const from = process.env.SMTP_FROM ?? "WavesCo <noreply@wavesco.dev>";
  const resend = new Resend(apiKey);
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  const { error } = await resend.emails.send({
    from,
    to: [parsed.data],
    subject: "Reset your WavesCo password",
    html: [
      "<div style=\"font-family: system-ui, sans-serif; padding: 24px;\">",
      "<h2>Reset your password</h2>",
      `<p>If you requested a reset, sign in via email magic link at <a href="${baseUrl}/login">${baseUrl}/login</a> and update your password in Settings.</p>`,
      `<p style="color:#71717a;font-size:12px;">If you didn't request this, you can ignore this email.</p>`,
      "</div>",
    ].join(""),
  });

  if (error) {
    throw new Error(`Resend failed to deliver reset email: ${error.message}`);
  }

  return { ok: true, message: "If that email exists, a reset message is on its way." };
}
