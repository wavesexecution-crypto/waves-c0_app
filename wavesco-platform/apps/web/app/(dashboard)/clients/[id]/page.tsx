import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getClientWorkspace } from "@/lib/client-workspace";
import { OnboardingToggle } from "@/components/clients/forms";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientOverviewPage({ params }: PageProps) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { id } = await params;
  const data = await getClientWorkspace(tenantId, id);
  if (!data) notFound();
  const { client, steps, projects, tasks, deliverables } = data;

  const done = steps.filter((s) => s.done).length;
  const openTasks = tasks.filter((t) => t.status !== "done").length;
  const overdue = tasks.filter(
    (t) => t.dueDate && t.dueDate.getTime() < Date.now() && t.status !== "done",
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
          <p className="mt-1 font-medium">{client.status}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Onboarding</p>
          <p className="mt-1 font-medium tabular-nums">
            {done}/{steps.length}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Projects</p>
          <p className="mt-1 font-medium tabular-nums">{projects.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Open tasks</p>
          <p className="mt-1 font-medium tabular-nums">
            {openTasks}
            {overdue > 0 ? <span className="ml-2 text-xs text-red-500">{overdue} overdue</span> : null}
          </p>
        </div>
      </div>

      {client.notes ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{client.notes}</p>
        </section>
      ) : null}

      <section className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Onboarding ({done}/{steps.length})
        </h2>
        {steps.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No onboarding steps recorded.</p>
        ) : (
          <ul className="divide-y">
            {steps.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-1.5 text-sm">
                <OnboardingToggle stepId={s.id} done={s.done} />
                <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.title}</span>
                {s.doneAt ? (
                  <time className="ml-auto text-[11px] text-muted-foreground">{formatIST(s.doneAt)}</time>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {deliverables.length > 0 ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Latest deliverables</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {deliverables.slice(0, 5).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span>{d.title}</span>
                <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{d.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
