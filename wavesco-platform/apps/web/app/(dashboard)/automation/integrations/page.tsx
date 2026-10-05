import type { Metadata } from "next";
import { existsSync } from "node:fs";
import { auth } from "@/lib/auth";
import { requireInternalAccess, requireTenantId } from "@/lib/tenant";
import { n8nApiKey, n8nBaseUrl } from "@/lib/wavesco/n8n";
import { leadEngineRoot, pythonExe } from "@/lib/wavesco/lead-engine";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations" };

function VarRow({ name, present }: { name: string; present: boolean }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{name}</code>
      <span className={present ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
        {present ? "set" : "missing"}
      </span>
    </div>
  );
}

export default async function IntegrationsPage() {
  const session = await auth();
  requireTenantId(session);
  // Shows which environment variables are set and where the engine lives on
  // disk. Operator-only.
  requireInternalAccess(session);

  const engineRoot = leadEngineRoot();
  const checks = [
    { name: "LEAD_ENGINE_ROOT", present: Boolean(process.env.LEAD_ENGINE_ROOT) },
    { name: "N8N_BASE_URL", present: Boolean(n8nBaseUrl()) },
    { name: "N8N_API_KEY", present: Boolean(n8nApiKey()) },
    { name: "OPENAI_API_KEY", present: Boolean(process.env.OPENAI_API_KEY) },
    { name: "RESEND_API_KEY (auth email)", present: Boolean(process.env.RESEND_API_KEY) },
    { name: "SMTP_* (magic links)", present: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER) },
  ];

  const files = [
    { label: "Lead Engine DB", path: `${engineRoot}\\data\\leads.db` },
    { label: "Engine venv python", path: pythonExe() },
    { label: "Runs directory", path: `${engineRoot}\\data\\runs` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Configuration surface. Values are never rendered — only whether they are set.
        </p>
      </div>

      <section className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Environment</h2>
        {checks.map((c) => (
          <VarRow key={c.name} name={c.name} present={c.present} />
        ))}
      </section>

      <section className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-foreground">On-disk systems</h2>
        {files.map((f) => (
          <div key={f.label} className="flex items-center justify-between gap-4 border-b py-1.5 text-sm last:border-0">
            <span className="shrink-0 text-muted-foreground">{f.label}</span>
            <span className="truncate font-mono text-xs">{f.path}</span>
            <span className={existsSync(f.path) ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
              {existsSync(f.path) ? "ok" : "missing"}
            </span>
          </div>
        ))}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Telegram bot token, Google service-account keys and the SMTP password live inside the Lead
        Engine env / n8n credentials — deliberately not readable here.
      </p>
    </div>
  );
}
