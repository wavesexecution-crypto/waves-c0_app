import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getClientWorkspace } from "@/lib/client-workspace";
import { TaskStatusSelect } from "@/components/clients/forms";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@wavesco/ui";
import { formatIST, relativeFrom } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const priorityStyle: Record<string, string> = {
  high: "text-red-500",
  medium: "",
  low: "text-muted-foreground",
};

export default async function ClientTasksPage({ params }: PageProps) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { id } = await params;
  const data = await getClientWorkspace(tenantId, id);
  if (!data) notFound();
  const { tasks, projects } = data;
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Tasks ({tasks.filter((t) => t.status !== "done").length} open / {tasks.length})
      </h2>
      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No tasks yet. Add them from a project.
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className={t.status === "done" ? "text-muted-foreground line-through" : ""}>
                    {t.title}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{projectName.get(t.projectId) ?? "—"}</TableCell>
                  <TableCell className={priorityStyle[t.priority] ?? ""}>{t.priority}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.dueDate ? (
                      <span className={t.dueDate.getTime() < Date.now() && t.status !== "done" ? "font-medium text-red-500" : ""}>
                        {formatIST(t.dueDate)} · {relativeFrom(t.dueDate.toISOString())}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <TaskStatusSelect taskId={t.id} status={t.status} clientId={id} />
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
