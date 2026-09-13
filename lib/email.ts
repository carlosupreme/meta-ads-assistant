export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.REPORTS_FROM_EMAIL);
}

/** Sends one email through the Resend REST API and returns its id. */
export async function sendEmail(message: { to: string[]; subject: string; html: string; idempotencyKey?: string }): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORTS_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Falta RESEND_API_KEY o REPORTS_FROM_EMAIL en el servidor.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(message.idempotencyKey && { "Idempotency-Key": message.idempotencyKey }),
    },
    body: JSON.stringify({ from, to: message.to, subject: message.subject, html: message.html }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok || !body.id) throw new Error(`Resend: ${body.message ?? response.statusText}`);
  return body.id;
}
