import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getClientWorkspace } from "@/lib/client-workspace";
import { DeliverableStatusSelect } from "@/components/clients/forms";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@wavesco/ui";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientDeliverablesPage({ params }: PageProps) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { id } = await params;
  const data = await getClientWorkspace(tenantId, id);
  if (!data) notFound();
  const { deliverables, projects } = data;
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Deliverables ({deliverables.filter((d) => d.deliveredAt).length}/{deliverables.length} delivered)
      </h2>
      {deliverables.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No deliverables yet. Add them from a project.
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deliverable</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliverables.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.title}</TableCell>
                  <TableCell className="text-muted-foreground">{d.type ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{projectName.get(d.projectId) ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.dueDate ? formatIST(d.dueDate) : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.deliveredAt ? formatIST(d.deliveredAt) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <DeliverableStatusSelect deliverableId={d.id} status={d.status} clientId={id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
