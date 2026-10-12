/**
 * The admin-auth Edge Function (supabase/functions/admin-auth/handler.ts) with fake Supabase dependencies, the shared
 * one-account purge plan (supabase/functions/_shared/purge-plan.ts), the session-ending SQL function
 * (supabase/migrations/20261012210000_admin_auth_sessions.sql, on PGlite), the site's caller
 * (lib/admin/auth-function.ts), and guards on the function's wiring (specs/product/admin.md, "The admin-auth Edge
 * Function"; specs/supabase.md, "Edge Functions"). The single-caller guard for both functions is in
 * tests/invite-function.test.mts. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ADMIN_AUTH_OPS,
  BAN_DURATION,
  OP_ACTION,
  UNBAN,
  bearer,
  handleAdminAuth,
  isEmailTaken,
  parseBody,
  recoveryRedirectAllowed,
  scrub,
  type AdminAuthDeps,
  type AdminAuthOp,
} from "../supabase/functions/admin-auth/handler.ts";
import { planPurge, planPurgeForUser, type PurgeHousehold, type PurgeUserStudent } from "../supabase/functions/_shared/purge-plan.ts";
import { planPurge as planPurgeFromScript } from "../scripts/lib/purge-accounts-plan.mts";
import { asUser, createAuthDb, createUser } from "./helpers/pg-auth.mts";

// lib/admin/auth-function.ts starts with `import "server-only"`, which only Next.js resolves; stand in an empty module.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});
const { adminAuthConfigured, adminAuthUrl, callAdminAuth, mapAdminAuthResponse, recoveryRedirectTo } = await import("../lib/admin/auth-function.ts");

const ROOT = join(import.meta.dirname, "..");
const NOW = Date.parse("2026-10-12T15:00:00Z");

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const MEMBER = "bbbbbbbb-0000-4000-8000-000000000002";
const TARGET = "cccccccc-0000-4000-8000-000000000003";
const OTHER = "dddddddd-0000-4000-8000-000000000004";
const OLD_EMAIL = "jordan.old@example.com";
const NEW_EMAIL = "jordan.new@example.com";
const TAKEN_EMAIL = "taken@example.com";
const REASON = "Asked by the family on the phone: lost device";
const LINK = "https://ref.supabase.co/auth/v1/verify?token=SECRETLINKTOKEN&type=recovery";
const REDIRECT = "http://localhost:3000/auth/confirm?next=%2Faccount%2Fpassword";
const DELETED_AT = "2026-10-01T10:00:00.123456+00:00";

/** The session tokens the fake Supabase Auth knows: who each belongs to and its assurance level. */
const TOKENS: Record<string, { sub: string; aal: "aal1" | "aal2" }> = {
  "tok-admin-aal2": { sub: ADMIN, aal: "aal2" },
  "tok-admin-aal1": { sub: ADMIN, aal: "aal1" },
  "tok-member-aal2": { sub: MEMBER, aal: "aal2" },
};
const ADMINS = new Set([ADMIN]);

interface Note {
  admin: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  requestId: string;
}

