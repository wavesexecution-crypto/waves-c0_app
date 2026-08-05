import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import { Resend } from "resend";
import { lookupUserByEmail } from "@wavesco/db";
import { verifyPassword } from "./password";
import { emailAdapter } from "./verification";

async function sendMagicLinkEmail(params: {
  identifier: string;
  url: string;
  token: string;
  expires: Date;
  provider: { from?: string };
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Magic link email requires RESEND_API_KEY — missing key. Refusing to silently skip delivery (loud failure).",
    );
  }

  const from = process.env.SMTP_FROM ?? "WavesCo <noreply@wavesco.dev>";
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [params.identifier],
    subject: "Your WavesCo sign-in link",
    html: [
      "<div style=\"font-family: system-ui, sans-serif; padding: 24px;\">",
      "<h2>Sign in to WavesCo</h2>",
      `<p>Use this link to sign in. It expires at ${params.expires.toISOString()}.</p>`,
      `<p><a href="${params.url}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#fff;text-decoration:none;border-radius:8px;">Sign in</a></p>`,
      `<p style="color:#71717a;font-size:12px;">If you didn't request this, you can ignore this email.</p>`,
      "</div>",
    ].join(""),
  });

  if (error) {
    throw new Error(`Resend failed to deliver magic link: ${error.message}`);
  }
}

/**
 * Shared Auth.js (NextAuth v5) configuration.
 *
 * - Credentials provider: email + password, verified via bcrypt.
 * - Email provider: REAL Resend call for magic links. Missing
 *   RESEND_API_KEY fails the flow loudly.
 * - JWT session strategy; the JWT carries the tenant id (verified by
 *   middleware and `requireSession`).
 */
function resolveAuthSecret(): string {
  // Auth.js v5 canonical: AUTH_SECRET. Legacy NextAuth v4: NEXTAUTH_SECRET.
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET (or NEXTAUTH_SECRET) is missing or too short. " +
        "Set a 32+ character secret in .env. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return secret;
}

export const authConfig: NextAuthConfig = {
  secret: resolveAuthSecret(),
  adapter: emailAdapter,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", newUser: "/signup" },
  trustHost: true,
  providers: [
    Credentials({
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const user = await lookupUserByEmail(email);
        if (!user?.passwordHash) return null;

        const passwordOk = await verifyPassword(password, user.passwordHash);
        if (!passwordOk) return null;
        if (user.status !== "active") return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
          role: user.role,
        };
      },
    }),
    Nodemailer({
      server: {
        host: process.env.SMTP_HOST ?? "localhost",
        port: Number(process.env.SMTP_PORT ?? "587"),
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
          : undefined,
      },
      from: process.env.SMTP_FROM ?? "WavesCo <noreply@wavesco.dev>",
      sendVerificationRequest: sendMagicLinkEmail,
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger }) {
      // Auth.js v5 lifecycle:
      //   sign-in: jwt({ token, user, account, profile })
      //   requests: jwt({ token })          -> `user` is undefined
      // Only copy claims from `user` when it is actually present; the token
      // already carries them on every subsequent request.
      if (user) {
        token.id = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;
      }
      if (trigger === "update") {
        // Allow server-side session refreshes (tenant data may change).
      }
      return token;
    },
    session({ session, token }) {
      const t = token as Record<string, unknown>;
      session.user = session.user ?? ({} as typeof session.user);
      session.user.id = typeof t.id === "string" ? t.id : "";
      session.user.tenantId = typeof t.tenantId === "string" ? t.tenantId : "";
      session.user.role = typeof t.role === "string" ? t.role : "member";
      return session;
    },
  },
};
