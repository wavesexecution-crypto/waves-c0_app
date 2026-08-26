import type { ReactNode } from "react";
import Link from "next/link";
import { getHealth, getWorkflows, n8nApiKey } from "@/lib/wavesco/n8n";
import { StatusPill } from "@/components/command/primitives";

export interface N8nGateResult {
  ok: boolean;
  reason?: string;
  error?: string;
}

/** Renders the honest DISCONNECTED state or wraps live children. */
export async function N8nGate({
  children,
}: {
  children: ReactNode;
}) {
  const health = await getHealth();
  const hasKey = Boolean(n8nApiKey());

  if (!health.ok && health.reason === "no_base_url") {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">n8n not configured</p>
          <StatusPill state="disconnected" />
        </div>
        <p className="mt-1 text-muted-foreground">
          Set N8N_BASE_URL in the platform .env and restart.
        </p>
      </div>
    );
  }

  if (!hasKey || !health.ok) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed p-6 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              {health.ok ? "n8n REST API disconnected" : "n8n instance unreachable"}
            </p>
            <p className="text-muted-foreground">
              {health.ok
                ? "The instance answers healthz but no API key is configured, so workflow and execution data cannot be read. Nothing here will be faked."
                : (health.error ?? "Connection failed")}
            </p>
          </div>
          <StatusPill state={health.ok ? "disconnected" : "error"} />
        </div>
        <ol className="list-inside list-decimal text-xs text-muted-foreground">
          <li>
            Open <Link className="underline" href="http://localhost:5678/settings/api">n8n → Settings → n8n API</Link> and create a key.
          </li>
          <li>
            Add <code className="rounded bg-muted px-1">N8N_API_KEY=…</code> to the platform .env (stays server-side).
          </li>
          <li>Restart the app.</li>
        </ol>
        <Link href="/automation/workflows" className="inline-block rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
          Retry
        </Link>
      </div>
    );
  }

  const wf = await getWorkflows();
  if (!wf.ok) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        n8n API rejected the request ({wf.status}). Verify the key has read scopes.{" "}
        <Link href="/automation/workflows" className="underline">Retry</Link>
      </div>
    );
  }

  return <>{children}</>;
}
