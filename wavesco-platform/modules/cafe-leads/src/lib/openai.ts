const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

export interface LeadEnrichment {
  category: string;
  priority: string;
  summary: string;
  suggestedReply: string;
}

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "cafe-leads: OPENAI_API_KEY is not set. AI enrichment is unavailable (loud failure).",
    );
  }
  return key;
}

/**
 * Real OpenAI call (gpt-4o-mini) that classifies an inbound lead and
 * drafts a suggested reply. Throws loudly when the key is missing or the
 * API returns an error.
 */
export async function enrichLead(message: string): Promise<LeadEnrichment> {
  const apiKey = requireApiKey();

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You classify cafe leads. Return strict JSON: {category, priority, summary, suggestedReply}. priority one of LOW|MEDIUM|HIGH.",
        },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`cafe-leads: OpenAI request failed (${res.status}) — ${detail}`);
  }

  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("cafe-leads: OpenAI returned no content.");
  }

  const parsed = JSON.parse(content) as Partial<LeadEnrichment>;
  return {
    category: parsed.category ?? "general",
    priority: parsed.priority ?? "LOW",
    summary: parsed.summary ?? message.slice(0, 120),
    suggestedReply: parsed.suggestedReply ?? "",
  };
}
