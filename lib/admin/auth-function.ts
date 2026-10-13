import "server-only";
/**
 * The site's only caller of the admin-auth Edge Function (supabase/functions/admin-auth/index.ts; specs/supabase.md,
 * "Edge Functions"; specs/product/admin.md, "The admin-auth Edge Function"). The /admin Server Actions use it for the
 * Supabase Auth admin calls: change an email, copy or send a reset link, sign out everywhere, deactivate and
 * reactivate, delete now.
 *
 * Authorization is the admin's own session: the access token is forwarded as the bearer, and the function checks it
 * with Supabase Auth and is_admin() (aal2) before doing anything. The site holds no secret for this function.
 * Getting the token: in a Server Action, `(await supabase.auth.getSession()).data.session?.access_token`. getSession()
 * trusts the cookie unchecked, which is why the rest of the site uses getClaims(); here that's acceptable because the
 * token is only forwarded, and the function verifies it (a forged or stale one gets 401, a non-admin's 403).
 *
 * Nothing here throws: an unconfigured site, a timeout, or a network error comes back as `{ ok: false }`, mapped like
 * lib/invite-function.ts. Server only, and free of static Next.js imports so tests can run it with fake deps
 * (tests/admin-auth-function.test.mts, which also checks that no other module calls the function). The recovery ops
 * need this site's origin for the link's landing page: pass `origin`, or it is read from the request headers.
 */

export type AdminAuthOp = "set_email" | "recovery_link" | "recovery_email" | "sign_out" | "suspend" | "unsuspend" | "purge";

export type AdminAuthResult =
  | { ok: true; link?: string }
  | {
      ok: false;
      reason: "bad_request" | "unauthorized" | "not_admin" | "user_not_found" | "email_taken" | "not_deleted" | "not_configured" | "error";
      detail?: string;
    };

export interface AdminAuthRequest {
  op: AdminAuthOp;
  /** The target account's user id. */
  user: string;
  /** set_email: the new address. */
  email?: string;
  /** suspend: why, free text (required; recorded in admin_log, never in a log line). */
  reason?: string;
  /** set_email: also move pending invitations addressed to the old email to the new one. */
  repointInvitations?: boolean;
  /** recovery_link / recovery_email: this site's origin (https://host); default: from the request headers. */
  origin?: string;
}

type AdminAuthEnv = Record<string, string | undefined>;

export interface AdminAuthDeps {
  env?: AdminAuthEnv;
  fetch?: typeof fetch;
  /** Milliseconds before giving up; 15 s by default (a purge makes several calls). */
  timeoutMs?: number;
  log?: (msg: string) => void;
  /** The request_id sent to the function and written to admin_log; a fresh UUID by default. */
  requestId?: () => string;
  /** This site's origin when the request doesn't name one; default: read from the incoming request's headers. */
  origin?: () => Promise<string | null>;
}

const TIMEOUT_MS = 15_000;

/** Where a recovery link lands: /auth/confirm signs in, then /account/password asks for the new password. */
export const RECOVERY_NEXT = "/account/password";

/** Whether the function can be called here: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY set (no secret is needed). */
export function adminAuthConfigured(env: AdminAuthEnv = process.env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

/** The function's URL for a project URL (trailing slashes tolerated). */
export function adminAuthUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/admin-auth`;
}

/** The recovery link's landing page for this site's origin. */
export function recoveryRedirectTo(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/auth/confirm?next=${encodeURIComponent(RECOVERY_NEXT)}`;
}

const CODES: Record<string, Extract<AdminAuthResult, { ok: false }>["reason"]> = {
  "400:bad_request": "bad_request",
  "401:unauthorized": "unauthorized",
  "403:not_admin": "not_admin",
  "404:user_not_found": "user_not_found",
  "409:email_taken": "email_taken",
  "409:not_deleted": "not_deleted",
};

