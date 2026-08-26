"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  appendNote,
  listVaultDir,
  putNote,
  readNote,
  searchSimple,
  searchTag,
} from "@/lib/wavesco/obsidian";

async function requireUser(): Promise<{ tenantId: string; userId: string; role: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}

export interface KnowledgeState {
  ok: boolean;
  error?: string;
  message?: string;
}

const VAULT_ROOTS = ["WavesCo", "Personal"] as const;

/** Guards note paths to the curated knowledge trees; blocks traversal. */
function safePath(input: string): string | null {
  const normalized = input.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.includes("..")) return null;
  const root = normalized.split("/")[0] ?? "";
  return root.length > 0 && (VAULT_ROOTS as readonly string[]).includes(root) ? normalized : null;
}

export async function listKnowledgeFolderAction(
  dirPath: string,
): Promise<KnowledgeState & { entries?: { name: string; path: string; isDir: boolean }[] }> {
  await requireUser();
  const target = dirPath === "" ? "" : safePath(dirPath);
  if (target === null) return { ok: false, error: "Path outside the knowledge roots." };
  const res = await listVaultDir(target);
  if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  const prefix = target ? `${target}/` : "";
  const entries = (res.data ?? [])
    .filter((full) => full.startsWith(prefix))
    .map((full) => ({
      path: full.replace(/\/$/, ""),
      name: full.slice(prefix.length).replace(/\/$/, ""),
      isDir: full.endsWith("/"),
    }));
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return { ok: true, entries };
}

export async function readKnowledgeNoteAction(notePath: string): Promise<KnowledgeState & { content?: string }> {
  await requireUser();
  const p = safePath(notePath);
  if (!p) return { ok: false, error: "Path outside the knowledge roots." };
  const res = await readNote(p);
  if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  return { ok: true, content: res.data ?? "" };
}

const searchSchema = z.object({ query: z.string().min(1).max(200), tag: z.boolean().optional() });

export async function searchKnowledgeAction(
  _prev: KnowledgeState & { hits?: { filename: string; context?: string }[] },
  formData: FormData,
): Promise<KnowledgeState & { hits?: { filename: string; context?: string }[] }> {
  await requireUser();
  const parsed = searchSchema.safeParse({
    query: formData.get("query"),
    tag: formData.get("mode") === "tag",
  });
  if (!parsed.success) return { ok: false, error: "Enter a search term." };

  const res = parsed.data.tag
    ? await searchTag(parsed.data.query.replace(/^#/, ""))
    : await searchSimple(parsed.data.query);

  if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  const hits = (res.data ?? []).map((h) => ({
    filename: h.filename,
    context:
      h.matches && h.matches.length > 0
        ? h.matches
            .map((m) => m.context)
            .join(" … ")
            .slice(0, 240)
        : undefined,
  }));
  return { ok: true, hits };
}

const createSchema = z.object({
  path: z.string().min(3).max(300),
  content: z.string().min(1).max(60_000),
});

export async function createKnowledgeNoteAction(
  _prev: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "knowledge")) {
    return { ok: false, error: "Admin role required to create notes." };
  }
  const parsed = createSchema.safeParse({ path: formData.get("path"), content: formData.get("content") });
  if (!parsed.success) return { ok: false, error: "A vault path and content are required." };
  const p = safePath(parsed.data.path.endsWith(".md") ? parsed.data.path : `${parsed.data.path}.md`);
  if (!p) return { ok: false, error: "Notes must live under WavesCo/ or Personal/." };

  const res = await putNote(p, parsed.data.content);
  if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  revalidatePath("/knowledge");
  return { ok: true, message: `Saved ${p} to Obsidian.` };
}

function formStr(formData: FormData, name: string): string | undefined {
  const v = formData.get(name);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const appendSchema = z.object({
  path: z.string().min(3).max(300),
  content: z.string().min(1).max(20_000),
  heading: z.string().max(120).optional(),
});

export async function appendKnowledgeNoteAction(
  _prev: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "knowledge")) {
    return { ok: false, error: "Admin role required to append notes." };
  }
  const parsed = appendSchema.safeParse({
    path: formData.get("path"),
    content: formData.get("content"),
    heading: formStr(formData, "heading"),
  });
  if (!parsed.success) return { ok: false, error: "Target note and content are required." };
  const p = safePath(parsed.data.path);
  if (!p) return { ok: false, error: "Path outside the knowledge roots." };

  const check = await readNote(p);
  if (!check.ok) return { ok: false, error: "Target note does not exist (create it first)." };

  const res = await appendNote(p, `\n${parsed.data.content}\n`, parsed.data.heading);
  if (!res.ok) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  revalidatePath("/knowledge");
  return { ok: true, message: `Appended to ${p}.` };
}
