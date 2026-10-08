import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replies" };

const STATUS_STYLE: Record<string, string> = {
  OPEN: "border-line text-muted-foreground",
  REPLIED: "border-blue-500/40 bg-blue-500/10 text-blue-700",
  POSITIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  UNSUBSCRIBED: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600",
  BOUNCED: "border-red-500/40 bg-red-500/10 text-red-700",
  CLOSED: "border-line text-muted-foreground",
};

const STATUS_NEXT: Record<string, string> = {
  OPEN: "No reply yet — outreach sent, awaiting response.",
  REPLIED: "Reply received — read the thread and respond personally.",
  POSITIVE: "Positive signal — book the meeting now, then record it as a conversion.",
  UNSUBSCRIBED: "Suppressed — the OS will never contact this recipient again.",
  BOUNCED: "Undeliverable — verify the address before any manual retry.",
  CLOSED: "Closed.",
};

export default async function RepliesPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; status?: string }>;
}) {
  const session = await auth();
  const tenantId = requireTenantId(session as any);
  const sp = await searchParams;
  const statusFilter = typeof sp.status === "string" && sp.status !== "all" ? sp.status.toUpperCase() : null;
  const threadId = typeof sp.thread === "string" ? sp.thread : null;

  const conversations: any[] = await withTenantContext(tenantId, async (tx: any) =>
    tx.conversation.findMany({
      where: { tenantId, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    }),
  );

  let thread: { conv: any; messages: any[] } | null = null;
  if (threadId) {
    thread = await withTenantContext(tenantId, async (tx: any) => {
      const conv = await tx.conversation.findFirst({ where: { id: threadId, tenantId } });
      if (!conv) return null;
      const messages = await tx.conversationMessage.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return { conv, messages };
    });
  }

  const openCount = conversations.filter((c) => c.status === "OPEN").length;
  const repliedCount = conversations.filter((c) => ["REPLIED", "POSITIVE"].includes(c.status)).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Acquisition OS</p>
        <h1 className="text-2xl font-semibold tracking-tight">Replies</h1>
        <p className="text-sm text-muted-foreground">
          Every inbound reply, bounce and unsubscribe in one place — {openCount} waiting for a reply · {repliedCount} replied.
          Every reply is saved automatically — nothing is lost, nothing is made up.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {([
          { value: "all", label: "All" },
          { value: "OPEN", label: "Waiting for reply" },
          { value: "REPLIED", label: "Replied" },
          { value: "POSITIVE", label: "Positive" },
          { value: "UNSUBSCRIBED", label: "Not interested" },
          { value: "BOUNCED", label: "Bounced" },
        ] as { value: string; label: string }[]).map(({ value: s, label }) => (
          <Link
            key={s}
            href={s === "all" ? "/acquisition/replies" : `/acquisition/replies?status=${s}`}
            className={`rounded-full border px-3 py-1 font-mono uppercase tracking-wider ${
              (statusFilter ?? "all") === (s === "all" ? "all" : s)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-line text-muted-foreground hover:bg-accent"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {conversations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">No conversations yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Threads appear here as soon as prospects reply, bounce, or ask not to be contacted.
            Replies are saved automatically; you never need to copy them anywhere by hand.
          </p>
          <Link href="/acquisition/outreach" className="mt-4 inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-accent">
            See your outreach
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-2">
            {conversations.map((c) => (
              <Link
                key={c.id}
                href={`/acquisition/replies?thread=${c.id}${statusFilter ? `&status=${statusFilter}` : ""}`}
                className={`block rounded-lg border bg-card p-4 hover:bg-accent/50 ${threadId === c.id ? "ring-1 ring-primary" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{c.businessName ?? c.leadKey}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLE[c.status] ?? STATUS_STYLE.OPEN}`}>
                    {String(c.status).toLowerCase()}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{c.email ?? c.leadKey}</p>
              </Link>
            ))}
          </div>
          <div className="rounded-lg border bg-card p-5">
            {!thread ? (
              <p className="text-sm text-muted-foreground">Select a conversation to read the thread.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{thread.conv.businessName ?? thread.conv.leadKey}</p>
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLE[thread.conv.status] ?? STATUS_STYLE.OPEN}`}>
                    {String(thread.conv.status).toLowerCase()}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {STATUS_NEXT[thread.conv.status] ?? ""}
                </p>
                <div className="mt-4 space-y-3">
                  {thread.messages.length === 0 && <p className="text-sm text-muted-foreground">No messages recorded yet.</p>}
                  {thread.messages.map((m: any) => (
                    <div key={m.id} className={`rounded-md border p-3 text-sm ${m.direction === "OUT" ? "ml-8 bg-muted/40" : "mr-8 bg-background"}`}>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {m.direction === "OUT" ? "Waves" : "Prospect"} · {m.kind} · {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Link href={`/acquisition/leads/${encodeURIComponent(thread.conv.leadKey)}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">
                    Open lead
                  </Link>
                  {thread.conv.status === "OPEN" && (
                    <Link href="/acquisition/follow-ups" className="rounded-md border px-3 py-1.5 hover:bg-accent">
                      No reply yet — leave it, or try again with a follow-up →
                    </Link>
                  )}
                  {(thread.conv.status === "REPLIED" || thread.conv.status === "POSITIVE") && (
                    <span className="rounded-md border border-dashed px-3 py-1.5 text-muted-foreground">
                      Respond personally, then record MEETING / WON / LOST on the lead
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
