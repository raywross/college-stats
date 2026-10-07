/**
 * The invite-user Edge Function (supabase/functions/invite-user/handler.ts) with fake Supabase dependencies, its Node
 * client (lib/invite-function.ts), and a guard that nothing else in the app calls the function
 * (specs/supabase.md, "Edge Functions"). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { join, relative } from "node:path";
import {
  handleInvite,
  isAlreadyRegistered,
  parseAllowedOrigins,
  pickSecretKey,
  redirectAllowed,
  sha256Hex,
  timingSafeEqualStrings,
  type CreateUserResult,
  type InvitationRow,
  type InviteDeps,
  type NewUserAttributes,
} from "../supabase/functions/invite-user/handler.ts";

// lib/invite-function.ts starts with `import "server-only"`, which only Next.js resolves; stand in an empty module.
// (module.registerHooks is in Node 24; the installed @types/node predates it.)
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
const { inviteFunctionConfigured, inviteFunctionUrl, inviteUser, mapInviteResponse } = await import("../lib/invite-function.ts");

const ROOT = join(import.meta.dirname, "..");
const SECRET = "s3cret-shared-value";
const TOKEN = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
const REDIRECT = "http://localhost:3000/auth/confirm?next=%2Faccount%2Fpassword%3Fwelcome%3Dinv-1";
const NOW = Date.parse("2026-10-06T12:00:00Z");

function invitation(over: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: "inv-1",
    email: "tracy@example.com",
    side: "guardian",
    display_name: "Tracy Ross",
    phone: "+16155550100",
    expires_at: "2026-10-13T12:00:00Z",
    accepted_at: null,
    revoked_at: null,
    accepted_by: null,
    ...over,
  };
}

/** A fake Supabase: one invitations table keyed by token hash and a users list, recording every call. */
function fakeDeps(opts: { row?: InvitationRow | null; existingUsers?: { id: string; email: string }[]; generateFails?: boolean } = {}) {
  const row = opts.row === undefined ? invitation() : opts.row;
  const users = [...(opts.existingUsers ?? [])];
  const calls: string[] = [];
  const logs: string[] = [];
  let created: NewUserAttributes | null = null;
  let lookedUpHash: string | null = null;
  const deps: InviteDeps = {
    secret: SECRET,
    allowedOrigins: null,
    now: () => NOW,
    log: (msg) => logs.push(msg),
    async findInvitationByHash(hash) {
      calls.push("find");
      lookedUpHash = hash;
      return row && hash === createHash("sha256").update(TOKEN, "utf8").digest("hex") ? row : null;
    },
    async createUser(attrs): Promise<CreateUserResult> {
      calls.push("createUser");
      if (users.some((u) => u.email === attrs.email)) return { ok: false, alreadyRegistered: true, error: "422 email_exists" };
      created = attrs;
      const user = { id: `user-${users.length + 1}`, email: attrs.email };
      users.push(user);
      return { ok: true, user };
    },
    async getUserById(id) {
      calls.push("getUserById");
      return users.find((u) => u.id === id) ?? null;
    },
    async deleteUser(id) {
      calls.push("deleteUser");
      users.splice(users.findIndex((u) => u.id === id), 1);
    },
    async setAcceptedBy(invitationId, userId) {
      calls.push("setAcceptedBy");
      if (!row || row.id !== invitationId || row.accepted_at || row.revoked_at) return false;
      if (row.accepted_by && row.accepted_by !== userId) return false;
      row.accepted_by = userId;
      return true;
    },
    async generateLink(email, redirectTo) {
      calls.push("generateLink");
      if (opts.generateFails) return { ok: false, error: "500 unexpected" };
      return { ok: true, link: `https://ref.supabase.co/auth/v1/verify?token=LINKTOKEN&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}&for=${email}` };
    },
  };
  return { deps, calls, logs, users, row, created: () => created, lookedUpHash: () => lookedUpHash };
}

