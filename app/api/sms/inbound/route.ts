import type { NextRequest } from "next/server";
import { supabaseClient } from "@/lib/supabase";
import { handleInbound, smsConfigured, validTwilioSignature } from "@/lib/sms";
import { trackServer } from "@/lib/analytics-server";

/**
 * Twilio's inbound-message webhook (specs/planner/timeline.md "Texts"): the number's "A message comes in" URL points
 * here (POST, form-encoded). A STOP reply (or Twilio's OptOutType=STOP) sets provider_opt_out_at on every active
 * consent for that phone, and nothing more is sent to it. START isn't a consent: texts come back only when someone
 * turns them on in the plan again. HELP is answered by Twilio's own reply. When SMS_PROVIDER_TOKEN is set, the
 * request must carry a valid X-Twilio-Signature, else 403.
 *
 * Responds with empty TwiML (no reply of our own: Twilio's opt-out replies carry the wording carriers require).
 */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200) {
  return new Response(EMPTY_TWIML, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return twiml(400);
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;

  const token = process.env.SMS_PROVIDER_TOKEN;
  if (token && !validTwilioSignature(webhookUrl(request), params, request.headers.get("x-twilio-signature"), token)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!smsConfigured()) return twiml();

  const { action, from } = handleInbound(params);
  if (action !== "stop" || !from) return twiml();

  const client = supabaseClient("publish");
  const { data, error } = await client
    .from("sms_consents")
    .update({ provider_opt_out_at: new Date().toISOString() })
    .eq("phone", from)
    .is("revoked_at", null)
    .is("provider_opt_out_at", null)
    .select("id");
  if (error) {
    console.error(`sms inbound: recording STOP failed: ${error.message}`);
    return twiml(500);
  }
  if (data?.length) await trackServer("plan_text_opted_out", { via: "stop" });
  return twiml();
}

/** The URL Twilio signed: the public one (Vercel forwards the host and protocol). */
function webhookUrl(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  return `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`;
}
