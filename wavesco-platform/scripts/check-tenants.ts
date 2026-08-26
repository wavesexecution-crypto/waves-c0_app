import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const { prisma } = await import("@wavesco/db");
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, name: true } });
  console.log("tenants:", JSON.stringify(tenants));
  const users = await prisma.user.findMany({ select: { email: true, role: true, tenantId: true } });
  console.log("users:", JSON.stringify(users.map((u) => ({ email: u.email, role: u.role }))));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
