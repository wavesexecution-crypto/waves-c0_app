const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramMessage {
  chatId: string;
  text: string;
  parseMode?: "HTML" | "Markdown";
}

function requireBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(
      "cafe-leads: TELEGRAM_BOT_TOKEN is not set. Telegram alerts are disabled (loud failure).",
    );
  }
  return token;
}

export function telegramSendUrl(token: string): string {
  return `${TELEGRAM_API}/bot${token}/sendMessage`;
}

/**
 * Sends a real message to a Telegram chat via api.telegram.org.
 * Throws loudly when the bot token is missing or the API errors.
 */
export async function sendTelegramMessage(message: TelegramMessage): Promise<void> {
  const token = requireBotToken();
  const body = {
    chat_id: message.chatId,
    text: message.text,
    parse_mode: message.parseMode ?? "HTML",
  };

  const res = await fetch(telegramSendUrl(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => null)) as
    | { ok: boolean; description?: string }
    | null;

  if (!res.ok || !payload?.ok) {
    throw new Error(
      `cafe-leads: Telegram send failed (${res.status}) — ${payload?.description ?? "unknown error"}`,
    );
  }
}
