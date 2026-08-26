import { randomUUID } from "node:crypto";

let prismaRef: { $disconnect(): Promise<void> } | undefined;

async function main(): Promise<void> {
  const email = process.env.OPERATOR_EMAIL;
  const password = process.env.OPERATOR_PASSWORD;

  if (!email || !password) {
    console.log(
      "[seed] OPERATOR_EMAIL / OPERATOR_PASSWORD not set — skipping operator seed. Use scripts/create-tenant.ts to bootstrap a workspace.",
    );
    return;
  }

  const [{ hashPassword }, db] = await Promise.all([
    import("@wavesco/auth/password"),
    import("./src/index"),
  ]);
  prismaRef = db.prisma;
  const { lookupUserByEmail, withTenantContext } = db;

  const existing = await lookupUserByEmail(email);
  if (existing) {
    console.log(`[seed] Operator user ${email} already exists — nothing to do.`);
    return;
  }

  const tenantId = `tenant_${randomUUID().replace(/-/g, "")}`;
  const passwordHash = await hashPassword(password);

  await withTenantContext(tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: "WavesCo",
        slug: "wavesco-hq",
        plan: "operator",
        status: "active",
      },
    });
    await tx.user.create({
      data: {
        id: `user_${randomUUID().replace(/-/g, "")}`,
        tenantId,
        email: email.toLowerCase(),
        name: "WavesCo Operator",
        passwordHash,
        role: "owner",
        status: "active",
        emailVerified: new Date(),
      },
    });
  });

  console.log(`[seed] Created WavesCo workspace for ${email}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaRef?.$disconnect();
  });