/** A fake Supabase: auth users, sessions, bans, profiles, invitations, students, households; every call recorded. */
function fakeDeps(opts: { emailConfigured?: boolean; deletedAt?: string | null; failAt?: string; throwAt?: string; noteFails?: boolean } = {}) {
  const users = new Map<string, { id: string; email: string | null }>([
    [ADMIN, { id: ADMIN, email: "owner@example.com" }],
    [MEMBER, { id: MEMBER, email: "member@example.com" }],
    [TARGET, { id: TARGET, email: OLD_EMAIL }],
    [OTHER, { id: OTHER, email: TAKEN_EMAIL }],
  ]);
  const sessions = new Map<string, number>([[TARGET, 3]]);
  const bans = new Map<string, string>();
  const suspended = new Map<string, { at: string; reason: string } | null>();
  const invitations = [
    { id: "inv-1", email: OLD_EMAIL, pending: true },
    { id: "inv-2", email: OLD_EMAIL, pending: false },
    { id: "inv-3", email: "someone@example.com", pending: true },
  ];
  const deletedAt = opts.deletedAt === undefined ? DELETED_AT : opts.deletedAt;
  const students: PurgeUserStudent[] = [
    { id: "s-own", user_id: TARGET, managed_by: null, deleted_at: deletedAt },
    { id: "s-managed-with", user_id: null, managed_by: TARGET, deleted_at: deletedAt },
    { id: "s-managed-earlier", user_id: null, managed_by: TARGET, deleted_at: "2026-09-20T08:00:00+00:00" },
  ];
  const households: PurgeHousehold[] = [{ id: "h-closed-with", deleted_at: deletedAt }];
  const calls: string[] = [];
  const logs: string[] = [];
  const notes: Note[] = [];
  const deleted = { students: [] as string[], households: [] as string[], users: [] as string[] };
  const seenTokens: string[] = [];
  const step = (name: string) => {
    calls.push(name);
    if (opts.throwAt === name) throw new Error(`database down while ${name} for ${OLD_EMAIL} at ${LINK}`);
  };

  const deps: AdminAuthDeps = {
    allowedOrigins: null,
    emailConfigured: opts.emailConfigured ?? false,
    now: () => NOW,
    log: (msg) => logs.push(msg),
    async callerId(token) {
      step("callerId");
      seenTokens.push(token);
      return TOKENS[token]?.sub ?? null;
    },
    // What is_admin() does in the database: an unrevoked admins row and aal2, read from the caller's own token.
    async callerIsAdmin(token) {
      step("callerIsAdmin");
      seenTokens.push(token);
      const t = TOKENS[token];
      return Boolean(t && ADMINS.has(t.sub) && t.aal === "aal2");
    },
    async getUser(id) {
      step("getUser");
      return users.get(id) ?? null;
    },
    async updateEmail(id, email) {
      step("updateEmail");
      if (opts.failAt === "updateEmail") return { ok: false, emailTaken: false, error: "500 unexpected_failure Database error" };
      if ([...users.values()].some((u) => u.email === email && u.id !== id)) return { ok: false, emailTaken: true, error: "422 email_exists" };
      users.get(id)!.email = email;
      return { ok: true };
    },
    async repointInvitations(oldEmail, newEmail) {
      step("repointInvitations");
      let n = 0;
      for (const inv of invitations) {
        if (inv.pending && inv.email === oldEmail) {
          inv.email = newEmail;
          n++;
        }
      }
      return n;
    },
    async generateRecoveryLink(email, redirectTo) {
      step("generateRecoveryLink");
      if (opts.failAt === "generateRecoveryLink") return { ok: false, error: "500 unexpected" };
      assert.equal(email, users.get(TARGET)!.email);
      assert.equal(redirectTo, REDIRECT);
      return { ok: true, link: LINK };
    },
    async sendRecoveryEmail() {
      step("sendRecoveryEmail");
      return opts.failAt === "sendRecoveryEmail" ? { ok: false, error: "429 over_email_send_rate_limit" } : { ok: true };
    },
    async endSessions(id) {
      step("endSessions");
      const n = sessions.get(id) ?? 0;
      sessions.delete(id);
      return n;
    },
    async setBan(id, duration) {
      step("setBan");
      if (opts.failAt === "setBan") return { ok: false, error: "500 unexpected" };
      bans.set(id, duration);
      return { ok: true };
    },
    async setSuspended(id, value) {
      step("setSuspended");
      suspended.set(id, value);
    },
    async readPurgeRows(id) {
      step("readPurgeRows");
      return { profile: { id, deleted_at: deletedAt }, students: students.filter((s) => s.user_id === id || s.managed_by === id), households };
    },
    async deleteStudents(ids) {
      step("deleteStudents");
      deleted.students.push(...ids);
    },
    async deleteHouseholds(ids) {
      step("deleteHouseholds");
      deleted.households.push(...ids);
    },
    async deleteUser(id) {
      step("deleteUser");
      if (opts.failAt === "deleteUser") return { ok: false, error: "500 unexpected" };
      users.delete(id);
      deleted.users.push(id);
      return { ok: true };
    },
    async noteAction(note) {
      step("noteAction");
      if (opts.noteFails) throw new Error("admin_note_auth_action(): permission denied");
      notes.push(note);
    },
  };
  return { deps, calls, logs, notes, users, sessions, bans, suspended, invitations, deleted, seenTokens };
}

