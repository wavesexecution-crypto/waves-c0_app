import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireInternalAccess, requireTenantId } from "@/lib/tenant";
import { N8nGate } from "@/components/automation/n8n-gate";
import { getExecutions } from "@/lib/wavesco/n8n";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Execution logs" };

export default async function LogsPage() {
  const session = await auth();
  requireTenantId(session);
  // n8n execution ids and workflow internals. Operator-only.
  requireInternalAccess(session);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="text-sm text-muted-foreground">Most recent n8n executions, newest first.</p>
      </div>

      <N8nGate>
        <LogTable />
      </N8nGate>
    </div>
  );
}

const executionStatusStyle: Record<string, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  error: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  running: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  waiting: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

async function LogTable() {
  const ex = await getExecutions(50);
  const rows = ex.data?.data ?? [];

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No executions recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5">Execution</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Started</th>
            <th className="px-4 py-2.5">Finished</th>
            <th className="px-4 py-2.5">Mode</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const status = x.status ?? "unknown";
            return (
              <tr key={x.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-4 py-2 font-mono text-xs">{x.id}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                      executionStatusStyle[status] ?? "border-zinc-500/20 bg-zinc-500/10 text-zinc-500"
                    }`}
                  >
                    {status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{formatIST(x.startedAt ?? null)}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{formatIST(x.stoppedAt ?? null)}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{x.mode ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
