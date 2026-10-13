import { SITE_NAME } from "@/lib/brand";

/** The small confirmation page the visit-alert links answer with, in the same frame as the other unsubscribe routes. */
export function unsubscribePage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} – ${SITE_NAME}</title></head>
<body style="margin:0;padding:40px 20px;background:#faf8f4;color:#1c1830;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border:1px solid #e7e2d8;border-radius:16px;padding:28px;text-align:center;">
${body}
</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