function post(body: unknown, token: string | null = "tok-admin-aal2") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request("https://ref.supabase.co/functions/v1/admin-auth", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

async function read(res: Response) {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const RID = "eeeeeeee-0000-4000-8000-00000000000e";

/** A valid body for each op. */
function bodyFor(op: AdminAuthOp, over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = { op, user: TARGET, request_id: RID };
  if (op === "set_email") Object.assign(base, { email: NEW_EMAIL, repoint_invitations: true });
  if (op === "recovery_link" || op === "recovery_email") base.redirect_to = REDIRECT;
  if (op === "suspend") base.reason = REASON;
  return { ...base, ...over };
}

/** Nothing that must stay out of logs: the token, the link, an email, the reason. */
function assertCleanLogs(logs: string[]) {
  const text = logs.join("\n");
  for (const secret of ["tok-admin-aal2", "SECRETLINKTOKEN", LINK, OLD_EMAIL, NEW_EMAIL, TAKEN_EMAIL, "owner@example.com", REASON, "lost device"]) {
    assert.ok(!text.includes(secret), `a log line carries ${secret}: ${text}`);
  }
}

/* ------------------------------------------------------------------ */
/* Who may call                                                        */
/* ------------------------------------------------------------------ */

test("405 for anything but POST", async () => {
  const f = fakeDeps();
  const res = await handleAdminAuth(new Request("https://ref.supabase.co/functions/v1/admin-auth", { headers: { Authorization: "Bearer tok-admin-aal2" } }), f.deps);
  assert.equal(res.status, 405);
  assert.deepEqual(f.calls, []);
});

test("401 without a bearer token or with one Supabase Auth doesn't recognize; nothing else is touched", async () => {
  for (const token of [null, "", "tok-forged"]) {
    const f = fakeDeps();
    const r = await read(await handleAdminAuth(post(bodyFor("sign_out"), token), f.deps));
    assert.deepEqual(r, { status: 401, body: { error: "unauthorized" } });
    assert.ok(!f.calls.includes("callerIsAdmin") && !f.calls.includes("getUser") && !f.calls.includes("endSessions"));
  }
  const f = fakeDeps();
  const res = await handleAdminAuth(new Request("https://x/functions/v1/admin-auth", { method: "POST", headers: { Authorization: "Basic abc" }, body: "{}" }), f.deps);
  assert.equal(res.status, 401);
});

test("403 for a signed-in non-admin's valid JWT and for an admin still at aal1; the caller's own token is what is checked", async () => {
  for (const token of ["tok-member-aal2", "tok-admin-aal1"]) {
    for (const op of ADMIN_AUTH_OPS) {
      const f = fakeDeps({ emailConfigured: true });
      const r = await read(await handleAdminAuth(post(bodyFor(op), token), f.deps));
      assert.deepEqual(r, { status: 403, body: { error: "not_admin" } }, `${token} ${op}`);
      assert.deepEqual(f.calls, ["callerId", "callerIsAdmin"], "no Auth or database call after the refusal");
      assert.deepEqual(f.seenTokens, [token, token], "is_admin() runs with the caller's token, not the service role");
      assert.equal(f.notes.length, 0);
    }
  }
});

test("the body is read only after the caller checks out (a non-admin can't probe validation)", async () => {
  const f = fakeDeps();
  const r = await read(await handleAdminAuth(post("not json", "tok-member-aal2"), f.deps));
  assert.equal(r.status, 403);
});

test("500 when checking the caller fails (is_admin() unreachable), without leaking anything", async () => {
  const f = fakeDeps({ throwAt: "callerIsAdmin" });
  const r = await read(await handleAdminAuth(post(bodyFor("sign_out")), f.deps));
  assert.deepEqual(r, { status: 500, body: { error: "internal_error" } });
  assertCleanLogs(f.logs);
});

/* ------------------------------------------------------------------ */
/* The body                                                            */
/* ------------------------------------------------------------------ */

test("400 for a bad body, with a detail that never echoes what was sent", async () => {
  const cases: [unknown, RegExp][] = [
    ["not json", /JSON/],
    [[], /object/],
    [{ ...bodyFor("sign_out"), op: "delete_everything" }, /unknown op/],
    [{ ...bodyFor("sign_out"), op: "SIGN_OUT" }, /unknown op/],
    [{ ...bodyFor("sign_out"), user: "not-a-uuid" }, /user/],
    [{ ...bodyFor("sign_out"), request_id: undefined }, /request_id/],
    [{ ...bodyFor("sign_out"), request_id: "abc" }, /request_id/],
    [bodyFor("set_email", { email: "nope" }), /email/],
    [bodyFor("set_email", { email: undefined }), /email/],
    [bodyFor("set_email", { email: `${"x".repeat(250)}@example.com` }), /email/],
    [bodyFor("set_email", { repoint_invitations: "yes" }), /repoint/],
    [bodyFor("recovery_link", { redirect_to: undefined }), /redirect_to/],
    [bodyFor("recovery_link", { redirect_to: "https://evil.example/auth/confirm" }), /redirect_to/],
    [bodyFor("recovery_link", { redirect_to: "http://localhost:3000/somewhere-else" }), /redirect_to/],
    [bodyFor("suspend", { reason: undefined }), /reason is required/],
    [bodyFor("suspend", { reason: "   " }), /reason is required/],
    [bodyFor("suspend", { reason: "x".repeat(501) }), /longer than 500/],
  ];
  for (const [body, detail] of cases) {
    const f = fakeDeps();
    const r = await read(await handleAdminAuth(post(body), f.deps));
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, "bad_request");
    assert.match(String(r.body.detail), detail);
    assert.ok(!String(r.body.detail).includes("evil") && !String(r.body.detail).includes("nope"));
    assert.ok(!f.calls.includes("getUser"), "nothing is looked up for a bad body");
  }
});

test("400 when an admin tries to deactivate or delete their own account", async () => {
  for (const op of ["suspend", "purge"] as const) {
    const f = fakeDeps();
    const r = await read(await handleAdminAuth(post(bodyFor(op, { user: ADMIN })), f.deps));
    assert.equal(r.status, 400);
    assert.match(String(r.body.detail), /own account/);
    assert.ok(!f.calls.includes("setBan") && !f.calls.includes("deleteUser"));
  }
});

test("parseBody normalizes: lowercased ids and address, trimmed reason, repoint only when true", () => {
  const p = parseBody(bodyFor("set_email", { user: TARGET.toUpperCase(), email: "  Jordan.NEW@Example.com ", repoint_invitations: undefined }), null);
  assert.ok(typeof p !== "string");
  assert.equal(p.user, TARGET);
  assert.equal(p.email, NEW_EMAIL);
  assert.equal(p.repointInvitations, false);
  const s = parseBody(bodyFor("suspend", { reason: `  ${REASON}  ` }), null);
  assert.ok(typeof s !== "string" && s.reason === REASON);
  assert.equal(recoveryRedirectAllowed(REDIRECT, null), true);
  assert.equal(recoveryRedirectAllowed("https://quad.example/auth/confirm?next=/x", ["https://quad.example"]), true);
  assert.equal(recoveryRedirectAllowed("https://other.vercel.app/auth/confirm", ["https://quad.example"]), false);
  assert.equal(bearer("Bearer abc"), "abc");
  assert.equal(bearer("bearer abc"), "abc");
  assert.equal(bearer("Bearer"), null);
  assert.equal(bearer(null), null);
});

test("404 user_not_found for every op when the target has no auth user; nothing changes", async () => {
  for (const op of ADMIN_AUTH_OPS) {
    const f = fakeDeps({ emailConfigured: true });
    const r = await read(await handleAdminAuth(post(bodyFor(op, { user: randomUUID() })), f.deps));
    assert.deepEqual(r, { status: 404, body: { error: "user_not_found" } }, op);
    assert.equal(f.notes.length, 0);
    assert.deepEqual(f.calls, ["callerId", "callerIsAdmin", "getUser"]);
  }
});

/* ------------------------------------------------------------------ */
/* The seven operations                                                */
/* ------------------------------------------------------------------ */

test("set_email: changes the address (admin vouches), re-points pending invitations when asked, logs old and new", async () => {
  const f = fakeDeps();
  const r = await read(await handleAdminAuth(post(bodyFor("set_email")), f.deps));
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.equal(f.users.get(TARGET)!.email, NEW_EMAIL);
  assert.deepEqual(f.invitations.map((i) => i.email), [NEW_EMAIL, OLD_EMAIL, "someone@example.com"], "only the pending one for the old address moves");
  assert.deepEqual(f.notes, [{ admin: ADMIN, action: "auth.email", target: TARGET, details: { old: OLD_EMAIL, new: NEW_EMAIL, repointed_invitations: 1 }, requestId: RID }]);
  assertCleanLogs(f.logs);

  const g = fakeDeps();
  await handleAdminAuth(post(bodyFor("set_email", { repoint_invitations: false })), g.deps);
  assert.ok(!g.calls.includes("repointInvitations"), "invitations stay unless the box was ticked");
  assert.equal(g.notes[0].details.repointed_invitations, 0);
});

test("set_email: 409 email_taken when another account has the address; 400 for the same address; 500 on failure", async () => {
  const f = fakeDeps();
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("set_email", { email: TAKEN_EMAIL })), f.deps)), { status: 409, body: { error: "email_taken" } });
  assert.equal(f.users.get(TARGET)!.email, OLD_EMAIL);
  assert.ok(!f.calls.includes("repointInvitations"));
  assert.equal(f.notes.length, 0);

  const same = fakeDeps();
  assert.equal((await handleAdminAuth(post(bodyFor("set_email", { email: OLD_EMAIL.toUpperCase() })), same.deps)).status, 400);
  assert.ok(!same.calls.includes("updateEmail"));

  const broken = fakeDeps({ failAt: "updateEmail" });
  assert.equal((await handleAdminAuth(post(bodyFor("set_email")), broken.deps)).status, 500);
  assert.equal(broken.notes.length, 0);
  assertCleanLogs([...f.logs, ...same.logs, ...broken.logs]);

  // The address changed but re-pointing failed: the change is still logged (a retry can't redo it), and the 500 says so.
  const half = fakeDeps({ throwAt: "repointInvitations" });
  const h = await read(await handleAdminAuth(post(bodyFor("set_email")), half.deps));
  assert.equal(h.status, 500);
  assert.match(String(h.body.detail), /address changed/);
  assert.deepEqual(half.notes.map((n) => [n.action, n.details]), [["auth.email", { old: OLD_EMAIL, new: NEW_EMAIL, repointed_invitations: null }]]);
  assertCleanLogs(half.logs);
  assert.match(String((mapAdminAuthResponse("set_email", 500, h.body) as { detail: string }).detail), /address changed/, "the caller passes the detail on");

  assert.equal(isEmailTaken({ code: "email_exists", status: 422, message: "x" }), true);
  assert.equal(isEmailTaken({ code: "unexpected_failure", status: 500, message: "Database error" }), false);
});

