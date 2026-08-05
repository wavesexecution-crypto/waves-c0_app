import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma, withTenantContext, lookupUserByEmail } from "./src";

const DEMO_EMAIL = "demo@cafe.com";
const DEMO_PASSWORD = "Password123!";

async function main(): Promise<void> {
  const existing = await lookupUserByEmail(DEMO_EMAIL);
  if (existing) {
    console.log(`Seed skipped — ${DEMO_EMAIL} already exists (tenant ${existing.tenantId}).`);
    return;
  }

  const tenantId = `tenant_${randomUUID().replace(/-/g, "")}`;
  const userId = `user_${randomUUID().replace(/-/g, "")}`;
  const passwordHash = await hash(DEMO_PASSWORD, 12);

  await withTenantContext(tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: "Demo Cafe",
        slug: "demo-cafe",
        plan: "starter",
      },
    });

    await tx.user.create({
      data: {
        id: userId,
        tenantId,
        email: DEMO_EMAIL,
        name: "Demo Owner",
        passwordHash,
        role: "owner",
        emailVerified: new Date(),
      },
    });
  });

  console.log(`Seeded tenant "${tenantId}" with owner ${DEMO_EMAIL}`);
  console.log(`  login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
