/**
 * The admin-auth Edge Function's logic, free of Deno globals and of the Supabase client so Node tests can run it with
 * fake dependencies (tests/admin-auth-function.test.mts). index.ts wires the real ones. Read index.ts's header first:
 * it explains what the function is for, its contract, its secrets, and how to deploy, test, and roll it back.
 *
 * Only Web-standard globals are used here (Request, Response, URL). No `npm:` imports: tsc type-checks this file
 * through the test that imports it. The helpers shared with invite-user come from its handler (pure too).
 */
import { isAlreadyRegistered, redirectAllowed } from "../invite-user/handler.ts";
import { planPurgeForUser, type PurgeUserRows } from "../_shared/purge-plan.ts";

export { isAlreadyRegistered, parseAllowedOrigins, pickSecretKey } from "../invite-user/handler.ts";

/** The seven operations, and nothing else (specs/product/admin.md, "The admin-auth Edge Function"). */
export const ADMIN_AUTH_OPS = ["set_email", "recovery_link", "recovery_email", "sign_out", "suspend", "unsuspend", "purge"] as const;
export type AdminAuthOp = (typeof ADMIN_AUTH_OPS)[number];

/** The admin_log `action` each op writes through admin_note_auth_action() (the brief's log vocabulary). */
export const OP_ACTION: Record<AdminAuthOp, string> = {
  set_email: "auth.email",
  recovery_link: "auth.recovery",
  recovery_email: "auth.recovery",
  sign_out: "auth.sign_out",
  suspend: "account.suspend",
  unsuspend: "account.unsuspend",
  purge: "account.purge",
};

/** A Supabase Auth ban of about 100 years: `ban_duration` takes a Go duration, and hours are its largest unit. */
export const BAN_DURATION = "876000h";
/** `ban_duration: "none"` lifts a ban. */
export const UNBAN = "none";
/** Where a recovery link must land: /auth/confirm, which signs in and moves on to /account/password. */
export const RECOVERY_PATH = "/auth/confirm";

export const MAX_REASON = 500;
const MAX_EMAIL = 254;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TargetUser {
  id: string;
  email: string | null;
}

export type AuthCallResult = { ok: true } | { ok: false; error: string };

/** Everything the handler touches outside itself. index.ts supplies the real ones; tests supply fakes. */
export interface AdminAuthDeps {
  /**
   * The caller's user id from their access token, checked by Supabase Auth (`auth.getUser(token)` on a client built
   * with the publishable key); null when the token is missing, expired, or forged.
   */
  callerId(token: string): Promise<string | null>;
  /**
   * `select is_admin()` through PostgREST as the caller (publishable key + the caller's Authorization header), so the
   * database decides: an unrevoked admins row and an aal2 session. False for anyone else, an aal1 admin included.
   */
  callerIsAdmin(token: string): Promise<boolean>;