test("recovery_link: returns the link once; the log row and every log line leave it out", async () => {
  const f = fakeDeps();
  const r = await read(await handleAdminAuth(post(bodyFor("recovery_link")), f.deps));
  assert.deepEqual(r, { status: 200, body: { ok: true, link: LINK } });
  assert.deepEqual(f.notes, [{ admin: ADMIN, action: "auth.recovery", target: TARGET, details: { via: "link" }, requestId: RID }]);
  assert.ok(!JSON.stringify(f.notes).includes("SECRETLINKTOKEN"));
  assertCleanLogs(f.logs);

  const broken = fakeDeps({ failAt: "generateRecoveryLink" });
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("recovery_link")), broken.deps)), { status: 500, body: { error: "internal_error" } });
  assert.equal(broken.notes.length, 0);
});

test("recovery_link: when the log row can't be written, the link is never handed out", async () => {
  const f = fakeDeps({ noteFails: true });
  const r = await read(await handleAdminAuth(post(bodyFor("recovery_link")), f.deps));
  assert.deepEqual(r, { status: 500, body: { error: "internal_error" } });
  assert.ok(!JSON.stringify(r.body).includes("SECRETLINKTOKEN"));
  assertCleanLogs(f.logs);
});

test("recovery_email: 400 email_not_configured without an email provider (nothing sent); sends once configured", async () => {
  const f = fakeDeps({ emailConfigured: false });
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("recovery_email")), f.deps)), { status: 400, body: { error: "email_not_configured" } });
  assert.ok(!f.calls.includes("sendRecoveryEmail") && !f.calls.includes("getUser"));

  const g = fakeDeps({ emailConfigured: true });
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("recovery_email")), g.deps)), { status: 200, body: { ok: true } });
  assert.deepEqual(g.notes.map((n) => [n.action, n.details]), [["auth.recovery", { via: "email" }]]);

  const broken = fakeDeps({ emailConfigured: true, failAt: "sendRecoveryEmail" });
  assert.equal((await handleAdminAuth(post(bodyFor("recovery_email")), broken.deps)).status, 500);
  assert.equal(broken.notes.length, 0);
  assertCleanLogs([...f.logs, ...g.logs, ...broken.logs]);
});

test("sign_out: deletes the user's sessions and logs how many", async () => {
  const f = fakeDeps();
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("sign_out")), f.deps)), { status: 200, body: { ok: true } });
  assert.equal(f.sessions.has(TARGET), false);
  assert.deepEqual(f.notes, [{ admin: ADMIN, action: "auth.sign_out", target: TARGET, details: { sessions: 3 }, requestId: RID }]);
  assert.ok(!f.calls.includes("setBan") && !f.calls.includes("setSuspended"), "signing out doesn't deactivate");
});

