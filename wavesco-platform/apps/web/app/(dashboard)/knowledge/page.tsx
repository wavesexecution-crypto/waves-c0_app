import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { obsidianProbe } from "@/lib/wavesco/obsidian";
import { listKnowledgeFolderAction, readKnowledgeNoteAction } from "@/lib/actions/knowledge";
import { KnowledgeSearch } from "@/components/knowledge/search-panel";
import { AppendNoteForm, CreateNoteForm } from "@/components/knowledge/note-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Knowledge · WavesCo" };

interface PageProps {
  searchParams: Promise<{ dir?: string; note?: string }>;
}

export default async function KnowledgePage({ searchParams }: PageProps) {
  const session = await auth();
  requireTenantId(session);
  const { dir = "", note = "" } = await searchParams;

  const probe = await obsidianProbe();
  const listing = probe.reachable ? await listKnowledgeFolderAction(dir) : { ok: false as const };
  const currentNote = note ? await readKnowledgeNoteAction(note) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
          <p className="text-sm text-muted-foreground">
            The persistent human knowledge layer — the live Obsidian vault. Useful knowledge only;
            raw automation events stay in their systems.
          </p>
        </div>
        <div
          className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wide ${
            !probe.configured || !probe.reachable
              ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          }`}
        >
          Obsidian {probe.configured ? (probe.reachable ? "connected" : "disconnected") : "not configured"}
        </div>
      </div>

      {!probe.reachable ? (
        <div className="rounded-lg border border-dashed border-red-500/40 p-4 text-sm">
          <p className="font-medium">Obsidian vault unreachable</p>
          <p className="text-muted-foreground">{probe.detail}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep Obsidian running with the Local REST API plugin enabled; set OBSIDIAN_REST_URL and
            OBSIDIAN_API_KEY server-side. Nothing here is faked while it is offline.
          </p>
        </div>
      ) : (
        <>
          <KnowledgeSearch />

          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            {/* Folder browser */}
            <section className="space-y-2 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Vault</h2>
                {dir ? (
                  <Link href="/knowledge" className="text-xs text-muted-foreground hover:underline">
                    ← root
                  </Link>
                ) : null}
              </div>
              <p className="font-mono text-xs text-muted-foreground">{dir || "/"}</p>
              {"entries" in listing && listing.entries ? (
                <ul className="space-y-0.5 text-sm">
                  {listing.entries.map((e) => (
                    <li key={e.path}>
                      {e.isDir ? (
                        <Link
                          href={`/knowledge?dir=${encodeURIComponent(e.path)}`}
                          className="block rounded px-2 py-1 hover:bg-accent"
                        >
                          📁 {e.name}
                        </Link>
                      ) : (
                        <Link
                          href={`/knowledge?dir=${encodeURIComponent(dir)}&note=${encodeURIComponent(e.path)}`}
                          className="block rounded px-2 py-1 hover:bg-accent"
                        >
                          📄 {e.name.replace(/\.md$/, "")}
                        </Link>
                      )}
                    </li>
                  ))}
                  {listing.entries.length === 0 ? (
                    <li className="px-2 py-1 text-xs text-muted-foreground">Empty folder.</li>
                  ) : null}
                </ul>
              ) : (
                <p className="text-xs text-destructive">{"error" in listing && listing.error ? listing.error : "Could not list folder."}</p>
              )}
            </section>

            {/* Note viewer + editors */}
            <div className="space-y-4">
              {currentNote?.ok && currentNote.content !== undefined ? (
                <article className="space-y-2 rounded-lg border bg-card p-4">
                  <h2 className="truncate font-mono text-sm font-semibold">{note}</h2>
                  <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
                    {currentNote.content}
                  </pre>
                </article>
              ) : currentNote && !currentNote.ok ? (
                <p className="text-sm font-medium text-destructive">{currentNote.error}</p>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Select a note to read it. Search above to find anything across the vault.
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <CreateNoteForm />
                <AppendNoteForm defaultPath={note || undefined} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
