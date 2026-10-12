/**
 * admin-auth: a Supabase Edge Function (Deno) that performs the Supabase Auth admin calls the /admin console needs.
 *
 * READ THIS FIRST. This is one of exactly two pieces of code outside the database that hold the project's secret key
 * (the other is invite-user). It does seven things and nothing else. Full documentation: specs/supabase.md, "Edge
 * Functions"; the why: specs/product/admin.md, "How admin power reaches the site", "What deactivate means", "Password
 * reset and email change", and "The admin-auth Edge Function".
 *
 * WHAT IT DOES
 *   An admin, signed in at aal2 (a second factor), presses a button in /admin. The site's Server Action forwards the
 *   admin's own access token to this function (lib/admin/auth-function.ts, the site's only caller). The function:
 *     1. reads the bearer token and asks Supabase Auth who it belongs to (a client built with the publishable key);
 *        missing, expired, or forged → 401;
 *     2. asks the database `select is_admin()` as that caller (publishable key + the caller's Authorization header):
 *        an unrevoked admins row and aal2. A signed-in non-admin, or an admin still at aal1 → 403;
 *     3. validates the body → else 400;
 *     4. looks up the target user (auth.admin.getUserById) → 404 when there is none;
 *     5. performs the op with the service role:
 *          set_email       auth.admin.updateUserById(user, { email, email_confirm: true }); with repoint_invitations,
 *                          pending invitations addressed to the old email move to the new one (invitations.email).
 *                          Another account has the address → 409 email_taken
 *          recovery_link   auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } }); the link is
 *                          returned once and never logged
 *          recovery_email  auth.resetPasswordForEmail(email, { redirectTo }); only when ADMIN_AUTH_SEND_EMAIL is set
 *                          (an email provider is configured), otherwise 400 email_not_configured
 *          sign_out        public.auth_end_sessions(user): deletes the user's auth.sessions rows (refresh ends)
 *          suspend         ban for ~100 years (ban_duration 876000h) + end the sessions + profiles.suspended_at and
 *                          suspended_reason, which getAccount() treats as signed out; a reason is required
 *          unsuspend       lift the ban (ban_duration "none") + clear profiles.suspended_at and suspended_reason
 *          purge           "Delete now": refuses (409 not_deleted) unless the account is soft-deleted; then the purge
 *                          plan for that one account (supabase/functions/_shared/purge-plan.ts, shared with
 *                          npm run purge-accounts): its student records, the households it left empty, the auth user
 *     6. writes the admin_log row with public.admin_note_auth_action(admin, action, user, details, request_id).
 *   An admin can't suspend or purge their own account through it (400).
 *
 * WHY IT EXISTS (owner decision 3, 2026-10-12, specs/product/admin.md)
 *   These are Supabase Auth admin calls that need the secret key, which bypasses row-level security. That key never
 *   goes to Vercel (specs/supabase.md#keys); Supabase injects it into Edge Functions. Unlike invite-user, the caller
 *   is a signed-in person, so the function authorizes with their own token and the database's is_admin(), and the
 *   site holds no secret for it at all.
 *
 * INPUT
 *   POST {SUPABASE_URL}/functions/v1/admin-auth
 *   Authorization: Bearer <the admin's session access token>
 *   apikey: {SUPABASE_PUBLISHABLE_KEY}
 *   Content-Type: application/json
 *   { "op": "set_email" | "recovery_link" | "recovery_email" | "sign_out" | "suspend" | "unsuspend" | "purge",
 *     "user": "<uuid>", "request_id": "<uuid>",
 *     "email"?: "<new address>", "repoint_invitations"?: true,            -- set_email
 *     "redirect_to"?: "https://<site>/auth/confirm?next=%2Faccount%2Fpassword",   -- recovery_link, recovery_email
 *     "reason"?: "<free text, up to 500 characters>" }                    -- suspend (required)
 *
 * OUTPUT (JSON)
 *   200 { "ok": true, "link"?: "https://<ref>.supabase.co/auth/v1/verify?…&type=recovery…" }   link: recovery_link only
 *   400 { "error": "bad_request", "detail": "…" }   body invalid (detail never echoes a submitted value), or self
 *   400 { "error": "email_not_configured" }          recovery_email without an email provider
 *   401 { "error": "unauthorized" }                  no valid session token
 *   403 { "error": "not_admin" }                     not an admin, or an admin at aal1
 *   404 { "error": "user_not_found" }                no auth user with that id
 *   405 { "error": "method_not_allowed" }            not POST
 *   409 { "error": "email_taken" }                   set_email: the address belongs to another account
 *   409 { "error": "not_deleted" }                   purge: the account isn't soft-deleted (Delete account first)
 *   500 { "error": "internal_error" }                Auth or database failure (logged without secrets)
 *
 * SECRETS (environment)
 *   SUPABASE_URL                    injected by Supabase into every function
 *   SUPABASE_SECRET_KEYS            injected (JSON dictionary of secret keys; "default" is used), else
 *   SUPABASE_SERVICE_ROLE_KEY       injected (legacy service_role key), used only if the above is missing
 *   SUPABASE_PUBLISHABLE_KEYS       injected (JSON dictionary of publishable keys; "default" is used), else
 *   SUPABASE_ANON_KEY               injected (legacy anon key): the caller-scoped client for steps 1 and 2
 *   INVITE_ALLOWED_ORIGINS          already set for invite-user on prod: the site origins a recovery link may land on.
 *                                   Unset → any https://*.vercel.app and http://localhost:* (dev only)
 *   ADMIN_AUTH_SEND_EMAIL           optional, set by us ("1") once an email provider (custom SMTP) is configured in
 *                                   Supabase Auth; unset → recovery_email answers 400 email_not_configured
 *   No new secret is required to deploy.
 *
 * GATEWAY JWT CHECK: ON (supabase/config.toml, verify_jwt = true)
 *   The caller sends a real user JWT, so the gateway refuses anything else before the function runs. Step 1 checks
 *   the token again with Supabase Auth, so the function stays safe if it is ever deployed with --no-verify-jwt (which
 *   Supabase recommends when a project signs with its new asymmetric JWT keys and the gateway check refuses valid
 *   tokens: if every call answers 401 from the gateway, redeploy with --no-verify-jwt).
 *
 * LOGGING
 *   Never a link, a token, a reason, or an email address: user ids, the op, and the request_id only. Every line also
 *   passes through scrub(), which masks anything shaped like an address or a URL. The admin_log row (step 6) is the
 *   one place the old and new address (auth.email) and the reason (account.suspend) are recorded.
 *
 * DEPLOY (dev first, then prod; from the repo root). Needs 20261012200000_admin.sql and
 * 20261012210000_admin_auth_sessions.sql applied to that project first.
 *   npx supabase login
 *   npx supabase functions deploy admin-auth --project-ref <ref>          # dev: gwusgmmionqxabifntgv; add --use-api without Docker
 *   npx supabase secrets set --project-ref <ref> ADMIN_AUTH_SEND_EMAIL=1 # only once an email provider is set up
 *
 * TEST
 *   Unit: npm test (tests/admin-auth-function.test.mts runs handler.ts with fake dependencies).
 *   Against dev: from /admin, Sign out everywhere on a test account, then check Log for the auth.sign_out row. Without
 *   a token: curl -i -X POST "$SUPABASE_URL/functions/v1/admin-auth" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" must
 *   answer 401; with a non-admin's token, 403.
 *
 * ROLLBACK
 *   git checkout <previous-sha> -- supabase/functions/admin-auth supabase/functions/_shared
 *   npx supabase functions deploy admin-auth --project-ref <ref>
 *   To switch it off entirely: npx supabase functions delete admin-auth --project-ref <ref> (the console's Auth
 *   actions then answer "error"; everything else in /admin keeps working).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { BAN_DURATION, handleAdminAuth, isEmailTaken, parseAllowedOrigins, pickSecretKey } from "./handler.ts";
import type { PurgeHousehold, PurgeProfile, PurgeUserStudent } from "../_shared/purge-plan.ts";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = pickSecretKey({
  SUPABASE_SECRET_KEYS: Deno.env.get("SUPABASE_SECRET_KEYS"),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
});
// The same dictionary-or-legacy rule as the secret key, for the publishable (anon) key.
const publishableKey = pickSecretKey({
  SUPABASE_SECRET_KEYS: Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
});
if (!url || !serviceKey || !publishableKey) throw new Error("admin-auth: SUPABASE_URL, a secret key, and a publishable key must be injected by Supabase.");

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin = createClient(url, serviceKey, { auth: NO_SESSION });

/** A client that acts as the caller: the publishable key plus their Authorization header, so RLS and is_admin() see them. */
function asCaller(token: string) {
  return createClient(url!, publishableKey!, { auth: NO_SESSION, global: { headers: { Authorization: `Bearer ${token}` } } });
}

