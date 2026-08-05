import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@wavesco/ui";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function OverviewPage() {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const tenantId = typeof user?.tenantId === "string" ? user.tenantId : null;
  if (!tenantId) redirect("/login");

  const data = await withTenantContext(tenantId, async (tx) => {
    const [tenant, memberCount, enabledModules, auditLogs] = await Promise.all([
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, plan: true, status: true, slug: true },
      }),
      tx.user.count({ where: { tenantId } }),
      tx.tenantModule.count({ where: { tenantId, status: "enabled" } }),
      tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { action: true, model: true, recordId: true, createdAt: true },
      }),
    ]);
    return { tenant, memberCount, enabledModules, auditLogs };
  });

  if (!data.tenant) redirect("/login");

  const kpis = [
    { label: "Plan", value: data.tenant.plan, detail: `status ${data.tenant.status}` },
    { label: "Members", value: String(data.memberCount), detail: "people in this workspace" },
    { label: "Enabled modules", value: String(data.enabledModules), detail: "CafeOS modules" },
    { label: "Tenant id", value: tenantId, detail: data.tenant.slug },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back to {data.tenant.name}. Your workspace is ready.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader>
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="break-all text-xl">{kpi.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{kpi.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Audit entries written automatically by the audit extension.</CardDescription>
          </div>
          <Badge variant="outline">{data.auditLogs.length} shown</Badge>
        </CardHeader>
        <CardContent>
          {data.auditLogs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm font-medium">No audit entries yet</p>
              <p className="text-sm text-muted-foreground">
                Mutations performed while signed in appear here automatically.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.auditLogs.map((log) => (
                  <TableRow key={`${log.action}-${log.recordId}-${log.createdAt.toISOString()}`}>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell>{log.model}</TableCell>
                    <TableCell className="font-mono text-xs">{log.recordId}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {log.createdAt.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CafeOS modules</CardTitle>
          <CardDescription>Feature modules ship in Phase 6 with real integrations.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-medium">No modules enabled yet</p>
            <p className="text-sm text-muted-foreground">
              Leads, orders, inventory, CRM and operations modules are on the roadmap.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
