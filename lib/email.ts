/**
 * Sending email (invitations, update digests). A provider seam: with RESEND_API_KEY and EMAIL_FROM set it sends
 * through Resend's HTTP API (plain fetch, no SDK); otherwise it sends nothing and says so. Nothing here throws, so
 * an unset or failing provider never breaks a page or an action: callers show the link on screen either way
 * (specs/product/accounts.md, "Email").
 *
 * Magic links don't come through here: Supabase Auth sends them with its own mailer until the sending domain is
 * set up (then Supabase can be pointed at Resend's SMTP). Server only (reads secrets), but deliberately free of
 * Next.js imports so tests can run it.
 */

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text alternative; always send one. */
  text: string;
  /** Extra headers, e.g. List-Unsubscribe / List-Unsubscribe-Post for digests. */
  headers?: Record<string, string>;
}

export type SendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not-configured" }
  | { sent: false; reason: "error"; error: string };

/** RESEND_API_KEY and EMAIL_FROM (process.env by default). */
type EmailEnv = Record<string, string | undefined>;

const RESEND_URL = "https://api.resend.com/emails";

/** Whether email can be sent here (RESEND_API_KEY and EMAIL_FROM are both set). */
export function emailConfigured(env: EmailEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/**
 * Sends one email, or doesn't when unconfigured (`{ sent: false, reason: "not-configured" }`, logged). Provider
 * failures come back as `{ sent: false, reason: "error" }`, never thrown. `deps` is for tests.
 */
export async function sendEmail(
  message: EmailMessage,
  deps: { env?: EmailEnv; fetch?: typeof fetch; log?: (msg: string) => void } = {},
): Promise<SendResult> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((msg: string) => console.info(msg));
  const to = Array.isArray(message.to) ? message.to : [message.to];
  if (!emailConfigured(env)) {
    log(`email: not configured (RESEND_API_KEY/EMAIL_FROM unset); not sending "${message.subject}" to ${to.length} recipient(s).`);
    return { sent: false, reason: "not-configured" };
  }
  try {
    const res = await (deps.fetch ?? fetch)(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.headers && Object.keys(message.headers).length ? { headers: message.headers } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = `Resend ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`;
      log(`email: sending "${message.subject}" failed (${error}).`);
      return { sent: false, reason: "error", error };
    }
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: body?.id ?? null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`email: sending "${message.subject}" failed (${error}).`);
    return { sent: false, reason: "error", error };
  }
}