const describe = (error: { status?: number; code?: string; message?: string } | null | undefined, fallback: string) =>
  error ? `${error.status ?? ""} ${error.code ?? ""} ${error.message ?? ""}`.trim() : fallback;

Deno.serve((request) =>
  handleAdminAuth(request, {
    allowedOrigins: parseAllowedOrigins(Deno.env.get("INVITE_ALLOWED_ORIGINS")),
    emailConfigured: Boolean(Deno.env.get("ADMIN_AUTH_SEND_EMAIL")),

    async callerId(token) {
      const { data, error } = await asCaller(token).auth.getUser(token);
      if (error || !data.user) return null;
      return data.user.id;
    },

    async callerIsAdmin(token) {
      const { data, error } = await asCaller(token).rpc("is_admin");
      if (error) throw new Error(`is_admin(): ${error.message}`);
      return data === true;
    },

    async getUser(id) {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },

    async updateEmail(id, email) {
      const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (error) return { ok: false, emailTaken: isEmailTaken(error), error: describe(error, "update failed") };
      return { ok: true };
    },

    async repointInvitations(oldEmail, newEmail) {
      // create_invitation() stores addresses lowercased, so an exact match on the lowercased old address finds them.
      const { data, error } = await admin
        .from("invitations")
        .update({ email: newEmail })
        .eq("email", oldEmail)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .select("id");
      if (error) throw new Error(`re-pointing invitations: ${error.message}`);
      return (data ?? []).length;
    },

    async generateRecoveryLink(email, redirectTo) {
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
      const link = data?.properties?.action_link;
      if (error || !link) return { ok: false, error: describe(error, "no link returned") };
      return { ok: true, link };
    },

    async sendRecoveryEmail(email, redirectTo) {
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      return error ? { ok: false, error: describe(error, "send failed") } : { ok: true };
    },

    async endSessions(id) {
      const { data, error } = await admin.rpc("auth_end_sessions", { p_user: id });
      if (error) throw new Error(`auth_end_sessions(): ${error.message}`);
      return typeof data === "number" ? data : 0;
    },

    async setBan(id, duration) {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: duration });
      return error ? { ok: false, error: describe(error, duration === BAN_DURATION ? "ban failed" : "unban failed") } : { ok: true };
    },

    async setSuspended(id, value) {
      const { error } = await admin
        .from("profiles")
        .upsert({ id, suspended_at: value?.at ?? null, suspended_reason: value?.reason ?? null }, { onConflict: "id" });
      if (error) throw new Error(`profiles.suspended_at: ${error.message}`);
    },

    async readPurgeRows(id) {
      const profile = await admin.from("profiles").select("id, deleted_at").eq("id", id).maybeSingle();
      if (profile.error) throw new Error(`profiles: ${profile.error.message}`);
      const deletedAt = (profile.data as PurgeProfile | null)?.deleted_at ?? null;
      const students = await admin
        .from("students")
        .select("id, user_id, managed_by, deleted_at")
        .or(`user_id.eq.${id},managed_by.eq.${id}`)
        .not("deleted_at", "is", null);
      if (students.error) throw new Error(`students: ${students.error.message}`);
      let households: PurgeHousehold[] = [];
      if (deletedAt) {
        const closed = await admin.from("households").select("id, deleted_at").eq("deleted_at", deletedAt);
        if (closed.error) throw new Error(`households: ${closed.error.message}`);
        households = closed.data as PurgeHousehold[];
      }
      return { profile: (profile.data as PurgeProfile | null) ?? null, students: students.data as PurgeUserStudent[], households };
    },

    async deleteStudents(ids) {
      if (!ids.length) return;
      const { error } = await admin.from("students").delete().in("id", ids);
      if (error) throw new Error(`deleting students: ${error.message}`);
    },

    async deleteHouseholds(ids) {
      if (!ids.length) return;
      const { error } = await admin.from("households").delete().in("id", ids);
      if (error) throw new Error(`deleting households: ${error.message}`);
    },

    async deleteUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      return error ? { ok: false, error: describe(error, "delete failed") } : { ok: true };
    },

    async noteAction({ admin: adminId, action, target, details, requestId }) {
      const { error } = await admin.rpc("admin_note_auth_action", {
        p_admin: adminId,
        p_action: action,
        p_target: target,
        p_details: details,
        p_request_id: requestId,
      });
      if (error) throw new Error(`admin_note_auth_action(): ${error.message}`);
    },
  }),
);
