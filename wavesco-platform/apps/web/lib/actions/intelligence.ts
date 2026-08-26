"use server";

import { z } from "zod";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { buildCompanyContext } from "@/lib/wavesco/ai-context";
import { searchSimple } from "@/lib/wavesco/obsidian";
import { wavesAi } from "@/lib/ai/gateway";

async function requireUser(): Promise<{ tenantId: string; userId: string; role: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}

export interface InsightResult {
  ok: boolean;
  text?: string;
  model?: string;
  error?: string;
  contextSent?: string;
}

const schema = z.object({
  prompt: z.string().min(10).max(6000),
  includeData: z.string().optional(),
  topic: z.string().max(120).optional(),
});

function formStr(formData: FormData, name: string): string | undefined {
  const v = formData.get(name);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Analyst insight via the Waves AI Gateway (provider-agnostic; the
 * workspace's ClientAiConfig decides provider/model). With "include
 * company data" the operator gets a compact REAL context block (lead
 * corpus + platform state + system health) and, when a topic is given,
 * snippets from matching Obsidian notes. Nothing is fabricated:
 * unavailable sources are labelled UNAVAILABLE.
 */
export async function generateAiInsightAction(
  _prev: InsightResult,
  formData: FormData,
): Promise<InsightResult> {
  const user = await requireUser();

  const parsed = schema.safeParse({
    prompt: formData.get("prompt"),
    includeData: formData.get("includeData"),
    topic: formStr(formData, "topic"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Provide a question (10–6000 chars)." };
  }

  const blocks: string[] = [];
  let contextSent = "";

  if (parsed.data.includeData === "on") {
    try {
      blocks.push(await buildCompanyContext(user.tenantId));
    } catch {
      blocks.push("[company context] UNAVAILABLE");
    }
  }

  if (parsed.data.topic && parsed.data.topic.trim().length > 1) {
    const res = await searchSimple(parsed.data.topic.trim(), 160);
    const hits = res.ok ? (res.data ?? []) : [];
    if (hits.length > 0) {
      const noteParts: string[] = [];
      for (const hit of hits.slice(0, 3)) {
        noteParts.push(`- ${hit.filename}${hit.matches?.[0]?.context ? `: “${hit.matches[0].context.trim()}”` : ""}`);
      }
      blocks.push(`[Obsidian knowledge · topic "${parsed.data.topic}"]\n${noteParts.join("\n")}`);
    }
  }

  contextSent = blocks.join("\n\n");
  const prompt = contextSent
    ? `COMPANY CONTEXT (real data):\n${contextSent}\n\nQUESTION:\n${parsed.data.prompt}`
    : parsed.data.prompt;

  const result = await wavesAi({
    tenantId: user.tenantId,
    operation: "analyze",
    input: {
      system:
        "You are an analyst inside the WavesCo operator console. WavesCo is a business-acquisition and operations company; its app is a control plane over real systems (Lead Engine SQLite corpus, n8n automations, SMTP outbox via n8n, Telegram Notify Hub, Obsidian vault). Answer using ONLY the data provided in the user's message; if a source is UNAVAILABLE or missing, say so explicitly. Never invent numbers.",
      prompt,
      temperature: 0.3,
    },
  });

  if (!result.ok) {
    return { ok: false, error: result.error ?? `AI ${result.status}` };
  }
  return {
    ok: true,
    text: result.text,
    model: result.model,
    contextSent: contextSent || undefined,
  };
}
