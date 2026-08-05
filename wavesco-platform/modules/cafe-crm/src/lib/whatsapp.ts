function requireWhatsAppConfig(): { apiKey: string; apiUrl: string } {
  const apiKey = process.env.WHATSAPP_API_KEY;
  const apiUrl = process.env.WHATSAPP_API_URL;
  if (!apiKey || !apiUrl) {
    throw new Error(
      "cafe-crm: WHATSAPP_API_KEY / WHATSAPP_API_URL are not set. Re-engagement messages are unavailable (loud failure).",
    );
  }
  return { apiKey, apiUrl };
}

/**
 * Sends a real WhatsApp message through the configured provider API.
 * Throws loudly when config is missing or the provider errors.
 */
export async function sendWhatsAppMessage(phone: string, message: string): Promise<void> {
  const { apiKey, apiUrl } = requireWhatsAppConfig();

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      to: phone,
      type: "text",
      text: { body: message },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`cafe-crm: WhatsApp send failed (${res.status}) — ${detail}`);
  }
}