function post(body: unknown, headers: Record<string, string> = { "X-Invite-Secret": SECRET }) {
  return new Request("https://ref.supabase.co/functions/v1/invite-user", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function read(res: Response) {
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

/* ------------------------------------------------------------------ */
/* The handler                                                         */
/* ------------------------------------------------------------------ */

test("sha256Hex matches Postgres's encode(sha256(convert_to(token, 'UTF8')), 'hex')", async () => {
  assert.equal(await sha256Hex(TOKEN), createHash("sha256").update(TOKEN, "utf8").digest("hex"));
  // A known vector: sha256("abc").
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("timingSafeEqualStrings: equal only for identical strings, any lengths", async () => {
  assert.equal(await timingSafeEqualStrings("abc", "abc"), true);
  assert.equal(await timingSafeEqualStrings("abc", "abd"), false);
  assert.equal(await timingSafeEqualStrings("abc", "abcd"), false);
  assert.equal(await timingSafeEqualStrings("", "x"), false);
});

test("401 for a missing or wrong secret, and when the function has no secret set", async () => {
  for (const headers of [{}, { "X-Invite-Secret": "wrong" }, { "X-Invite-Secret": SECRET + "x" }] as Record<string, string>[]) {
    const f = fakeDeps();
    const r = await read(await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }, headers), f.deps));
    assert.deepEqual(r, { status: 401, body: { error: "unauthorized" } });
    assert.deepEqual(f.calls, [], "nothing is read before the secret checks out");
  }
  for (const secret of [undefined, ""]) {
    const f = fakeDeps();
    const r = await read(await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }, { "X-Invite-Secret": "" }), { ...f.deps, secret }));
    assert.equal(r.status, 401, "an unset secret refuses everything, even an empty header");
  }
});

test("405 for anything but POST", async () => {
  const f = fakeDeps();
  const res = await handleInvite(new Request("https://ref.supabase.co/functions/v1/invite-user", { headers: { "X-Invite-Secret": SECRET } }), f.deps);
  assert.equal(res.status, 405);
});

test("400 for a bad body", async () => {
  const bodies: unknown[] = [
    "not json",
    null,
    {},
    { token: TOKEN },
    { redirectTo: REDIRECT },
    { token: TOKEN.toUpperCase(), redirectTo: REDIRECT },
    { token: TOKEN.slice(1), redirectTo: REDIRECT },
    { token: TOKEN + "0", redirectTo: REDIRECT },
    { token: 42, redirectTo: REDIRECT },
    { token: TOKEN, redirectTo: 42 },
  ];
  for (const body of bodies) {
    const f = fakeDeps();
    const r = await read(await handleInvite(post(body === null ? "null" : body), f.deps));
    assert.deepEqual(r, { status: 400, body: { error: "bad_request" } }, JSON.stringify(body));
    assert.deepEqual(f.calls, []);
  }
});

test("400 for a redirect outside the allowed origins", async () => {
  const bad = ["https://evil.example/auth/confirm", "javascript:alert(1)", "not a url", "http://preview.vercel.app/x", "https://vercel.app/x", "https://user:pw@localhost/x"];
  for (const redirectTo of bad) {
    const f = fakeDeps();
    const r = await read(await handleInvite(post({ token: TOKEN, redirectTo }), f.deps));
    assert.equal(r.status, 400, redirectTo);
    assert.deepEqual(f.calls, []);
  }
  // With an allow list, only those origins pass, and localhost no longer does.
  const f = fakeDeps();
  f.deps.allowedOrigins = parseAllowedOrigins("https://college-stats-nine.vercel.app/ , https://quad.example");
  assert.equal((await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), f.deps)).status, 400);
  assert.equal((await handleInvite(post({ token: TOKEN, redirectTo: "https://other-preview.vercel.app/auth/confirm" }), f.deps)).status, 400);
  assert.equal((await handleInvite(post({ token: TOKEN, redirectTo: "https://quad.example/auth/confirm?next=/account" }), f.deps)).status, 200);
});

test("redirectAllowed and parseAllowedOrigins", () => {
  assert.equal(parseAllowedOrigins(undefined), null);
  assert.equal(parseAllowedOrigins(" , "), null);
  assert.deepEqual(parseAllowedOrigins("https://a.example/,https://b.example"), ["https://a.example", "https://b.example"]);
  assert.equal(redirectAllowed("https://college-stats-git-x-ray.vercel.app/auth/confirm", null), true);
  assert.equal(redirectAllowed("http://localhost:3004/auth/confirm", null), true);
  assert.equal(redirectAllowed("http://127.0.0.1:3000/auth/confirm", null), true);
  assert.equal(redirectAllowed("https://localhost.evil.example/auth/confirm", null), false);
  assert.equal(redirectAllowed("https://evil.example/?x=.vercel.app", null), false);
  assert.equal(redirectAllowed("https://a.example.evil/x", ["https://a.example"]), false);
});

