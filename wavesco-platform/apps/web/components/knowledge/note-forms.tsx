"use client";

import { useActionState } from "react";
import {
  appendKnowledgeNoteAction,
  createKnowledgeNoteAction,
  type KnowledgeState,
} from "@/lib/actions/knowledge";
import { Button, Input } from "@wavesco/ui";

const initial: KnowledgeState = { ok: false };

function ResultLine({ state }: { state: KnowledgeState }) {
  if (state.error) return <p role="alert" className="text-xs font-medium text-destructive">{state.error}</p>;
  if (state.ok && state.message)
    return <p role="status" className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{state.message}</p>;
  return null;
}

export function CreateNoteForm() {
  const [state, formAction, pending] = useActionState(createKnowledgeNoteAction, initial);
  return (
    <form action={formAction} className="space-y-2 rounded-lg border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Create note</p>
      <Input name="path" placeholder="WavesCo/Meetings/2026-08-25 client sync.md" required />
      <textarea
        name="content"
        rows={5}
        required
        placeholder={"---\ntags: [wavesco]\n---\n\n# Title\n\nNotes…"}
        className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Create in Obsidian"}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}

export function AppendNoteForm({ defaultPath }: { defaultPath?: string }) {
  const [state, formAction, pending] = useActionState(appendKnowledgeNoteAction, initial);
  return (
    <form action={formAction} className="space-y-2 rounded-lg border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Append to note</p>
      <Input name="path" defaultValue={defaultPath} placeholder="WavesCo/Clients/Kara Oils.md" required />
      <Input name="heading" placeholder="Heading (optional)" />
      <textarea
        name="content"
        rows={3}
        required
        placeholder="- New fact / decision / lesson…"
        className="w-full rounded-md border bg-background px-3 py-2 text-xs"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Appending…" : "Append"}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}
