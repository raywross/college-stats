/**
 * invite-user: a Supabase Edge Function (Deno) that turns a household invitation into an account and a sign-in link.
 *
 * READ THIS FIRST. This is the only code outside the database that holds admin power over Supabase Auth, and it is
 * touched rarely. Full documentation: specs/supabase.md, "Edge Functions"; the why: specs/product/household-hub.md,
 * "The Edge Function" and "Owner decisions" 1.
 *
 * WHAT IT DOES
 *   A parent adds someone to the household with an email. The site creates the invitation in the database
 *   (create_invitation(), which returns a 64-hex token and stores its SHA-256), then calls this function with the
 *   token. The function:
 *     1. checks the X-Invite-Secret header against INVITE_FUNCTION_SECRET (constant time); wrong or missing → 401;
 *     2. checks the body { token, redirectTo }: token is 64 lowercase hex, redirectTo's origin is allowed → else 400;
 *     3. hashes the token (SHA-256, hex, exactly as create_invitation does) and reads that invitation with the service
 *        role; not pending (accepted, revoked) or expired → 404;
 *     4. creates the account with auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name,
 *        role_hint, phone, invitation_id } }) and records it in invitations.accepted_by (so the database's
 *        accept_invitation_by_id() later insists on the same user). If the address already has an account: when it is
 *        the account this function created for this same invitation (accepted_by matches: "Copy link" or a retry), it
 *        carries on; otherwise → 409, and the site falls back to the ordinary "sign in and accept" flow;
 *     5. mints a one-time sign-in link for that account (auth.admin.generateLink, type "magiclink", options.redirectTo)
 *        and returns it. The site emails it and/or shows it to copy. Opening it lands signed in on
 *        /auth/confirm (implicit flow), which moves on to /account/password?welcome=<invitation id>.
 *   It reads and writes nothing but auth users and invitations (accepted_by). It never accepts the invitation itself:
 *   the invited person does, by choosing a password.
 *
 *   Why "magiclink" and not "invite": Supabase Auth refuses generateLink({ type: "invite" }) for a user whose email is
 *   already confirmed (error email_exists; supabase/auth internal/api/mail.go), and the owner's design creates the user
 *   confirmed. A magic link for a confirmed user signs them in the same way, and can be minted again for "Copy link".
 *
 * WHY IT EXISTS (owner decision, 2026-10-06)
 *   Creating a confirmed user and minting a sign-in link are admin calls that need the project's secret key, which
 *   bypasses row-level security and could read every family's data. That key never goes to Vercel
 *   (specs/supabase.md#keys). Supabase injects it into Edge Functions, so the two admin calls live here, and the site
 *   only holds a narrow shared secret that can do exactly this one thing.
 *
 * INPUT
 *   POST {SUPABASE_URL}/functions/v1/invite-user
 *   Authorization: Bearer {SUPABASE_PUBLISHABLE_KEY}   (and apikey: same; the API gateway routes on it)
 *   X-Invite-Secret: {INVITE_FUNCTION_SECRET}
 *   Content-Type: application/json
 *   { "token": "<64 hex>", "redirectTo": "https://<site>/auth/confirm?next=%2Faccount%2Fpassword%3Fwelcome%3D<id>" }
 *
 * OUTPUT (JSON)
 *   200 { "link": "https://<ref>.supabase.co/auth/v1/verify?token=…&type=magiclink&redirect_to=…" }
 *   400 { "error": "bad_request" }            body not JSON, token not 64 hex, redirectTo not allowed
 *   401 { "error": "unauthorized" }           X-Invite-Secret missing or wrong, or INVITE_FUNCTION_SECRET unset
 *   404 { "error": "invitation_not_found" }   no pending, unexpired invitation for that token
 *   405 { "error": "method_not_allowed" }     not POST
 *   409 { "error": "already_registered" }     the address has an account this function didn't create for it
 *   500 { "error": "internal_error" }         Auth or database failure (logged without secrets)
 *
 * SECRETS (environment)
 *   SUPABASE_URL                  injected by Supabase into every function
 *   SUPABASE_SECRET_KEYS          injected (JSON dictionary of secret keys; "default" is used), else
 *   SUPABASE_SERVICE_ROLE_KEY     injected (legacy service_role key), used only if the above is missing
 *   INVITE_FUNCTION_SECRET        set by us: `openssl rand -hex 32`; the same value in Vercel (all environments that
 *                                 invite) and as a function secret. Unset → the function refuses everything
 *   INVITE_ALLOWED_ORIGINS        set by us on prod: comma-separated origins allowed in redirectTo, e.g.
 *                                 "https://college-stats-nine.vercel.app". Unset → any https://*.vercel.app and
 *                                 http://localhost:* (fine for dev, too loose for prod)
 *
 * GATEWAY JWT CHECK: OFF (supabase/config.toml, verify_jwt = false)
 *   The platform's verify_jwt check only accepts JWTs; the project's sb_publishable_ key is not one, and Supabase's
 *   docs say to authorize API-key callers in code instead (docs: guides/api/api-keys, "Known limitations"). The
 *   X-Invite-Secret check above is that authorization. Deploy with --no-verify-jwt as well, to be explicit.
 *
 * LOGGING
 *   Never the token, the link, the secret, or an email address. Invitation ids and user ids only.
 *
 * DEPLOY (dev first, then prod; from the repo root)
 *   npx supabase login
 *   npx supabase link --project-ref <ref>                    # dev: gwusgmmionqxabifntgv
 *   npx supabase secrets set --project-ref <ref> INVITE_FUNCTION_SECRET=<value>
 *   npx supabase secrets set --project-ref <ref> INVITE_ALLOWED_ORIGINS=https://<site>,https://<other>   # prod
 *   npx supabase functions deploy invite-user --project-ref <ref> --no-verify-jwt     # add --use-api without Docker
 *   Then put the same INVITE_FUNCTION_SECRET in Vercel and redeploy the site. Needs the household-hub migration
 *   (invitations.display_name, invitations.phone) applied to that project first.
 *
 * TEST
 *   Unit: npm test (tests/invite-function.test.mts runs handler.ts with fake dependencies).
 *   Against dev, with a real pending invitation's token (from create_invitation):
 *     curl -i -X POST "$SUPABASE_URL/functions/v1/invite-user" \
 *       -H "Authorization: Bearer $SUPABASE_PUBLISHABLE_KEY" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
 *       -H "X-Invite-Secret: $INVITE_FUNCTION_SECRET" -H "Content-Type: application/json" \
 *       -d '{"token":"<64 hex>","redirectTo":"http://localhost:3000/auth/confirm?next=/account"}'
 *   Without the X-Invite-Secret header it must answer 401.
 *
 * ROLLBACK
 *   Check out the previous commit of this folder and deploy again:
 *     git checkout <previous-sha> -- supabase/functions/invite-user && npx supabase functions deploy invite-user --project-ref <ref> --no-verify-jwt
 *   To switch it off entirely, unset INVITE_FUNCTION_SECRET in Vercel (the site then falls back to /invite/<token>
 *   links) or `npx supabase functions delete invite-user --project-ref <ref>`.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleInvite, isAlreadyRegistered, parseAllowedOrigins, pickSecretKey, type InvitationRow } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = pickSecretKey({
  SUPABASE_SECRET_KEYS: Deno.env.get("SUPABASE_SECRET_KEYS"),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
});
if (!url || !serviceKey) throw new Error("invite-user: SUPABASE_URL and a secret key must be injected by Supabase.");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const INVITATION_COLUMNS = "id, email, side, display_name, phone, expires_at, accepted_at, revoked_at, accepted_by";

Deno.serve((request) =>
  handleInvite(request, {
    secret: Deno.env.get("INVITE_FUNCTION_SECRET"),
    allowedOrigins: parseAllowedOrigins(Deno.env.get("INVITE_ALLOWED_ORIGINS")),

    async findInvitationByHash(tokenHash) {
      const { data, error } = await admin.from("invitations").select(INVITATION_COLUMNS).eq("token_hash", tokenHash).maybeSingle();
      if (error) throw new Error(`reading invitations: ${error.message}`);
      return (data as InvitationRow | null) ?? null;
    },

    async createUser(attrs) {
      const { data, error } = await admin.auth.admin.createUser(attrs);
      if (error || !data.user) {
        return { ok: false, alreadyRegistered: isAlreadyRegistered(error), error: error ? `${error.status ?? ""} ${error.code ?? ""} ${error.message}`.trim() : "no user returned" };
      }
      return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
    },

    async getUserById(id) {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },

    async deleteUser(id) {
      await admin.auth.admin.deleteUser(id);
    },

    async setAcceptedBy(invitationId, userId) {
      const { data, error } = await admin
        .from("invitations")
        .update({ accepted_by: userId })
        .eq("id", invitationId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .or(`accepted_by.is.null,accepted_by.eq.${userId}`)
        .select("id");
      if (error) throw new Error(`recording accepted_by: ${error.message}`);
      return (data ?? []).length === 1;
    },

    async generateLink(email, redirectTo) {
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
      const link = data?.properties?.action_link;
      if (error || !link) return { ok: false, error: error ? `${error.status ?? ""} ${error.code ?? ""} ${error.message}`.trim() : "no link returned" };
      return { ok: true, link };
    },
  }),
);