test("404 when no pending, unexpired invitation matches the token", async () => {
  const cases: (InvitationRow | null)[] = [
    null,
    invitation({ accepted_at: "2026-10-05T00:00:00Z" }),
    invitation({ revoked_at: "2026-10-05T00:00:00Z" }),
    invitation({ expires_at: "2026-10-06T11:59:59Z" }),
  ];
  for (const row of cases) {
    const f = fakeDeps({ row });
    const r = await read(await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), f.deps));
    assert.deepEqual(r, { status: 404, body: { error: "invitation_not_found" } });
    assert.deepEqual(f.calls, ["find"], "no account is created for a dead invitation");
  }
});

test("creates a confirmed account with the invitation's details, records it, and returns the link", async () => {
  const f = fakeDeps();
  const r = await read(await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), f.deps));
  assert.equal(r.status, 200);
  assert.match(r.body.link, /^https:\/\/ref\.supabase\.co\/auth\/v1\/verify\?/);
  assert.ok(r.body.link.includes(encodeURIComponent(REDIRECT)), "the link lands on redirectTo");
  assert.equal(f.lookedUpHash(), createHash("sha256").update(TOKEN).digest("hex"));
  assert.deepEqual(f.created(), {
    email: "tracy@example.com",
    email_confirm: true,
    user_metadata: { display_name: "Tracy Ross", role_hint: "guardian", phone: "+16155550100", invitation_id: "inv-1" },
  });
  assert.equal(f.row?.accepted_by, "user-1", "accepted_by is the new user, for accept_invitation_by_id()");
  assert.deepEqual(f.calls, ["find", "createUser", "setAcceptedBy", "generateLink"]);
  const logged = f.logs.join("\n");
  for (const secretThing of [TOKEN, "LINKTOKEN", "tracy@example.com", SECRET]) assert.ok(!logged.includes(secretThing), `never logs ${secretThing}`);
});

test("a student invitation gets role_hint student and null name/phone pass through", async () => {
  const f = fakeDeps({ row: invitation({ side: "student", display_name: null, phone: null }) });
  assert.equal((await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), f.deps)).status, 200);
  assert.deepEqual(f.created()?.user_metadata, { display_name: null, role_hint: "student", phone: null, invitation_id: "inv-1" });
});

test("already registered, but it is the account this function created for this invitation: a fresh link (Copy link)", async () => {
  const f = fakeDeps({ row: invitation({ accepted_by: "user-9" }), existingUsers: [{ id: "user-9", email: "tracy@example.com" }] });
  const r = await read(await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), f.deps));
  assert.equal(r.status, 200);
  assert.ok(r.body.link);
  assert.deepEqual(f.calls, ["find", "createUser", "getUserById", "generateLink"]);
  assert.equal(f.row?.accepted_by, "user-9");

  // The same call twice in a row works too (first creates, second reuses).
  const g = fakeDeps();
  assert.equal((await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), g.deps)).status, 200);
  assert.equal((await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), g.deps)).status, 200);
  assert.equal(g.users.length, 1);
});

test("already registered otherwise: 409, and no link is minted", async () => {
  const cases = [
    fakeDeps({ existingUsers: [{ id: "user-9", email: "tracy@example.com" }] }), // nobody recorded
    fakeDeps({ row: invitation({ accepted_by: "user-8" }), existingUsers: [{ id: "user-9", email: "tracy@example.com" }] }), // recorded user gone
    fakeDeps({ row: invitation({ accepted_by: "user-8" }), existingUsers: [{ id: "user-8", email: "other@example.com" }, { id: "user-9", email: "tracy@example.com" }] }), // a different address
  ];
  for (const f of cases) {
    const r = await read(await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), f.deps));
    assert.deepEqual(r, { status: 409, body: { error: "already_registered" } });
    assert.ok(!f.calls.includes("generateLink"));
    assert.ok(!f.calls.includes("setAcceptedBy"));
  }
});

