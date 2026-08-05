"use server";

import { randomUUID } from "node:crypto";
import { signIn } from "@/lib/auth";
import { hashPassword } from "@wavesco/auth";
import { lookupUserByEmail, withTenantContext } from "@wavesco/db";
import { signupSchema } from "@wavesco/validators";

export interface SignupResult {
  ok: boolean;
  error?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function signupAction(
  _prevState: SignupResult,
  formData: FormData,
): Promise<SignupResult> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name") ?? undefined,
    tenantName: formData.get("tenantName"),
    tenantSlug: formData.get("tenantSlug") ?? undefined,
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid signup input";
    return { ok: false, error: message };
  }

  const { email, password, name, tenantName, tenantSlug } = parsed.data;

  const existing = await lookupUserByEmail(email);
  if (existing) {
    return { ok: false, error: "An account with this email already exists." };
  }

  const tenantId = `tenant_${randomUUID().replace(/-/g, "")}`;
  const userId = `user_${randomUUID().replace(/-/g, "")}`;
  const passwordHash = await hashPassword(password);

  await withTenantContext(
    tenantId,
    async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          name: tenantName,
          slug: tenantSlug ?? slugify(tenantName),
        },
      });
      await tx.user.create({
        data: {
          id: userId,
          tenantId,
          email,
          name,
          passwordHash,
          role: "owner",
          emailVerified: new Date(),
        },
      });
    },
    userId,
  );

  await signIn("credentials", { email, password, redirectTo: "/overview" });
  return { ok: true };
}
