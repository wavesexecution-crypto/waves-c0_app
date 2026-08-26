import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getClientWorkspace } from "@/lib/client-workspace";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientActivityPage({ params }: PageProps) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { id } = await params;
  const data = await getClientWorkspace(tenantId, id);
  if (!data) notFound();
  const { activity } = data;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Activity ({activity.length})
      </h2>
      {activity.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No activity recorded for this client yet.
        </div>
      ) : (
        <ol className="divide-y rounded-lg border bg-card">
          {activity.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                {a.href ? (
                  <Link href={a.href} className="truncate font-medium hover:underline">
                    {a.title}
                  </Link>
                ) : (
                  <span className="truncate">{a.title}</span>
                )}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {a.type.replace(/_/g, " ")}
                </span>
              </div>
              <time className="shrink-0 text-xs text-muted-foreground">{formatIST(a.createdAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
