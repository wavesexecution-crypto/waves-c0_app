import { randomUUID } from "node:crypto";
import { loadEnv } from "./load-env";

loadEnv();

async function main(): Promise<void> {
  const { withTenantContext, prisma, lookupUserByEmail } = await import("@wavesco/db");
  const { hashPassword } = await import("@wavesco/auth/password");

  const [emailArg, passwordArg, nameArg] = process.argv.slice(2);

  if (!emailArg || !passwordArg) {
    console.error("Usage: pnpm tsx scripts/create-tenant.ts <email> <password> [name]");
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const password = passwordArg;
  const name = nameArg?.trim() ?? "New Tenant";

  const existing = await lookupUserByEmail(email);
  if (existing) {
    console.error(`Tenant owner already exists for ${email} (tenant ${existing.tenantId}).`);
    process.exit(1);
  }

  const tenantId = `tenant_${randomUUID().replace(/-/g, "")}`;
  const userId = `user_${randomUUID().replace(/-/g, "")}`;
  const passwordHash = await hashPassword(password);

  await withTenantContext(tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
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
  });

  console.log(`Created tenant "${tenantId}" with owner ${email}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});