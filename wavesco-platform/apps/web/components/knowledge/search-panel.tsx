"use client";

import { useActionState } from "react";
import Link from "next/link";
import { searchKnowledgeAction, type KnowledgeState } from "@/lib/actions/knowledge";
import { Button, Input } from "@wavesco/ui";

type SearchState = KnowledgeState & { hits?: { filename: string; context?: string }[] };

const initialState: SearchState = { ok: false };

export function KnowledgeSearch() {
  const [state, formAction, pending] = useActionState(searchKnowledgeAction, initialState);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap gap-2">
        <Input name="query" placeholder="Search titles & content…" className="max-w-sm" required />
        <select
          name="mode"
          className="rounded-md border bg-background px-2 text-sm"
          defaultValue="text"
        >
          <option value="text">Text</option>
          <option value="tag">Tag (#…)</option>
        </select>
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>

      {state.error ? <p className="text-sm font-medium text-destructive">{state.error}</p> : null}

      {state.hits ? (
        state.hits.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No matching notes.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {state.hits.map((h) => (
              <li key={h.filename} className="px-4 py-2 text-sm">
                <Link href={`/knowledge?note=${encodeURIComponent(h.filename)}`} className="font-medium hover:underline">
                  {h.filename}
                </Link>
                {h.context ? <p className="line-clamp-2 text-xs text-muted-foreground">{h.context}</p> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
