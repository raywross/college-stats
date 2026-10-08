/**
 * The invite-user Edge Function's logic, free of Deno globals and of the Supabase client so Node tests can run it with
 * fake dependencies (tests/invite-function.test.mts). index.ts wires the real ones. Read index.ts's header first: it
 * explains what the function is for, its contract, its secrets, and how to deploy, test, and roll it back.
 *
 * Only Web-standard globals are used here (Request, Response, URL, TextEncoder, crypto.subtle), which both Deno and
 * Node provide. No `npm:` imports: tsc type-checks this file through the test that imports it.
 */

/** The columns of a `public.invitations` row this function reads. */
export interface InvitationRow {
  id: string;
  email: string;
  side: "guardian" | "student";
  display_name: string | null;
  phone: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  accepted_by: string | null;
}

export interface AuthUserLite {
  id: string;
  email: string | null;
}

export interface NewUserAttributes {
  email: string;
  email_confirm: true;
  user_metadata: { display_name: string | null; role_hint: "guardian" | "student"; phone: string | null; invitation_id: string };
}

export type CreateUserResult = { ok: true; user: AuthUserLite } | { ok: false; alreadyRegistered: boolean; error: string };

/** Everything the handler touches outside itself. index.ts supplies the real ones; tests supply fakes. */
export interface InviteDeps {
  /** INVITE_FUNCTION_SECRET. Unset or empty → every request is refused with 401. */
  secret: string | undefined;
  /** INVITE_ALLOWED_ORIGINS parsed (see parseAllowedOrigins); null → the development default. */
  allowedOrigins: string[] | null;
  /** The invitation whose token_hash matches, whatever its state (the handler checks pending/unexpired). */
  findInvitationByHash(tokenHash: string): Promise<InvitationRow | null>;
  /** auth.admin.createUser; `alreadyRegistered` when the email already has an account. */
  createUser(attrs: NewUserAttributes): Promise<CreateUserResult>;
  /** auth.admin.getUserById; null when there is no such user. */
  getUserById(id: string): Promise<AuthUserLite | null>;
  /** auth.admin.deleteUser; used only to undo a user this request just created when recording it failed. */
  deleteUser(id: string): Promise<void>;
  /**
   * `update invitations set accepted_by = userId where id = invitationId and accepted_at is null and revoked_at is
   * null and (accepted_by is null or accepted_by = userId)`; true when a row was updated.
   */
  setAcceptedBy(invitationId: string, userId: string): Promise<boolean>;
  /** auth.admin.generateLink for an existing, confirmed user; returns properties.action_link. */
  generateLink(email: string, redirectTo: string): Promise<{ ok: true; link: string } | { ok: false; error: string }>;
  /** Defaults to Date.now. */
  now?: () => number;
  /** Defaults to console.log. Never given the token, the link, or an email address. */
  log?: (msg: string) => void;
}

export const SECRET_HEADER = "x-invite-secret";
const TOKEN_RE = /^[0-9a-f]{64}$/;