test("an invitation revoked while its account was being created: the account is removed, 404", async () => {
  const f = fakeDeps();
  f.deps.setAcceptedBy = async () => false;
  const r = await read(await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), f.deps));
  assert.equal(r.status, 404);
  assert.deepEqual(f.users, []);
});

test("Auth failures come back as 500 internal_error, never as a link", async () => {
  const f = fakeDeps({ generateFails: true });
  assert.deepEqual(await read(await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), f.deps)), { status: 500, body: { error: "internal_error" } });
  const g = fakeDeps();
  g.deps.createUser = async () => ({ ok: false, alreadyRegistered: false, error: "500 boom" });
  assert.equal((await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), g.deps)).status, 500);
  const h = fakeDeps();
  h.deps.findInvitationByHash = async () => {
    throw new Error("db down");
  };
  assert.equal((await handleInvite(post({ token: TOKEN, redirectTo: REDIRECT }), h.deps)).status, 500);
});

test("isAlreadyRegistered and pickSecretKey", () => {
  assert.equal(isAlreadyRegistered({ code: "email_exists", status: 422, message: "x" }), true);
  assert.equal(isAlreadyRegistered({ status: 422, message: "A user with this email address has already been registered" }), true);
  assert.equal(isAlreadyRegistered({ code: "unexpected_failure", status: 500, message: "Database error" }), false);
  assert.equal(isAlreadyRegistered(null), false);
  assert.equal(pickSecretKey({ SUPABASE_SECRET_KEYS: JSON.stringify({ other: "sb_secret_o", default: "sb_secret_d" }) }), "sb_secret_d");
  assert.equal(pickSecretKey({ SUPABASE_SECRET_KEYS: JSON.stringify({ other: "sb_secret_o" }) }), "sb_secret_o");
  assert.equal(pickSecretKey({ SUPABASE_SECRET_KEYS: "not json", SUPABASE_SERVICE_ROLE_KEY: "legacy" }), "legacy");
  assert.equal(pickSecretKey({}), null);
});

/* ------------------------------------------------------------------ */
/* The Node client (lib/invite-function.ts)                            */
/* ------------------------------------------------------------------ */

const ENV = { SUPABASE_URL: "https://ref.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", INVITE_FUNCTION_SECRET: SECRET };

test("inviteFunctionConfigured needs all three variables", () => {
  assert.equal(inviteFunctionConfigured(ENV), true);
  for (const key of Object.keys(ENV)) assert.equal(inviteFunctionConfigured({ ...ENV, [key]: "" }), false, key);
  assert.equal(inviteFunctionUrl("https://ref.supabase.co/"), "https://ref.supabase.co/functions/v1/invite-user");
});

test("mapInviteResponse", () => {
  assert.deepEqual(mapInviteResponse(200, { link: "https://ref.supabase.co/auth/v1/verify?x" }), { ok: true, link: "https://ref.supabase.co/auth/v1/verify?x" });
  assert.equal(mapInviteResponse(200, {}).ok, false);
  assert.equal(mapInviteResponse(200, { link: "javascript:x" }).ok, false);
  assert.deepEqual(mapInviteResponse(409, { error: "already_registered" }), { ok: false, reason: "already_registered" });
  assert.deepEqual(mapInviteResponse(404, { error: "invitation_not_found" }), { ok: false, reason: "not_found" });
  // A 404 without the function's code is the function missing (not deployed), not a missing invitation.
  assert.equal((mapInviteResponse(404, { code: "NOT_FOUND" }) as { reason: string }).reason, "error");
  assert.equal((mapInviteResponse(401, { error: "unauthorized" }) as { reason: string }).reason, "error");
  assert.equal((mapInviteResponse(500, null) as { reason: string }).reason, "error");
});

test("inviteUser: not_configured without the variables, and no request is made", async () => {
  let called = false;
  const r = await inviteUser({ token: TOKEN, redirectTo: REDIRECT }, { env: {}, fetch: (async () => { called = true; return new Response(); }) as typeof fetch });
  assert.deepEqual(r, { ok: false, reason: "not_configured" });
  assert.equal(called, false);
});

