import { randomUUID } from "node:crypto";
import { loadEnv } from "./load-env";

loadEnv();

async function main(): Promise<void> {
  const [emailArg, passwordArg] = process.argv.slice(2);
  if (!emailArg || !passwordArg) {
    console.error("Usage: tsx scripts/add-user.ts <email> <password>");
    process.exit(1);
  }
  const { withTenantContext, prisma, lookupUserByEmail } = await import("@wavesco/db");
  const { hashPassword } = await import("@wavesco/auth/password");

  const email = emailArg.trim().toLowerCase();
  if (await lookupUserByEmail(email)) {
    console.log("user exists already:", email);
    return;
  }

  const { PrismaClient } = await import("../packages/db/src/generated/client");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const tenant = await admin.tenant.findUnique({ where: { slug: "wavesco" } });
  await admin.$disconnect();
  if (!tenant) throw new Error("Tenant 'wavesco' not found");

  const password = passwordArg;
  const userId = `user_${randomUUID().replace(/-/g, "")}`;
  const passwordHash = await hashPassword(password);

  await withTenantContext(
    tenant.id,
    async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          tenantId: tenant.id,
          email,
          name: "WavesCo Ops",
          passwordHash,
          role: "owner",
          status: "active",
          emailVerified: new Date(),
        },
      });
    },
    userId,
  );

  console.log("created", email, "in tenant", tenant.slug);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