  /** auth.admin.getUserById; null when there is no such user. */
  getUser(id: string): Promise<TargetUser | null>;
  /** auth.admin.updateUserById(id, { email, email_confirm: true }); `emailTaken` when another account has it. */
  updateEmail(id: string, email: string): Promise<{ ok: true } | { ok: false; emailTaken: boolean; error: string }>;
  /** `update invitations set email = new where email = old and not accepted and not revoked`; the rows changed. */
  repointInvitations(oldEmail: string, newEmail: string): Promise<number>;
  /** auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } }) → properties.action_link. */
  generateRecoveryLink(email: string, redirectTo: string): Promise<{ ok: true; link: string } | { ok: false; error: string }>;
  /** Whether an email provider is set up (ADMIN_AUTH_SEND_EMAIL); without one, recovery_email is refused with 400. */
  emailConfigured: boolean;
  /** auth.resetPasswordForEmail(email, { redirectTo }): Supabase sends the reset email. */
  sendRecoveryEmail(email: string, redirectTo: string): Promise<AuthCallResult>;
  /** public.auth_end_sessions(user): deletes the user's auth.sessions rows (refresh tokens cascade); the rows deleted. */
  endSessions(id: string): Promise<number>;
  /** auth.admin.updateUserById(id, { ban_duration }): BAN_DURATION to ban, UNBAN to lift it. */
  setBan(id: string, duration: string): Promise<AuthCallResult>;
  /** profiles.suspended_at / suspended_reason for the user (an upsert on the profile row); null clears both. */
  setSuspended(id: string, value: { at: string; reason: string } | null): Promise<void>;
  /** The rows planPurgeForUser() reads for one account (see PurgeUserRows). */
  readPurgeRows(id: string): Promise<PurgeUserRows>;
  /** Deletes these student records / households by id (service role). */
  deleteStudents(ids: string[]): Promise<void>;
  deleteHouseholds(ids: string[]): Promise<void>;
  /** auth.admin.deleteUser(id): the profile, memberships, and access-log rows cascade. */
  deleteUser(id: string): Promise<AuthCallResult>;
  /**
   * public.admin_note_auth_action(p_admin, p_action, p_target, p_details, p_request_id), service role: the admin_log
   * row for an op that succeeded. `details` is the one place an email (auth.email: old and new) or a reason
   * (account.suspend) may go; never a link.
   */
  noteAction(note: { admin: string; action: string; target: string; details: Record<string, unknown>; requestId: string }): Promise<void>;

  /** INVITE_ALLOWED_ORIGINS parsed (the site's origins); null → the development default (see redirectAllowed). */
  allowedOrigins: string[] | null;
  /** Defaults to Date.now. */
  now?: () => number;
  /** Defaults to console.log. Every line passes through scrub() first; still, only ids and op names are given to it. */
  log?: (msg: string) => void;
}

export interface AdminAuthRequest {
  op: AdminAuthOp;
  user: string;
  requestId: string;
  email?: string;
  reason?: string;
  repointInvitations: boolean;
  redirectTo?: string;
}

type Body = Record<string, unknown>;

function json(status: number, body: Body): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const bad = (detail: string) => json(400, { error: "bad_request", detail });

/** Replaces anything that looks like an email address or a URL, so a log line can't carry one by accident. */
export function scrub(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, "<url>").replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g, "<email>");
}

/** The bearer token in an Authorization header, or null. */
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

/** Whether a recovery link may land at `redirectTo`: an allowed site origin (as for invitations) and /auth/confirm. */
export function recoveryRedirectAllowed(redirectTo: string, allowedOrigins: string[] | null): boolean {
  if (!redirectAllowed(redirectTo, allowedOrigins)) return false;
  return new URL(redirectTo).pathname === RECOVERY_PATH;
}

/** Validates the JSON body. A string is the 400's `detail` (never echoes a submitted value). */
export function parseBody(body: unknown, allowedOrigins: string[] | null): AdminAuthRequest | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body must be a JSON object";
  const b = body as Body;
  if (typeof b.op !== "string" || !(ADMIN_AUTH_OPS as readonly string[]).includes(b.op)) return "unknown op";
  const op = b.op as AdminAuthOp;
  if (typeof b.user !== "string" || !UUID_RE.test(b.user)) return "user must be a uuid";
  if (typeof b.request_id !== "string" || !UUID_RE.test(b.request_id)) return "request_id must be a uuid";
  const out: AdminAuthRequest = { op, user: b.user.toLowerCase(), requestId: b.request_id.toLowerCase(), repointInvitations: false };

  if (op === "set_email") {
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return "email must be a valid address";
    out.email = email;
    if (b.repoint_invitations !== undefined && typeof b.repoint_invitations !== "boolean") return "repoint_invitations must be true or false";
    out.repointInvitations = b.repoint_invitations === true;
  }
  if (op === "recovery_link" || op === "recovery_email") {
    if (typeof b.redirect_to !== "string" || b.redirect_to.length > 2048 || !recoveryRedirectAllowed(b.redirect_to, allowedOrigins)) {
      return "redirect_to must be this site's /auth/confirm";
    }
    out.redirectTo = b.redirect_to;
  }
  if (op === "suspend") {
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (!reason) return "a reason is required";
    if (reason.length > MAX_REASON) return `the reason is longer than ${MAX_REASON} characters`;
    out.reason = reason;
  }
  return out;
}