test("suspend: ban (~100 years), then end sessions, then mark the profile; the reason goes only to the log row", async () => {
  const f = fakeDeps();
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("suspend")), f.deps)), { status: 200, body: { ok: true } });
  assert.equal(BAN_DURATION, "876000h");
  assert.ok(876000 / 24 / 365 > 99, "about a hundred years");
  assert.equal(f.bans.get(TARGET), BAN_DURATION);
  assert.equal(f.sessions.has(TARGET), false);
  assert.deepEqual(f.suspended.get(TARGET), { at: new Date(NOW).toISOString(), reason: REASON });
  const order = f.calls.filter((c) => ["setBan", "endSessions", "setSuspended", "noteAction"].includes(c));
  assert.deepEqual(order, ["setBan", "endSessions", "setSuspended", "noteAction"]);
  assert.deepEqual(f.notes, [{ admin: ADMIN, action: "account.suspend", target: TARGET, details: { reason: REASON, sessions: 3 }, requestId: RID }]);
  assertCleanLogs(f.logs);

  const broken = fakeDeps({ failAt: "setBan" });
  assert.equal((await handleAdminAuth(post(bodyFor("suspend")), broken.deps)).status, 500);
  assert.ok(!broken.calls.includes("setSuspended") && broken.notes.length === 0, "nothing else happens when the ban fails");
  assertCleanLogs(broken.logs);
});

test("unsuspend: lifts the ban and clears suspended_at and the reason", async () => {
  const f = fakeDeps();
  await handleAdminAuth(post(bodyFor("suspend")), f.deps);
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("unsuspend")), f.deps)), { status: 200, body: { ok: true } });
  assert.equal(f.bans.get(TARGET), UNBAN);
  assert.equal(f.suspended.get(TARGET), null);
  assert.deepEqual(f.notes.map((n) => [n.action, n.details]), [["account.suspend", { reason: REASON, sessions: 3 }], ["account.unsuspend", {}]]);

  const broken = fakeDeps({ failAt: "setBan" });
  assert.equal((await handleAdminAuth(post(bodyFor("unsuspend")), broken.deps)).status, 500);
  assert.ok(!broken.calls.includes("setSuspended"));
});

test("purge: 409 not_deleted for an account that isn't soft-deleted, and nothing is deleted", async () => {
  const f = fakeDeps({ deletedAt: null });
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("purge")), f.deps)), { status: 409, body: { error: "not_deleted" } });
  assert.deepEqual(f.deleted, { students: [], households: [], users: [] });
  assert.equal(f.notes.length, 0);
});

test("purge: deletes what was deleted with the account (students, then households, then the auth user) and logs counts", async () => {
  const f = fakeDeps();
  assert.deepEqual(await read(await handleAdminAuth(post(bodyFor("purge")), f.deps)), { status: 200, body: { ok: true } });
  assert.deepEqual(f.deleted, { students: ["s-own", "s-managed-with"], households: ["h-closed-with"], users: [TARGET] });
  const order = f.calls.filter((c) => ["deleteStudents", "deleteHouseholds", "deleteUser", "noteAction"].includes(c));
  assert.deepEqual(order, ["deleteStudents", "deleteHouseholds", "deleteUser", "noteAction"]);
  assert.deepEqual(f.notes, [{ admin: ADMIN, action: "account.purge", target: TARGET, details: { students: 2, households: 1 }, requestId: RID }]);
  assertCleanLogs(f.logs);

  const broken = fakeDeps({ failAt: "deleteUser" });
  assert.equal((await handleAdminAuth(post(bodyFor("purge")), broken.deps)).status, 500);
  assert.equal(broken.notes.length, 0);
});

test("every op writes exactly one admin_log row through admin_note_auth_action, with its action and the request_id", async () => {
  assert.deepEqual([...ADMIN_AUTH_OPS].sort(), ["purge", "recovery_email", "recovery_link", "set_email", "sign_out", "suspend", "unsuspend"]);
  for (const op of ADMIN_AUTH_OPS) {
    const f = fakeDeps({ emailConfigured: true });
    const r = await handleAdminAuth(post(bodyFor(op)), f.deps);
    assert.equal(r.status, 200, op);
    assert.equal(f.notes.length, 1, op);
    assert.equal(f.notes[0].action, OP_ACTION[op]);
    assert.equal(f.notes[0].requestId, RID);
    assert.equal(f.notes[0].admin, ADMIN);
    // Emails only in auth.email rows, the reason only in account.suspend rows, a link never.
    const details = JSON.stringify(f.notes[0].details);
    assert.equal(details.includes("@"), op === "set_email", `${op}: ${details}`);
    assert.equal(details.includes(REASON), op === "suspend", `${op}: ${details}`);
    assert.ok(!details.includes("SECRETLINKTOKEN"));
    assertCleanLogs(f.logs);
  }
});

test("when the log row fails after the Auth change, the op still answers 200 (no retry of a done change) and says so in the logs", async () => {
  for (const op of ["sign_out", "suspend", "purge", "set_email"] as const) {
    const f = fakeDeps({ noteFails: true });
    assert.equal((await handleAdminAuth(post(bodyFor(op)), f.deps)).status, 200, op);
    assert.ok(f.logs.some((l) => l.includes("admin_note_auth_action failed")));
    assertCleanLogs(f.logs);
  }
});

test("500 internal_error when a dependency throws, and the log line is scrubbed of addresses and links", async () => {
  for (const at of ["getUser", "endSessions", "setSuspended", "readPurgeRows", "deleteStudents"]) {
    const op: AdminAuthOp = at === "endSessions" ? "sign_out" : at === "setSuspended" ? "suspend" : "purge";
    const f = fakeDeps({ throwAt: at });
    assert.deepEqual(await read(await handleAdminAuth(post(bodyFor(op)), f.deps)), { status: 500, body: { error: "internal_error" } }, at);
    assertCleanLogs(f.logs);
    assert.ok(f.logs.some((l) => l.includes("<email>") && l.includes("<url>")), "the thrown message was masked, not dropped");
  }
});

