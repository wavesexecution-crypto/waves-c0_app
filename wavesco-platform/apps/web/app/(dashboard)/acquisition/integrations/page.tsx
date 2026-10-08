import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getIntegrationsHealth } from "@/lib/wavesco/integrations";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { StorageConnectorCard } from "@/components/acquisition/storage-connector-card";
import { EmailModeSelector } from "@/components/acquisition/email-mode-selector";
import { readEmailMode } from "@/lib/wavesco/mail-mode";
import { readPersistedStorageConfig, sanitizeStorageConfigForClient } from "@/lib/wavesco/storage";
import { storagePing, wavesStorageConfig } from "@/lib/wavesco/object-storage";

async function WavesStorageCard({ tenantId }: { tenantId: string }) {
  const resolved = wavesStorageConfig();
  if ("error" in resolved) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-sm font-medium">Your files & reports — unavailable</p>
        <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Uploads and report downloads aren&apos;t available right now. Your leads, emails and replies are unaffected.</p>
      </div>
    );
  }
  const ping = await storagePing(resolved.config);
  let counts: Record<string, number> = {};
  try {
    counts = await withTenantContext(tenantId, async (tx) => {
      const rows = await tx.storedObject.groupBy({ by: ["status"], where: { tenantId }, _count: true });
      return Object.fromEntries(rows.map((r) => [r.status, r._count]));
    });
  } catch {
    counts = {};
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-lg border border-border/80 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Your files & reports</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {ping.ok ? "Connected — your files are stored safely" : "Needs attention"}
          </p>
        </div>
        <StatusPill state={ping.ok ? "connected" : "error"} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {total === 0
          ? "No files stored yet — uploads and your reports will appear here."
          : Object.entries(counts).map(([s, c]) => `${c} ${s.toLowerCase()}`).join(" · ")}
      </p>
      {!ping.ok && (
        <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">If a download fails, you&apos;ll see an error right away — nothing disappears silently.</p>
      )}
    </div>
  );
}
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connections" };

type Probe = { status?: string } | undefined;

/** Plain-language connection state derived from the same server-side probe. */
function connState(entry: unknown): { pill: string; label: string } {
  const status = String((entry as Probe)?.status ?? "missing").toLowerCase();
  if (status === "ok") return { pill: "connected", label: "Connected" };
  return { pill: "disconnected", label: "Needs attention" };
}

export default async function IntegrationsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);

  let health: Awaited<ReturnType<typeof getIntegrationsHealth>> | null = null;
  let loadError: string | null = null;
  try {
    health = await getIntegrationsHealth(tenantId);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  // Email operating mode (client choice) — drives the plain-language email card.
  // Defaults to waves_managed on transient failure — never blocks the page.
  let emailMode: "waves_managed" | "client_managed" = "waves_managed";
  try {
    emailMode = await withTenantContext(tenantId, async (tx: any) => {
      const profile = await tx.acquisitionProfile.findFirst({
        where: { tenantId },
        select: { integrations: true },
      });
      return readEmailMode(profile?.integrations);
    });
  } catch {
    // keep default
  }

  let storageInitial: Record<string, unknown> | null = null;
  try {
    storageInitial = await withTenantContext(tenantId, async (tx: any) =>
      sanitizeStorageConfigForClient(await readPersistedStorageConfig(tx, tenantId)),
    );
  } catch {
    // transient DB error — the card will show NOT CONNECTED and retry on connect
  }

  const emailProbe = (health as any)?.brevo;
  const aiProbe = (health as any)?.ai_gateway;
  const behindScenes: { name: string; entry: unknown }[] = [
    { name: "Prospect research", entry: (health as any)?.lead_engine },
    { name: "WAVES automation", entry: (health as any)?.n8n },
    { name: "Your workspace data", entry: (health as any)?.db ?? (health as any)?.postgres },
  ];
  const emailConn = connState(emailProbe);
  const aiConn = connState(aiProbe);
  const attentionCount = [emailProbe, aiProbe, ...behindScenes.map((b) => b.entry)].filter(
    (e) => connState(e).label !== "Connected",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Setup</p>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Connections</h1>
          <p className="mt-1.5 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
            What WAVES is connected to. If something needs attention, you&apos;ll see it here first — checked automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={30_000} />
          <StatusPill state={loadError || attentionCount > 0 ? "disconnected" : "connected"} />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {loadError || attentionCount > 0 ? "Needs attention" : "All connected"}
          </span>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">Couldn&apos;t check connections</p>
          <p className="font-sans text-[13px] leading-5 text-muted-foreground">{loadError}</p>
          <a href="/acquisition/integrations" className="mt-2 inline-block rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}

      {/* Email — the client choice: your mailbox or WAVES-managed */}
      <section className="space-y-3">
        <div className="rounded-lg border border-border/80 bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Email sending</p>
              <p className="mt-0.5 font-sans text-[13px] leading-5 text-muted-foreground">
                {emailConn.label === "Connected"
                  ? "WAVES can send email for your campaigns."
                  : "Email sending needs attention — your campaigns are waiting."}
              </p>
            </div>
            <StatusPill state={emailConn.pill} />
          </div>
          <div className="mt-3">
            <EmailModeSelector initialMode={emailMode} />
          </div>
          <Link href="/acquisition/email" className="mt-3 inline-block font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground hover:underline">
            See templates and delivery →
          </Link>
        </div>
      </section>

      {/* WAVE AI + behind the scenes */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border/80 bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">WAVE AI</p>
              <p className="mt-0.5 font-sans text-[13px] leading-5 text-muted-foreground">
                {aiConn.label === "Connected" ? "WAVE AI is ready to help." : "WAVE AI needs attention."}
              </p>
            </div>
            <StatusPill state={aiConn.pill} />
          </div>
          <Link href="/intelligence/ai" className="mt-3 inline-block font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground hover:underline">
            Ask WAVE AI →
          </Link>
        </div>
        <div className="rounded-lg border border-border/80 bg-card p-4">
          <p className="text-sm font-medium">Behind the scenes</p>
          <p className="mt-0.5 font-sans text-[13px] leading-5 text-muted-foreground">The machinery WAVES runs for you. Nothing to configure here.</p>
          <div className="mt-3 space-y-2">
            {behindScenes.map((b) => {
              const st = connState(b.entry);
              return (
                <div key={b.name} className="flex items-center justify-between rounded border bg-muted/20 px-3 py-2 text-xs">
                  <span className="font-medium">{b.name}</span>
                  <span className={st.label === "Connected" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}>{st.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <StorageConnectorCard initial={storageInitial} />

      <WavesStorageCard tenantId={tenantId} />

      <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
        Connections are checked automatically. If anything stops working, WAVES keeps what&apos;s connected running.
      </p>
    </div>
  );
}