/** Maps the function's HTTP answer to a result. Exported for tests. */
export function mapAdminAuthResponse(op: AdminAuthOp, status: number, body: unknown): AdminAuthResult {
  const b = (body && typeof body === "object" ? body : {}) as { ok?: unknown; link?: unknown; error?: unknown; detail?: unknown };
  if (status === 200 && b.ok === true) {
    if (op !== "recovery_link") return { ok: true };
    if (typeof b.link === "string" && /^https?:\/\//.test(b.link)) return { ok: true, link: b.link };
    return { ok: false, reason: "error", detail: "admin-auth 200: no link in the response" };
  }
  const code = typeof b.error === "string" ? b.error : "";
  if (status === 400 && code === "email_not_configured") return { ok: false, reason: "not_configured", detail: "email_not_configured" };
  // The gateway answers 401 itself for a bad JWT (no `error` code in our shape): still unauthorized.
  if (status === 401) return { ok: false, reason: "unauthorized" };
  const reason = CODES[`${status}:${code}`];
  if (reason) return typeof b.detail === "string" ? { ok: false, reason, detail: b.detail } : { ok: false, reason };
  // Anything else, including a 404 without our code (the function isn't deployed), is an error.
  const why = typeof b.detail === "string" ? ` (${b.detail})` : "";
  return { ok: false, reason: "error", detail: `admin-auth ${status}: ${code || (status === 200 ? "unexpected body" : "no error code")}${why}` };
}

/** This site's origin from the incoming request (Server Actions send Origin). Null outside a request. */
async function originFromHeaders(): Promise<string | null> {
  try {
    const [{ headers }, { requestOrigin }] = await Promise.all([import("next/headers"), import("../household-hub.ts")]);
    return requestOrigin(await headers());
  } catch {
    return null;
  }
}

/**
 * Asks the admin-auth function to perform `req.op` on `req.user`, as the admin whose session `accessToken` belongs
 * to. Makes its own request_id (sent to the function, which writes it to admin_log). `deps` is for tests.
 */
export async function callAdminAuth(req: AdminAuthRequest, accessToken: string, deps: AdminAuthDeps = {}): Promise<AdminAuthResult> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((msg: string) => console.warn(msg));
  if (!adminAuthConfigured(env)) return { ok: false, reason: "not_configured" };
  if (!accessToken) return { ok: false, reason: "unauthorized" };

  const requestId = (deps.requestId ?? (() => crypto.randomUUID()))();
  const body: Record<string, unknown> = { op: req.op, user: req.user, request_id: requestId };
  if (req.op === "set_email") {
    body.email = req.email ?? "";
    body.repoint_invitations = req.repointInvitations === true;
  }
  if (req.op === "suspend") body.reason = req.reason ?? "";
  if (req.op === "recovery_link" || req.op === "recovery_email") {
    const origin = req.origin ?? (await (deps.origin ?? originFromHeaders)());
    if (!origin) return { ok: false, reason: "bad_request", detail: "no site origin for the recovery link" };
    body.redirect_to = recoveryRedirectTo(origin);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await (deps.fetch ?? fetch)(adminAuthUrl(env.SUPABASE_URL!), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: env.SUPABASE_PUBLISHABLE_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const answer = await res.json().catch(() => null);
    const result = mapAdminAuthResponse(req.op, res.status, answer);
    // Never log the token, the link, an email address, or the reason: the op, the user id, and the request id only.
    if (!result.ok && result.reason === "error") log(`admin-auth: ${req.op} for user ${req.user} (request ${requestId}): ${result.detail}`);
    return result;
  } catch (err) {
    const detail = controller.signal.aborted ? "timed out" : err instanceof Error ? err.message : String(err);
    log(`admin-auth: ${req.op} for user ${req.user} (request ${requestId}) failed (${detail})`);
    return { ok: false, reason: "error", detail };
  } finally {
    clearTimeout(timer);
  }
}