test("scrub masks addresses and URLs and keeps ids", () => {
  assert.equal(scrub(`user ${TARGET} jordan@example.com https://x.example/a?b=c`), `user ${TARGET} <email> <url>`);
  assert.equal(scrub("admin-auth: sign_out done"), "admin-auth: sign_out done");
});

/* ------------------------------------------------------------------ */
/* The one-account purge plan                                          */
/* ------------------------------------------------------------------ */

test("planPurgeForUser: only a soft-deleted account, with the rows deleted in the same transaction", () => {
  const rows = {
    profile: { id: TARGET, deleted_at: DELETED_AT },
    students: [
      { id: "own", user_id: TARGET, managed_by: null, deleted_at: DELETED_AT },
      { id: "managed-with", user_id: null, managed_by: TARGET, deleted_at: DELETED_AT },
      { id: "managed-earlier", user_id: null, managed_by: TARGET, deleted_at: "2026-09-01T00:00:00+00:00" },
      { id: "claimed", user_id: OTHER, managed_by: TARGET, deleted_at: DELETED_AT },
    ],
    households: [
      { id: "h-with", deleted_at: DELETED_AT },
      { id: "h-other", deleted_at: "2026-10-01T10:00:00+00:00" },
    ],
  };
  const p = planPurgeForUser(TARGET, rows);
  assert.ok(p.ok);
  assert.deepEqual(p.plan.users, [TARGET]);
  assert.deepEqual(p.plan.students, ["own", "managed-with"], "another person's own record is never purged with this account");
  assert.deepEqual(p.plan.households, ["h-with"]);
  // The same instant written another way still matches.
  assert.ok(planPurgeForUser(TARGET, { ...rows, households: [{ id: "h", deleted_at: "2026-10-01T10:00:00.123Z" }] }).ok);

  assert.deepEqual(planPurgeForUser(TARGET, { ...rows, profile: { id: TARGET, deleted_at: null } }), { ok: false, reason: "not_deleted" });
  assert.deepEqual(planPurgeForUser(TARGET, { ...rows, profile: null }), { ok: false, reason: "not_deleted" });
  assert.deepEqual(planPurgeForUser(TARGET, { ...rows, profile: { id: OTHER, deleted_at: DELETED_AT } }), { ok: false, reason: "not_deleted" });
  assert.deepEqual(planPurgeForUser(TARGET, { ...rows, profile: { id: TARGET, deleted_at: "junk" } }), { ok: false, reason: "not_deleted" });
});

test("the script's planPurge is the shared one (shared, not copied)", () => {
  assert.equal(planPurgeFromScript, planPurge);
  const script = readFileSync(join(ROOT, "scripts/lib/purge-accounts-plan.mts"), "utf8");
  assert.match(script, /from "\.\.\/\.\.\/supabase\/functions\/_shared\/purge-plan\.ts"/);
  assert.doesNotMatch(script, /function planPurge/);
});

/* ------------------------------------------------------------------ */
/* auth_end_sessions() on PGlite                                       */
/* ------------------------------------------------------------------ */

// auth.sessions is in the shared stub (tests/helpers/pg-auth.mts); refresh tokens are only needed here.
const SESSIONS_STUB = `
create table auth.refresh_tokens (id bigserial primary key, session_id uuid references auth.sessions (id) on delete cascade);
`;
const MIGRATION = "20261012210000_admin_auth_sessions.sql";

async function asRole(db: Awaited<ReturnType<typeof createAuthDb>>, role: string, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return (await tx.query<Record<string, unknown>>(sql, params)).rows;
  });
}

async function sessionsDb(migrationSql?: string) {
  const db = await createAuthDb(migrationSql === undefined ? [MIGRATION] : []);
  if (migrationSql !== undefined) await db.exec(migrationSql);
  await db.exec(SESSIONS_STUB);
  const a = await createUser(db, { email: "a@example.com" });
  const b = await createUser(db, { email: "b@example.com" });
  for (const u of [a, a, b]) {
    const { rows } = await db.query<{ id: string }>("insert into auth.sessions (user_id) values ($1) returning id", [u]);
    await db.query("insert into auth.refresh_tokens (session_id) values ($1)", [rows[0].id]);
  }
  return { db, a, b };
}

test("auth_end_sessions: the service role ends one user's sessions (refresh tokens go with them); no API role can call it", async () => {
  const { db, a, b } = await sessionsDb();
  const [{ n }] = await asRole(db, "service_role", "select public.auth_end_sessions($1) as n", [a]);
  assert.equal(n, 2);
  const left = await db.query<{ user_id: string }>("select user_id from auth.sessions");
  assert.deepEqual(left.rows.map((r) => r.user_id), [b]);
  assert.equal((await db.query("select * from auth.refresh_tokens")).rows.length, 1);

  for (const user of [a, null]) {
    await assert.rejects(asUser(db, user, "select public.auth_end_sessions($1)", [b]), /permission denied/);
  }
  assert.equal((await db.query("select * from auth.sessions")).rows.length, 1, "b's session is untouched");
});

test("guard: without the migration's revoke, a signed-in user could end anyone's sessions (the test above catches it)", async () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations", MIGRATION), "utf8");
  assert.match(sql, /revoke execute on function public\.auth_end_sessions\(uuid\) from public, anon, authenticated;/);
  const broken = sql.replace(/revoke execute on function public\.auth_end_sessions\(uuid\) from public, anon, authenticated;/, "");
  const { db, a, b } = await sessionsDb(broken);
  const rows = await asUser(db, a, "select public.auth_end_sessions($1) as n", [b]);
  assert.equal(rows[0].n, 1, "the broken copy lets a member sign someone else out");
});

/* ------------------------------------------------------------------ */
/* The site's caller (lib/admin/auth-function.ts)                      */
/* ------------------------------------------------------------------ */

