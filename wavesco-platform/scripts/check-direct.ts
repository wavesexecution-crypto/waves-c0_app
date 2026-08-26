import { loadEnv } from "./load-env";
loadEnv();
async function main(): Promise<void> {
  const { PrismaClient } = await import("../packages/db/src/generated/client");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? "" } } });
  const tenants = await admin.$queryRawUnsafe<{ slug: string }[]>(`SELECT slug FROM "Tenant"`);
  console.log("tenants (no RLS):", JSON.stringify(tenants));
  const users = await admin.$queryRawUnsafe<{ email: string; role: string }[]>(
    `SELECT email, role FROM "User"`,
  );
  console.log("users (no RLS):", JSON.stringify(users));
  const clients = await admin.$queryRawUnsafe<{ name: string; status: string }[]>(
    `SELECT name, status FROM "Client"`,
  );
  console.log("clients (no RLS):", JSON.stringify(clients));
  const projects = await admin.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM "Project"`);
  console.log("projects (no RLS):", JSON.stringify(projects));
  await admin.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
