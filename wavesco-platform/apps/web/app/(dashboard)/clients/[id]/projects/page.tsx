import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getClientWorkspace } from "@/lib/client-workspace";
import {
  ProjectForm,
  TaskForm,
  TaskStatusSelect,
  DeliverableForm,
  DeliverableStatusSelect,
} from "@/components/clients/forms";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientProjectsPage({ params }: PageProps) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { id } = await params;
  const data = await getClientWorkspace(tenantId, id);
  if (!data) notFound();
  const { client, projects, tasks, deliverables } = data;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Projects</h2>
        <ProjectForm clientId={client.id} />
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No projects yet.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {projects.map((p) => {
            const pTasks = tasks.filter((t) => t.projectId === p.id);
            const pDeliv = deliverables.filter((d) => d.projectId === p.id);
            return (
              <div key={p.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{p.name}</p>
                  <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{p.status}</span>
                </div>
                {p.description ? <p className="mt-1 text-xs text-muted-foreground">{p.description}</p> : null}
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  {pTasks.filter((t) => t.status !== "done").length} open tasks · {pDeliv.length} deliverables
                </p>

                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tasks</p>
                  <ul className="mt-1 space-y-1">
                    {pTasks.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className={t.status === "done" ? "text-muted-foreground line-through" : ""}>{t.title}</span>
                        <TaskStatusSelect taskId={t.id} status={t.status} clientId={client.id} />
                      </li>
                    ))}
                    {pTasks.length === 0 ? <li className="text-xs text-muted-foreground/60">No tasks.</li> : null}
                  </ul>
                  <TaskForm projectId={p.id} clientId={client.id} />
                </div>

                <div className="mt-3 border-t pt-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Deliverables</p>
                  <ul className="mt-1 space-y-1">
                    {pDeliv.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>{d.title}{d.type ? ` (${d.type})` : ""}</span>
                        <DeliverableStatusSelect deliverableId={d.id} status={d.status} clientId={client.id} />
                      </li>
                    ))}
                    {pDeliv.length === 0 ? <li className="text-xs text-muted-foreground/60">No deliverables.</li> : null}
                  </ul>
                  <DeliverableForm projectId={p.id} clientId={client.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