const ENV = { SUPABASE_URL: "https://ref.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };
const ACCESS = "eyJ.access.token";

function fakeFetch(status: number, body: unknown) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetch: f, seen };
}

test("adminAuthConfigured needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (no secret)", () => {
  assert.equal(adminAuthConfigured(ENV), true);
  for (const key of Object.keys(ENV)) assert.equal(adminAuthConfigured({ ...ENV, [key]: "" }), false, key);
  assert.equal(adminAuthUrl("https://ref.supabase.co/"), "https://ref.supabase.co/functions/v1/admin-auth");
  assert.equal(recoveryRedirectTo("http://localhost:3000/"), REDIRECT);
  assert.equal(recoveryRedirectAllowed(recoveryRedirectTo("http://localhost:3000"), null), true, "the caller's redirect passes the function's check");
});

test("mapAdminAuthResponse: every status the function answers", () => {
  assert.deepEqual(mapAdminAuthResponse("sign_out", 200, { ok: true }), { ok: true });
  assert.deepEqual(mapAdminAuthResponse("recovery_link", 200, { ok: true, link: LINK }), { ok: true, link: LINK });
  assert.equal(mapAdminAuthResponse("recovery_link", 200, { ok: true }).ok, false, "a recovery link answer without a link is an error");
  assert.equal(mapAdminAuthResponse("recovery_link", 200, { ok: true, link: "javascript:alert(1)" }).ok, false);
  assert.deepEqual(mapAdminAuthResponse("sign_out", 200, { ok: true, link: LINK }), { ok: true }, "a link is only passed on for recovery_link");
  assert.deepEqual(mapAdminAuthResponse("suspend", 400, { error: "bad_request", detail: "a reason is required" }), { ok: false, reason: "bad_request", detail: "a reason is required" });
  assert.deepEqual(mapAdminAuthResponse("recovery_email", 400, { error: "email_not_configured" }), { ok: false, reason: "not_configured", detail: "email_not_configured" });
  assert.deepEqual(mapAdminAuthResponse("sign_out", 401, { error: "unauthorized" }), { ok: false, reason: "unauthorized" });
  assert.deepEqual(mapAdminAuthResponse("sign_out", 401, { code: 401, message: "Invalid JWT" }), { ok: false, reason: "unauthorized" }, "the gateway's own 401");
  assert.deepEqual(mapAdminAuthResponse("sign_out", 403, { error: "not_admin" }), { ok: false, reason: "not_admin" });
  assert.deepEqual(mapAdminAuthResponse("sign_out", 404, { error: "user_not_found" }), { ok: false, reason: "user_not_found" });
  assert.equal((mapAdminAuthResponse("sign_out", 404, { code: "NOT_FOUND" }) as { reason: string }).reason, "error", "the function not deployed");
  assert.deepEqual(mapAdminAuthResponse("set_email", 409, { error: "email_taken" }), { ok: false, reason: "email_taken" });
  assert.deepEqual(mapAdminAuthResponse("purge", 409, { error: "not_deleted" }), { ok: false, reason: "not_deleted" });
  assert.equal((mapAdminAuthResponse("sign_out", 500, { error: "internal_error" }) as { reason: string }).reason, "error");
  assert.equal((mapAdminAuthResponse("sign_out", 502, null) as { reason: string }).reason, "error");
});

test("callAdminAuth: not_configured without the variables and unauthorized without a token; no request is made", async () => {
  const f = fakeFetch(200, { ok: true });
  assert.deepEqual(await callAdminAuth({ op: "sign_out", user: TARGET }, ACCESS, { env: {}, fetch: f.fetch }), { ok: false, reason: "not_configured" });
  assert.deepEqual(await callAdminAuth({ op: "sign_out", user: TARGET }, "", { env: ENV, fetch: f.fetch }), { ok: false, reason: "unauthorized" });
  assert.equal(f.seen.length, 0);
});