function json(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Lowercase hex SHA-256 of the UTF-8 string: the same as Postgres's encode(sha256(convert_to(t, 'UTF8')), 'hex'). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time string comparison: both sides are hashed first, so the comparison always runs over 32 bytes whatever
 * the inputs' lengths, and the loop never exits early.
 */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** INVITE_ALLOWED_ORIGINS ("https://a.example,https://b.example") → origins; unset/blank → null (dev default). */
export function parseAllowedOrigins(value: string | undefined): string[] | null {
  const list = (value ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return list.length ? list : null;
}

/**
 * Whether `redirectTo` may receive a signed-in session. With an allow list, its origin must be one of them exactly.
 * Without one (development), any `https://*.vercel.app` or `http://localhost:*` / `http://127.0.0.1:*`. Supabase Auth
 * also checks its own Redirect URLs list, but this function refuses first so a link is never minted for a stray host.
 */
export function redirectAllowed(redirectTo: string, allowedOrigins: string[] | null): boolean {
  let url: URL;
  try {
    url = new URL(redirectTo);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (allowedOrigins) return allowedOrigins.includes(url.origin);
  if (url.protocol === "https:" && url.hostname.endsWith(".vercel.app") && url.hostname.length > ".vercel.app".length) return true;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;
  return false;
}

/** Supabase Auth's "this email already has an account" (code email_exists; older servers: 422 + message). */
export function isAlreadyRegistered(error: { code?: string | null; status?: number | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  return /already (been )?registered|already exists/i.test(error.message ?? "");
}

/**
 * The service-role key for the admin client: the new-style `SUPABASE_SECRET_KEYS` (a JSON dictionary keyed by key name;
 * "default" preferred, else the first) and, failing that, the legacy `SUPABASE_SERVICE_ROLE_KEY`. Both are injected
 * into every deployed function by Supabase.
 */
export function pickSecretKey(env: { SUPABASE_SECRET_KEYS?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): string | null {
  if (env.SUPABASE_SECRET_KEYS) {
    try {
      const keys = JSON.parse(env.SUPABASE_SECRET_KEYS) as Record<string, unknown>;
      const value = typeof keys.default === "string" ? keys.default : Object.values(keys).find((v) => typeof v === "string");
      if (typeof value === "string" && value) return value;
    } catch {
      // fall through to the legacy key
    }
  }
  return env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/** Whether an invitation can still be used: not accepted, not revoked, not expired. */
export function invitationPending(row: InvitationRow, now: number): boolean {
  return row.accepted_at === null && row.revoked_at === null && Date.parse(row.expires_at) > now;
}

/**
 * Handles one request. Responses: 200 { link } · 400 bad_request · 401 unauthorized · 404 invitation_not_found ·
 * 405 method_not_allowed · 409 already_registered · 500 internal_error.
 */
export async function handleInvite(request: Request, deps: InviteDeps): Promise<Response> {
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const now = deps.now ?? Date.now;

  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  // 1. The site's shared secret. Unset on the function → refuse everything.
  const given = request.headers.get(SECRET_HEADER) ?? "";
  if (!deps.secret || !(await timingSafeEqualStrings(given, deps.secret))) {
    log("invite-user: refused a request without the right X-Invite-Secret");
    return json(401, { error: "unauthorized" });
  }

  // 2. The body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const { token, redirectTo } = (body ?? {}) as { token?: unknown; redirectTo?: unknown };
  if (typeof token !== "string" || !TOKEN_RE.test(token) || typeof redirectTo !== "string" || redirectTo.length > 2048) {
    return json(400, { error: "bad_request" });
  }
  if (!redirectAllowed(redirectTo, deps.allowedOrigins)) {
    log("invite-user: refused a redirectTo outside the allowed origins");
    return json(400, { error: "bad_request" });
  }

  try {
    // 3. The pending, unexpired invitation for that token.
    const invitation = await deps.findInvitationByHash(await sha256Hex(token));
    if (!invitation || !invitationPending(invitation, now())) return json(404, { error: "invitation_not_found" });

    // 4. The account: create it (email already confirmed), or reuse the one this function created for this invitation
    //    on an earlier call (Copy link / a retry), which is recorded in invitations.accepted_by.
    const created = await deps.createUser({
      email: invitation.email,
      email_confirm: true,
      user_metadata: {
        display_name: invitation.display_name,
        role_hint: invitation.side === "guardian" ? "guardian" : "student",
        phone: invitation.phone,
        invitation_id: invitation.id,
      },
    });
    let userId: string;
    if (created.ok) {
      userId = created.user.id;
      if (!(await deps.setAcceptedBy(invitation.id, userId))) {
        // Revoked or accepted in the meantime: don't leave an account behind that nothing points to.
        await deps.deleteUser(userId).catch(() => undefined);
        log(`invite-user: invitation ${invitation.id} changed while creating its account; undone`);
        return json(404, { error: "invitation_not_found" });
      }
      log(`invite-user: created the account for invitation ${invitation.id}`);
    } else if (created.alreadyRegistered) {
      const ours = invitation.accepted_by ? await deps.getUserById(invitation.accepted_by) : null;
      if (!ours || (ours.email ?? "").toLowerCase() !== invitation.email.toLowerCase()) {
        log(`invite-user: invitation ${invitation.id} is for an address that already has an account`);
        return json(409, { error: "already_registered" });
      }
      userId = ours.id;
      log(`invite-user: reusing the account created earlier for invitation ${invitation.id}`);
    } else {
      log(`invite-user: createUser failed for invitation ${invitation.id}: ${created.error}`);
      return json(500, { error: "internal_error" });
    }

    // 5. A link that signs that user in and lands on redirectTo.
    const link = await deps.generateLink(invitation.email, redirectTo);
    if (!link.ok) {
      log(`invite-user: generateLink failed for invitation ${invitation.id} (user ${userId}): ${link.error}`);
      return json(500, { error: "internal_error" });
    }
    return json(200, { link: link.link });
  } catch (err) {
    log(`invite-user: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: "internal_error" });
  }
}