test("inviteUser: sends the publishable key, the shared secret, and the body; maps the answer", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ link: "https://ref.supabase.co/auth/v1/verify?t" }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await inviteUser({ token: TOKEN, redirectTo: REDIRECT }, { env: ENV, fetch: fakeFetch, log: () => {} });
  assert.deepEqual(r, { ok: true, link: "https://ref.supabase.co/auth/v1/verify?t" });
  const s = seen as unknown as { url: string; init: RequestInit };
  assert.equal(s.url, "https://ref.supabase.co/functions/v1/invite-user");
  assert.equal(s.init.method, "POST");
  const headers = s.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sb_publishable_x");
  assert.equal(headers["X-Invite-Secret"], SECRET);
  assert.deepEqual(JSON.parse(String(s.init.body)), { token: TOKEN, redirectTo: REDIRECT });

  const conflict = (async () => new Response(JSON.stringify({ error: "already_registered" }), { status: 409 })) as unknown as typeof fetch;
  assert.deepEqual(await inviteUser({ token: TOKEN, redirectTo: REDIRECT }, { env: ENV, fetch: conflict }), { ok: false, reason: "already_registered" });
});

test("inviteUser: network errors and timeouts are { ok: false, reason: 'error' }, and nothing secret is logged", async () => {
  const logs: string[] = [];
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const r = await inviteUser({ token: TOKEN, redirectTo: REDIRECT }, { env: ENV, fetch: down, log: (m) => logs.push(m) });
  assert.equal(r.ok, false);
  assert.equal((r as { reason: string }).reason, "error");

  const hang = ((_url: string, init: RequestInit) =>
    new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
  const t = await inviteUser({ token: TOKEN, redirectTo: REDIRECT }, { env: ENV, fetch: hang, timeoutMs: 20, log: (m) => logs.push(m) });
  assert.deepEqual(t, { ok: false, reason: "error", detail: "timed out" });

  const bad = (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
  assert.equal((await inviteUser({ token: TOKEN, redirectTo: REDIRECT }, { env: ENV, fetch: bad, log: (m) => logs.push(m) })).ok, false);
  const logged = logs.join("\n");
  assert.ok(!logged.includes(TOKEN) && !logged.includes(SECRET));
});

/* ------------------------------------------------------------------ */
/* Guard: lib/invite-function.ts is the only caller                    */
/* ------------------------------------------------------------------ */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** Files under app/, lib/, components/ (or the given files) that call the function by hand. */
function strayCallers(files: { path: string; text: string }[]): string[] {
  return files.filter((f) => f.path !== "lib/invite-function.ts" && /functions\/v1\/|x-invite-secret/i.test(f.text)).map((f) => f.path);
}

test("guard: only lib/invite-function.ts builds the function's URL or sends X-Invite-Secret", () => {
  const files = ["app", "lib", "components"].flatMap((d) => sourceFiles(join(ROOT, d))).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));
  assert.ok(files.some((f) => f.path === "lib/invite-function.ts"), "the scan sees lib/invite-function.ts");
  assert.deepEqual(strayCallers(files), []);
  // The guard fails when broken: a second caller is caught.
  assert.deepEqual(strayCallers([...files, { path: "app/household/actions.ts", text: 'fetch(`${url}/functions/v1/invite-user`, { headers: { "X-Invite-Secret": s } })' }]), ["app/household/actions.ts"]);
  assert.deepEqual(strayCallers([{ path: "lib/x.ts", text: 'headers["x-invite-secret"] = s' }]), ["lib/x.ts"]);
});

test("guard: the Deno function stays out of tsc and eslint, and keeps the gateway JWT check documented as off", () => {
  const tsconfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8")) as { exclude: string[] };
  assert.ok(tsconfig.exclude.includes("supabase/functions"));
  assert.match(readFileSync(join(ROOT, "eslint.config.mjs"), "utf8"), /"supabase\/functions\/\*\*"/);
  assert.match(readFileSync(join(ROOT, "supabase/config.toml"), "utf8"), /\[functions\.invite-user\]\s*\n(#.*\n)*verify_jwt = false/);
  const index = readFileSync(join(ROOT, "supabase/functions/invite-user/index.ts"), "utf8");
  assert.match(index, /Deno\.serve\(/);
  assert.match(index, /from "\.\/handler\.ts"/);
});