test("callAdminAuth: forwards the admin's token, the publishable key, a fresh request_id, and only the op's fields", async () => {
  const f = fakeFetch(200, { ok: true });
  const r = await callAdminAuth({ op: "set_email", user: TARGET, email: NEW_EMAIL, repointInvitations: true, reason: "ignored" }, ACCESS, { env: ENV, fetch: f.fetch });
  assert.deepEqual(r, { ok: true });
  const { url, init } = f.seen[0];
  assert.equal(url, "https://ref.supabase.co/functions/v1/admin-auth");
  assert.equal(init.method, "POST");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${ACCESS}`);
  assert.equal(headers.apikey, "sb_publishable_x");
  const body = JSON.parse(String(init.body));
  assert.match(body.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual({ ...body, request_id: "x" }, { op: "set_email", user: TARGET, request_id: "x", email: NEW_EMAIL, repoint_invitations: true });
  // The body the caller builds passes the function's own validation.
  assert.ok(typeof parseBody(body, null) !== "string");

  const g = fakeFetch(200, { ok: true });
  await callAdminAuth({ op: "suspend", user: TARGET, reason: REASON }, ACCESS, { env: ENV, fetch: g.fetch, requestId: () => RID });
  assert.deepEqual(JSON.parse(String(g.seen[0].init.body)), { op: "suspend", user: TARGET, request_id: RID, reason: REASON });

  const second = fakeFetch(200, { ok: true });
  await callAdminAuth({ op: "sign_out", user: TARGET }, ACCESS, { env: ENV, fetch: second.fetch });
  await callAdminAuth({ op: "sign_out", user: TARGET }, ACCESS, { env: ENV, fetch: second.fetch });
  const ids = second.seen.map((s) => JSON.parse(String(s.init.body)).request_id);
  assert.notEqual(ids[0], ids[1], "each call makes its own request_id");
});

test("callAdminAuth: recovery ops send this site's /auth/confirm, from the request or the deps; none → bad_request without a call", async () => {
  const f = fakeFetch(200, { ok: true, link: LINK });
  assert.deepEqual(await callAdminAuth({ op: "recovery_link", user: TARGET, origin: "http://localhost:3000" }, ACCESS, { env: ENV, fetch: f.fetch }), { ok: true, link: LINK });
  assert.equal(JSON.parse(String(f.seen[0].init.body)).redirect_to, REDIRECT);

  const g = fakeFetch(200, { ok: true });
  await callAdminAuth({ op: "recovery_email", user: TARGET }, ACCESS, { env: ENV, fetch: g.fetch, origin: async () => "http://localhost:3000" });
  assert.equal(JSON.parse(String(g.seen[0].init.body)).redirect_to, REDIRECT);

  const h = fakeFetch(200, { ok: true });
  const r = await callAdminAuth({ op: "recovery_link", user: TARGET }, ACCESS, { env: ENV, fetch: h.fetch, origin: async () => null });
  assert.equal(r.ok, false);
  assert.equal((r as { reason: string }).reason, "bad_request");
  assert.equal(h.seen.length, 0);
  // Outside a request (this test), the header fallback finds no origin rather than throwing.
  const i = fakeFetch(200, { ok: true });
  assert.equal((await callAdminAuth({ op: "recovery_link", user: TARGET }, ACCESS, { env: ENV, fetch: i.fetch })).ok, false);
});

test("callAdminAuth: network errors, timeouts, and odd answers are { ok: false, reason: 'error' }; nothing private is logged", async () => {
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  assert.deepEqual(await callAdminAuth({ op: "suspend", user: TARGET, reason: REASON }, ACCESS, { env: ENV, fetch: down, log }), { ok: false, reason: "error", detail: "fetch failed" });

  const hang = ((_url: string, init: RequestInit) =>
    new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
  assert.deepEqual(await callAdminAuth({ op: "set_email", user: TARGET, email: NEW_EMAIL }, ACCESS, { env: ENV, fetch: hang, timeoutMs: 20, log }), { ok: false, reason: "error", detail: "timed out" });

  const html = fakeFetch(502, "<html>");
  assert.equal((await callAdminAuth({ op: "recovery_link", user: TARGET, origin: "http://localhost:3000" }, ACCESS, { env: ENV, fetch: html.fetch, log })).ok, false);
  const noLink = fakeFetch(200, { ok: true });
  assert.equal((await callAdminAuth({ op: "recovery_link", user: TARGET, origin: "http://localhost:3000" }, ACCESS, { env: ENV, fetch: noLink.fetch, log })).ok, false);

  assert.ok(logs.length >= 3);
  const text = logs.join("\n");
  for (const secret of [ACCESS, REASON, NEW_EMAIL, LINK, "SECRETLINKTOKEN"]) assert.ok(!text.includes(secret), secret);
});

/* ------------------------------------------------------------------ */
/* Guards on the wiring                                                */
/* ------------------------------------------------------------------ */

test("guard: config.toml turns the gateway JWT check on for admin-auth (and keeps it off for invite-user)", () => {
  const toml = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
  const on = /\[functions\.admin-auth\]\s*\n(#.*\n)*verify_jwt = true/;
  assert.match(toml, on);
  assert.match(toml, /\[functions\.invite-user\]\s*\n(#.*\n)*verify_jwt = false/);
  assert.doesNotMatch(toml.replace("verify_jwt = true", "verify_jwt = false"), on, "the guard fails when the check is turned off");
});

/** The ops a handler source dispatches (its `case "…":` labels). */
function dispatchedOps(src: string): string[] {
  return [...src.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]).sort();
}

test("guard: the handler dispatches exactly the seven ops, and the client offers the same seven", () => {
  const handler = readFileSync(join(ROOT, "supabase/functions/admin-auth/handler.ts"), "utf8");
  const seven = [...ADMIN_AUTH_OPS].sort();
  assert.deepEqual(dispatchedOps(handler), seven);
  assert.notDeepEqual(dispatchedOps(handler.replace('case "purge": {', 'case "purge": {\n      case "delete_any_user":')), seven, "an eighth op is caught");
  const client = readFileSync(join(ROOT, "lib/admin/auth-function.ts"), "utf8");
  const clientOps = /export type AdminAuthOp = ([^;]+);/.exec(client)![1].match(/"([a-z_]+)"/g)!.map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(clientOps, seven);
  assert.doesNotMatch(handler, /from "npm:|Deno\./, "handler.ts stays free of Deno and npm imports");
});

test("guard: index.ts checks is_admin() as the caller (publishable key + their token), never with the service client", () => {
  const index = readFileSync(join(ROOT, "supabase/functions/admin-auth/index.ts"), "utf8");
  assert.match(index, /Deno\.serve\(/);
  assert.match(index, /from "\.\/handler\.ts"/);
  const callerCheck = /async callerIsAdmin\(token\) \{\s*const \{ data, error \} = await asCaller\(token\)\.rpc\("is_admin"\)/;
  assert.match(index, callerCheck);
  assert.match(index, /createClient\(url!, publishableKey!, \{ auth: NO_SESSION, global: \{ headers: \{ Authorization: `Bearer \$\{token\}` \} \} \}\)/);
  assert.doesNotMatch(index.replace('asCaller(token).rpc("is_admin")', 'admin.rpc("is_admin")'), callerCheck, "the guard fails when is_admin() moves to the service client");
  // Never log or return what the spec keeps private.
  assert.doesNotMatch(index, /console\.(log|warn|error)/, "all logging goes through the handler's scrubbed log");
});
