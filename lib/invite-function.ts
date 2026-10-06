import "server-only";
/**
 * The site's only caller of the invite-user Edge Function (supabase/functions/invite-user/index.ts; specs/supabase.md,
 * "Edge Functions"; specs/product/household-hub.md, "The Edge Function"). Given a pending invitation's token, the
 * function creates the invited person's account (email already confirmed) and returns a one-time link that signs them
 * in at `redirectTo`, where they choose a password.
 *
 * Nothing here throws: an unconfigured function, a timeout, or a network error comes back as `{ ok: false }`, and the
 * caller falls back to the plain /invite/<token> link (the invitation exists either way, and "Send again" retries).
 * Server only (holds INVITE_FUNCTION_SECRET) but free of Next.js imports, so tests can run it with fake deps.
 * tests/invite-function.test.mts also checks that no other module in app/, lib/, or components/ calls the function.
 */

export type InviteUserResult =
  | { ok: true; link: string }
  | { ok: false; reason: "already_registered" | "not_found" | "not_configured" | "error"; detail?: string };

type InviteEnv = Record<string, string | undefined>;

export interface InviteUserDeps {
  env?: InviteEnv;
  fetch?: typeof fetch;
  /** Milliseconds before giving up; 10 s by default. */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

const TIMEOUT_MS = 10_000;

/** Whether the function can be called here: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and INVITE_FUNCTION_SECRET set. */
export function inviteFunctionConfigured(env: InviteEnv = process.env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.INVITE_FUNCTION_SECRET);
}

/** The function's URL for a project URL (trailing slashes tolerated). */
export function inviteFunctionUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/invite-user`;
}

/** Maps the function's HTTP answer to a result. Exported for tests. */
export function mapInviteResponse(status: number, body: unknown): InviteUserResult {
  const b = (body && typeof body === "object" ? body : {}) as { link?: unknown; error?: unknown };
  if (status === 200 && typeof b.link === "string" && /^https?:\/\//.test(b.link)) return { ok: true, link: b.link };
  if (status === 409) return { ok: false, reason: "already_registered" };
  if (status === 404 && b.error === "invitation_not_found") return { ok: false, reason: "not_found" };
  const code = typeof b.error === "string" ? b.error : status === 200 ? "no link in the response" : "no error code";
  return { ok: false, reason: "error", detail: `invite-user ${status}: ${code}` };
}

/**
 * Asks the Edge Function for a sign-in link for the invitation holding `token`. `redirectTo` is where the link lands
 * (an /auth/confirm URL on this site; the function only accepts allowed origins). `deps` is for tests.
 */
export async function inviteUser(
  { token, redirectTo }: { token: string; redirectTo: string },
  deps: InviteUserDeps = {},
): Promise<InviteUserResult> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((msg: string) => console.warn(msg));
  if (!inviteFunctionConfigured(env)) return { ok: false, reason: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await (deps.fetch ?? fetch)(inviteFunctionUrl(env.SUPABASE_URL!), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
        apikey: env.SUPABASE_PUBLISHABLE_KEY!,
        "X-Invite-Secret": env.INVITE_FUNCTION_SECRET!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token, redirectTo }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    const result = mapInviteResponse(res.status, body);
    // Never log the token or the link.
    if (!result.ok && result.reason === "error") log(`invite-function: ${result.detail}`);
    return result;
  } catch (err) {
    const detail = controller.signal.aborted ? "timed out" : err instanceof Error ? err.message : String(err);
    log(`invite-function: request failed (${detail})`);
    return { ok: false, reason: "error", detail };
  } finally {
    clearTimeout(timer);
  }
}
