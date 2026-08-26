import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@wavesco/ui";
import { requireTenantId } from "@/lib/tenant";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const data = await withTenantContext(tenantId, async (tx) => {
    const [tenant, users] = await Promise.all([
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, plan: true, status: true },
      }),
      tx.user.findMany({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, name: true, role: true, status: true },
      }),
    ]);
    return { tenant, users };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Tenant information, team, and integrations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant</CardTitle>
          <CardDescription>Workspace identity and plan.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Name</p>
            <p className="font-medium">{data.tenant?.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Slug</p>
            <p className="font-mono">{data.tenant?.slug}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Plan</p>
            <p className="font-medium">{data.tenant?.plan}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tenant id</p>
            <p className="font-mono text-xs">{data.tenant?.id}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Members of this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name ?? "—"}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell className="font-mono text-xs">{user.role}</TableCell>
                  <TableCell>{user.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Connect external services to enable module functionality.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Resend, Telegram, OpenAI, Swiggy/Zomato and WhatsApp credentials are configured via environment variables.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