/**
 * Handles one request. Responses: 200 { ok: true, link? } · 400 bad_request (with a `detail`) or email_not_configured ·
 * 401 unauthorized · 403 not_admin · 404 user_not_found · 405 method_not_allowed · 409 email_taken or not_deleted ·
 * 500 internal_error.
 */
export async function handleAdminAuth(request: Request, deps: AdminAuthDeps): Promise<Response> {
  const raw = deps.log ?? ((msg: string) => console.log(msg));
  const log = (msg: string) => raw(scrub(msg));
  const now = deps.now ?? Date.now;

  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  // 1. Who is calling. The gateway (verify_jwt = true) already refused a request without a valid JWT; this checks it
  //    again with Supabase Auth, so the function is safe even if it is ever deployed with --no-verify-jwt.
  const token = bearer(request.headers.get("authorization"));
  let admin: string;
  try {
    const caller = token ? await deps.callerId(token) : null;
    if (!token || !caller) {
      log("admin-auth: refused a request without a valid session token");
      return json(401, { error: "unauthorized" });
    }
    // 2. Whether they are an admin right now, at aal2, as the database sees it.
    if (!(await deps.callerIsAdmin(token))) {
      log(`admin-auth: refused user ${caller}: not an admin with a second factor`);
      return json(403, { error: "not_admin" });
    }
    admin = caller.toLowerCase();
  } catch (err) {
    log(`admin-auth: checking the caller failed: ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: "internal_error" });
  }

  // 3. The body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("body must be JSON");
  }
  const req = parseBody(body, deps.allowedOrigins);
  if (typeof req === "string") return bad(req);
  const { op, user, requestId } = req;
  const tag = `${op} for user ${user} by admin ${admin} (request ${requestId})`;

  if ((op === "suspend" || op === "purge") && user === admin) return bad(`an admin can't ${op === "suspend" ? "deactivate" : "delete"} their own account here`);
  if (op === "recovery_email" && !deps.emailConfigured) return json(400, { error: "email_not_configured" });

  try {
    // 4. The target account.
    const target = await deps.getUser(user);
    if (!target) return json(404, { error: "user_not_found" });

    // 5. The operation. Each returns what admin_log records (details) and what the response adds (link).
    let details: Record<string, unknown> = {};
    let link: string | undefined;
    switch (op) {
      case "set_email": {
        const oldEmail = (target.email ?? "").toLowerCase();
        const newEmail = req.email!;
        if (newEmail === oldEmail) return bad("that is already the account's address");
        const updated = await deps.updateEmail(user, newEmail);
        if (!updated.ok) {
          if (updated.emailTaken) return json(409, { error: "email_taken" });
          log(`admin-auth: ${tag} failed: ${updated.error}`);
          return json(500, { error: "internal_error" });
        }
        let repointed = 0;
        try {
          if (req.repointInvitations && oldEmail) repointed = await deps.repointInvitations(oldEmail, newEmail);
        } catch (err) {
          // The address has changed (and a retry would now be "already the address"), so the change is logged and
          // the admin is told the invitations stayed where they were.
          log(`admin-auth: ${tag}: the address changed but re-pointing invitations failed: ${err instanceof Error ? err.message : String(err)}`);
          await deps
            .noteAction({ admin, action: OP_ACTION[op], target: user, details: { old: oldEmail || null, new: newEmail, repointed_invitations: null }, requestId })
            .catch(() => log(`admin-auth: ${tag}: admin_note_auth_action failed too`));
          return json(500, { error: "internal_error", detail: "the address changed, but pending invitations were not re-pointed" });
        }
        details = { old: oldEmail || null, new: newEmail, repointed_invitations: repointed };
        break;
      }
      case "recovery_link":
      case "recovery_email": {
        if (!target.email) return bad("the account has no email address");
        if (op === "recovery_link") {
          const minted = await deps.generateRecoveryLink(target.email, req.redirectTo!);
          if (!minted.ok) {
            log(`admin-auth: ${tag} failed: ${minted.error}`);
            return json(500, { error: "internal_error" });
          }
          link = minted.link;
        } else {
          const sent = await deps.sendRecoveryEmail(target.email, req.redirectTo!);
          if (!sent.ok) {
            log(`admin-auth: ${tag} failed: ${sent.error}`);
            return json(500, { error: "internal_error" });
          }
        }
        details = { via: op === "recovery_link" ? "link" : "email" };
        break;
      }
      case "sign_out": {
        details = { sessions: await deps.endSessions(user) };
        break;
      }
      case "suspend": {
        // Ban first (no new sign-ins), then end the sessions (no refresh), then mark the profile (pages treat a
        // still-valid token as signed out). Each step is idempotent, so a retry after a failure finishes the job.
        const banned = await deps.setBan(user, BAN_DURATION);
        if (!banned.ok) {
          log(`admin-auth: ${tag} failed at the ban: ${banned.error}`);
          return json(500, { error: "internal_error" });
        }
        const sessions = await deps.endSessions(user);
        await deps.setSuspended(user, { at: new Date(now()).toISOString(), reason: req.reason! });
        details = { reason: req.reason!, sessions };
        break;
      }
      case "unsuspend": {
        const lifted = await deps.setBan(user, UNBAN);
        if (!lifted.ok) {
          log(`admin-auth: ${tag} failed at lifting the ban: ${lifted.error}`);
          return json(500, { error: "internal_error" });
        }
        await deps.setSuspended(user, null);
        break;
      }
      case "purge": {
        const planned = planPurgeForUser(user, await deps.readPurgeRows(user));
        if (!planned.ok) return json(409, { error: "not_deleted" });
        const { plan } = planned;
        // The order npm run purge-accounts uses: student records, households, then the auth user (which cascades).
        await deps.deleteStudents(plan.students);
        await deps.deleteHouseholds(plan.households);
        const gone = await deps.deleteUser(user);
        if (!gone.ok) {
          log(`admin-auth: ${tag} failed at deleting the user: ${gone.error}`);
          return json(500, { error: "internal_error" });
        }
        details = { students: plan.students.length, households: plan.households.length };
        break;
      }
    }

    // 6. The log row, with the same request_id the site sent. For a recovery link the row comes first: if it can't be
    //    written, the link is never handed out (unused, it simply expires). For the others the Auth change has
    //    happened by now, so a failure still answers 200 (a retried purge would find no user) and is logged loudly.
    try {
      await deps.noteAction({ admin, action: OP_ACTION[op], target: user, details, requestId });
    } catch (err) {
      log(`admin-auth: ${tag} succeeded but admin_note_auth_action failed: ${err instanceof Error ? err.message : String(err)}`);
      if (op === "recovery_link") return json(500, { error: "internal_error" });
    }
    log(`admin-auth: ${tag} done`);
    return json(200, link ? { ok: true, link } : { ok: true });
  } catch (err) {
    log(`admin-auth: ${tag} failed: ${err instanceof Error ? err.message : String(err)}`);
    return json(500, { error: "internal_error" });
  }
}

/** Supabase Auth's "this address belongs to another account" on updateUserById (the same codes as on createUser). */
export function isEmailTaken(error: { code?: string | null; status?: number | null; message?: string | null } | null | undefined): boolean {
  return isAlreadyRegistered(error);
}
