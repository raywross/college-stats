/**
 * The admin console's shell and People pages (specs/product/admin.md "The console", "People"; app/admin/**,
 * components/admin/**, lib/admin/console*.ts): what each standing sees, the Server Actions' guards and their refusals in
 * plain words, the typed confirmations, the reset link kept out of logs and URLs, the student page's single access row,
 * the household notice, and no analytics under /admin. Runs the real action modules against a fake Supabase client and
 * a fake fetch; pages and components, which can't render under node:test, are checked by reading their source. Each
 * guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// Next.js server code needs `server-only`, next/navigation, next/cache, next/headers, `@/` paths, extensionless imports,
// and a Supabase client bound to the request's cookies. Stand in fakes for those (driven by `ui` below), resolving
// paths the way the bundler does. redirect() and notFound() throw what Next.js throws.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const dataModule = (src: string) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const FAKES: Record<string, string> = {
  "@/lib/supabase-server": "export function supabaseAuthEnv(){return globalThis.__ui.env} export async function createServerSupabase(o){return globalThis.__ui.client(o)}",
  "next/navigation":
    "export function redirect(u){const e=new Error('NEXT_REDIRECT');e.digest='NEXT_REDIRECT;replace;'+u+';307;';throw e} export function notFound(){const e=new Error('NEXT_HTTP_ERROR_FALLBACK;404');e.digest='NEXT_HTTP_ERROR_FALLBACK;404';throw e}",
  "next/cache": "export function refresh(){globalThis.__ui.refreshed++}",
  "next/headers": "export async function headers(){return globalThis.__ui.requestHeaders} export async function cookies(){return {getAll(){return []},set(){}}}",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return dataModule("export {}");
    if (FAKES[specifier]) return dataModule(FAKES[specifier]);
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const HH = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";
const STUDENT = "55555555-5555-4555-8555-555555555555";
const LINK = "https://project.supabase.co/auth/v1/verify?token=SECRET-TOKEN-123&type=recovery";

interface Ui {
  env: { url: string; key: string };
  claims: Record<string, unknown> | null;
  isAdmin: boolean | "missing";
  factors: { id: string; factor_type: string; status: string }[];
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  rpcErrors: Record<string, { message: string }>;
  rpcData: Record<string, unknown>;
  mfaCalls: string[];
  mfaVerifyError: { message: string } | null;
  refreshed: number;
  requestHeaders: Map<string, string>;
  fetchCalls: { url: string; body: Record<string, unknown>; authorization: string }[];
  fetchStatus: number;
  fetchAnswer: Record<string, unknown>;
  headers: Record<string, string>[];
  logs: string[];
}
const ui = { current: null as unknown as Ui };
function reset(over: Partial<Ui> = {}): Ui {
  ui.current = {
    env: { url: "https://x.supabase.co", key: "sb_publishable_x" },
    claims: { sub: ALICE, email: "alice@example.com", aal: "aal2" },
    isAdmin: true,
    factors: [],
    rpcCalls: [],
    rpcErrors: {},
    rpcData: {},
    mfaCalls: [],
    mfaVerifyError: null,
    refreshed: 0,
    requestHeaders: new Map([["origin", "https://quad.example"]]),
    fetchCalls: [],
    fetchStatus: 200,
    fetchAnswer: { ok: true },
    headers: [],
    logs: [],
    ...over,
  };
  return ui.current;
}
reset();

function fakeClient(options?: { headers?: Record<string, string> }) {
  const u = ui.current;
  if (options?.headers) u.headers.push(options.headers);
  return {
    auth: {
      getClaims: async () => (u.claims ? { data: { claims: u.claims }, error: null } : { data: null, error: { message: "Auth session missing" } }),
      getSession: async () => ({ data: { session: u.claims ? { access_token: "admin-access-token" } : null } }),
      mfa: {
        listFactors: async () => ({ data: { all: u.factors, totp: u.factors }, error: null }),
        unenroll: async ({ factorId }: { factorId: string }) => {
          u.mfaCalls.push(`unenroll ${factorId}`);
          u.factors = u.factors.filter((f) => f.id !== factorId);
          return { data: null, error: null };
        },
        enroll: async () => {
          u.mfaCalls.push("enroll");
          u.factors.push({ id: "new-factor", factor_type: "totp", status: "unverified" });
          return { data: { id: "new-factor", totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://x" } }, error: null };
        },
        challengeAndVerify: async ({ factorId, code }: { factorId: string; code: string }) => {
          u.mfaCalls.push(`verify ${factorId} ${code}`);
          return { data: null, error: u.mfaVerifyError };
        },
      },
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      if (name === "is_admin_any_aal") {
        if (u.isAdmin === "missing") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.is_admin_any_aal" } };
        return { data: u.isAdmin, error: null };
      }
      u.rpcCalls.push({ name, args });
      if (u.rpcErrors[name]) return { data: null, error: u.rpcErrors[name] };
      return { data: u.rpcData[name] ?? null, error: null };
    },
  };
}
(globalThis as unknown as { __ui: unknown }).__ui = {
  get env() {
    return ui.current.env;
  },
  client: fakeClient,
  get requestHeaders() {
    return ui.current.requestHeaders;
  },
  set refreshed(v: number) {
    ui.current.refreshed = v;
  },
  get refreshed() {
    return ui.current.refreshed;
  },
};

// The admin-auth function: record what the site sends it and answer from `ui`.
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
globalThis.fetch = (async (url: string, init: RequestInit) => {
  ui.current.fetchCalls.push({
    url: String(url),
    body: JSON.parse(String(init.body)),
    authorization: String((init.headers as Record<string, string>).Authorization),
  });
  return new Response(JSON.stringify(ui.current.fetchAnswer), { status: ui.current.fetchStatus, headers: { "content-type": "application/json" } });
}) as typeof fetch;

// Every console.* line, so tests can assert what is never logged.
for (const level of ["log", "warn", "error", "info"] as const) {
  console[level] = (...args: unknown[]) => {
    ui.current.logs.push(args.map(String).join(" "));
  };
}

const consoleLib = await import("../lib/admin/console.ts");
const adminAuth = await import("../lib/admin/auth.ts");
const constants = await import("../lib/admin/constants.ts");
const people = await import("../lib/admin/people.ts");
const analytics = await import("../lib/analytics.ts");
const peopleActions = await import("../app/admin/people/actions.ts");
const householdActions = await import("../app/admin/households/[id]/actions.ts");
const studentActions = await import("../app/admin/students/[id]/actions.ts");
const adminsActions = await import("../app/admin/admins/actions.ts");
const mfaActions = await import("../app/admin/mfa/actions.ts");
const { HOUSEHOLD_ERRORS } = await import("../lib/household-rules.ts");

const { IDLE } = consoleLib;
type State = Awaited<ReturnType<typeof peopleActions.editProfile>>;

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

/** The session this page is called with. */
const asAdmin = (over: Partial<Ui> = {}) => reset({ claims: { sub: ALICE, email: "alice@example.com", aal: "aal2" }, isAdmin: true, ...over });

const errorText = (s: State) => (s.status === "error" ? s.message : "");

/* ------------------------------------------------------------------ */
/* What each standing sees                                             */
/* ------------------------------------------------------------------ */

const FACTOR = { id: "f1", factor_type: "totp", status: "verified" };
const STANDINGS: [label: string, setup: () => Ui, shell: string][] = [
  ["signed out", () => reset({ claims: null, isAdmin: false }), "not-found"],
  ["a signed-in non-admin", () => reset({ isAdmin: false }), "not-found"],
  ["an admin at aal1 who has not enrolled", () => reset({ claims: { sub: ALICE, aal: "aal1" }, isAdmin: true }), "mfa:new"],
  ["an admin at aal1 who has a factor", () => reset({ claims: { sub: ALICE, aal: "aal1" }, isAdmin: true, factors: [FACTOR] }), "mfa:enrolled"],
  ["before the admin migration", () => reset({ isAdmin: "missing" }), "setup"],
  ["an admin at aal2", () => reset({ isAdmin: true }), "console"],
];

type Table = (state: Awaited<ReturnType<typeof adminAuth.adminState>>) => ReturnType<typeof consoleLib.shellFor>;

/** Standings the layout's table sends to the wrong shell: the real adminState() for each session, into `table`. */
async function shellProblems(table: Table): Promise<string[]> {
  const problems: string[] = [];
  for (const [label, setup, expected] of STANDINGS) {
    setup();
    const s = table(await adminAuth.adminState());
    const got = s.shell === "mfa" ? `mfa:${s.enrolled ? "enrolled" : "new"}` : s.shell;
    if (got !== expected) problems.push(`${label}: ${got}`);
  }
  return problems;
}

test("the layout's table: 404 signed out and for a non-admin, the MFA step at aal1, a setup notice, the console at aal2", async () => {
  assert.deepEqual(await shellProblems(consoleLib.shellFor), []);
});

test("guard: a layout table that lets an aal1 admin or an unmigrated project into the console is caught", async () => {
  const lenient: Table = (state) => (state.kind === "not-admin" ? { shell: "not-found" } : { shell: "console" });
  assert.deepEqual(await shellProblems(lenient), [
    "an admin at aal1 who has not enrolled: console",
    "an admin at aal1 who has a factor: console",
    "before the admin migration: console",
  ]);
});


test("app/admin/layout.tsx renders by the table: notFound, the setup notice, the MFA step in place of the pages, the rail", () => {
  const layout = read("app/admin/layout.tsx");
  assert.match(layout, /shellFor\(await adminState\(\)\)/);
  assert.match(layout, /shell\.shell === "not-found"\) notFound\(\)/);
  assert.match(layout, /shell\.shell === "mfa"\) return <MfaStep enrolled=\{shell\.enrolled\} \/>/);
  // The pages render only below the guards, inside the rail.
  assert.ok(layout.indexOf("notFound()") < layout.indexOf("{children}") && layout.indexOf("<MfaStep") < layout.indexOf("{children}"));
  assert.match(layout, /robots: \{ index: false, follow: false \}/);
});

/* ------------------------------------------------------------------ */
/* Every page, action, and route checks the admin                      */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}
const adminFiles = walk("app/admin");
const pages = adminFiles.filter((f) => /\/page\.tsx$/.test(f));

/** Pages (and route handlers) that don't call requireAdmin(). */
function unguarded(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, src]) => !/\bawait requireAdmin\(\)|\bconst me = await requireAdmin\(\)/.test(src))
    .map(([f]) => f);
}

test("every /admin page and route handler calls requireAdmin() itself (the layout is not the guard)", () => {
  const files = Object.fromEntries([...pages, ...adminFiles.filter((f) => /\/route\.ts$/.test(f))].map((f) => [f, read(f)]));
  assert.ok(Object.keys(files).length >= 8, Object.keys(files).join(", "));
  assert.deepEqual(unguarded(files), []);
});

test("guard: a page that forgets requireAdmin() is caught", () => {
  const files = Object.fromEntries(pages.map((f) => [f, read(f)]));
  files["app/admin/log/page.tsx"] = files["app/admin/log/page.tsx"].replace("await requireAdmin();", "");
  assert.deepEqual(unguarded(files), ["app/admin/log/page.tsx"]);
});

/** Exported actions that don't go through withAdmin (or, for the MFA step, adminState). */
function unguardedActions(src: string, guard: RegExp): string[] {
  const parts = src.split(/^export async function /m).slice(1);
  return parts.filter((p) => !guard.test(p.slice(0, p.indexOf("\n}\n") + 3))).map((p) => p.slice(0, p.indexOf("(")));
}

test("every Server Action goes through withAdmin() (an admin at aal2), and the MFA actions through adminState()", () => {
  for (const f of adminFiles.filter((f) => /\/actions\.ts$/.test(f))) {
    const src = read(f);
    assert.match(src, /^"use server";/);
    // Operations' actions call requireAdmin() first (an admin at aal2, else a 404; tests/admin-ops.test.mts proves it
    // runs before the form is read), the same gate as withAdmin() with a 404 for a stale tab instead of a message.
    const guard = f.includes("/mfa/") ? /adminState\(\)/ : f.includes("/operations/") ? /await requireAdmin\(\)/ : /return withAdmin\(/;
    assert.deepEqual(unguardedActions(src, guard), [], f);
  }
});

test("guard: an action that skips withAdmin() is caught", () => {
  const src = read("app/admin/admins/actions.ts").replace('return withAdmin("admin revoke", async (ctx) => {', "return (async (ctx: any) => {");
  assert.deepEqual(unguardedActions(src, /return withAdmin\(/), ["revokeAdmin"]);
});

const ACTIONS: [name: string, run: (f: FormData) => Promise<State>, fields: Record<string, string>][] = [
  ["editProfile", (f) => peopleActions.editProfile(IDLE, f), { user: BOB, display_name: "Bob" }],
  ["changeEmail", (f) => peopleActions.changeEmail(IDLE, f), { user: BOB, email: "b@example.com", email_again: "b@example.com" }],
  ["copyResetLink", (f) => peopleActions.copyResetLink(IDLE, f), { user: BOB }],
  ["sendResetEmail", (f) => peopleActions.sendResetEmail(IDLE, f), { user: BOB }],
  ["signOutEverywhere", (f) => peopleActions.signOutEverywhere(IDLE, f), { user: BOB }],
  ["deactivate", (f) => peopleActions.deactivate(IDLE, f), { user: BOB, reason: "asked to" }],
  ["reactivate", (f) => peopleActions.reactivate(IDLE, f), { user: BOB }],
  ["deleteAccount", (f) => peopleActions.deleteAccount(IDLE, f), { user: BOB, confirm: "delete" }],
  ["restoreAccount", (f) => peopleActions.restoreAccount(IDLE, f), { user: BOB }],
  ["deleteNow", (f) => peopleActions.deleteNow(IDLE, f), { user: BOB, confirm: "bob@example.com" }],
  ["renameHousehold", (f) => householdActions.renameHousehold(IDLE, f), { household: HH, name: "Smiths" }],
  ["addToHousehold", (f) => householdActions.addToHousehold(IDLE, f), { household: HH, user: BOB }],
  ["removeMember", (f) => householdActions.removeMember(IDLE, f), { member: MEMBER, confirm: "remove" }],
  ["cancelInvitation", (f) => householdActions.cancelInvitation(IDLE, f), { invitation: MEMBER }],
  ["closeHousehold", (f) => householdActions.closeHousehold(IDLE, f), { household: HH }],
  ["editStudent", (f) => studentActions.editStudent(IDLE, f), { student: STUDENT, display_name: "Alex" }],
  ["attachStudent", (f) => studentActions.attachStudent(IDLE, f), { student: STUDENT, user: BOB }],
  ["deleteStudent", (f) => studentActions.deleteStudent(IDLE, f), { student: STUDENT, confirm: "delete" }],
  ["grantAdmin", (f) => adminsActions.grantAdmin(IDLE, f), { user: BOB }],
  ["revokeAdmin", (f) => adminsActions.revokeAdmin(IDLE, f), { user: BOB }],
];

test("a signed-out person, a non-admin, and an admin at aal1 are turned away by every action: no database call, no admin-auth call", async () => {
  const standings: [string, Partial<Ui>][] = [
    ["signed out", { claims: null, isAdmin: false }],
    ["non-admin", { isAdmin: false }],
    ["admin at aal1", { claims: { sub: ALICE, aal: "aal1" }, isAdmin: true }],
  ];
  for (const [label, over] of standings) {
    for (const [name, run, fields] of ACTIONS) {
      reset(over);
      const got = await run(form(fields));
      assert.equal(errorText(got), consoleLib.SESSION_ENDED_MESSAGE, `${name} as ${label}`);
      assert.equal(ui.current.rpcCalls.length, 0, `${name} as ${label} called the database`);
      assert.equal(ui.current.fetchCalls.length, 0, `${name} as ${label} called admin-auth`);
    }
  }
});

test("an admin at aal2 gets through: each action reaches its one database function or admin-auth operation", async () => {
  const expected: Record<string, string> = {
    editProfile: "rpc admin_update_profile",
    changeEmail: "auth set_email",
    copyResetLink: "auth recovery_link",
    sendResetEmail: "auth recovery_email",
    signOutEverywhere: "auth sign_out",
    deactivate: "auth suspend",
    reactivate: "auth unsuspend",
    deleteAccount: "rpc admin_delete_account",
    restoreAccount: "rpc admin_restore_account",
    renameHousehold: "rpc admin_update_household",
    addToHousehold: "rpc admin_link",
    removeMember: "rpc admin_unlink",
    cancelInvitation: "rpc admin_revoke_invitation",
    closeHousehold: "rpc admin_close_household",
    editStudent: "rpc admin_update_student",
    attachStudent: "rpc admin_claim_student",
    deleteStudent: "rpc admin_delete_student",
    grantAdmin: "rpc admin_grant",
    revokeAdmin: "rpc admin_revoke",
  };
  for (const [name, run, fields] of ACTIONS) {
    if (name === "deleteNow") continue; // redirects; covered below
    asAdmin({ fetchAnswer: { ok: true, link: LINK } });
    const got = await run(form(fields));
    assert.equal(got.status, "done", `${name}: ${JSON.stringify(got)}`);
    const first = ui.current.rpcCalls[0]?.name ? `rpc ${ui.current.rpcCalls[0].name}` : `auth ${ui.current.fetchCalls[0]?.body.op}`;
    assert.equal(first, expected[name], name);
  }
});

/* ------------------------------------------------------------------ */
/* Refusals in plain words                                             */
/* ------------------------------------------------------------------ */

test("every refusal the admin migration can raise has readable text (no raw error code reaches the page)", () => {
  const sql = read("supabase/migrations/20261012200000_admin.sql");
  const raised = [...new Set([...sql.matchAll(/raise exception '([a-z_ ]+)'/g)].map((m) => m[1]))];
  const INTERNAL = new Set(["profiles_suspension_immutable", "invalid_action"]); // triggers and service-role paths, never shown
  const missing = raised.filter((code) => !INTERNAL.has(code) && !(code in { ...HOUSEHOLD_ERRORS, ...constants.ADMIN_ERRORS }));
  assert.deepEqual(missing, []);
  for (const code of raised.filter((c) => !INTERNAL.has(c))) {
    const text = consoleLib.adminErrorMessage({ message: code });
    assert.notEqual(text, consoleLib.ADMIN_FAILED, code);
    assert.ok(!text.includes("_"), `${code}: ${text}`);
  }
  assert.equal(consoleLib.adminErrorMessage({ message: "connection reset" }), consoleLib.ADMIN_FAILED);
});

test("guard: a refusal missing from the map falls back to the generic text (so the check above would catch it)", () => {
  assert.equal(consoleLib.adminErrorMessage({ message: "a_code_nobody_mapped" }), consoleLib.ADMIN_FAILED);
});

test("every admin-auth failure has readable text, and 'email not set up' points to Copy reset link", () => {
  for (const reason of Object.keys(consoleLib.ADMIN_AUTH_ERRORS) as (keyof typeof consoleLib.ADMIN_AUTH_ERRORS)[]) {
    const text = consoleLib.authFailureMessage({ ok: false, reason });
    assert.ok(text.length > 10 && !text.includes("_"), `${reason}: ${text}`);
  }
  assert.match(consoleLib.authFailureMessage({ ok: false, reason: "not_configured", detail: "email_not_configured" }), /Copy reset link/);
  assert.match(consoleLib.authFailureMessage({ ok: false, reason: "email_taken" }), /already uses/);
});

test("actions turn the database's refusals into the plain words, naming the way out", async () => {
  const cases: [run: (f: FormData) => Promise<State>, fields: Record<string, string>, rpc: string, code: string, says: RegExp][] = [
    [(f) => householdActions.removeMember(IDLE, f), { member: MEMBER, confirm: "remove" }, "admin_unlink", "last_guardian_of_managed", /Add another guardian.*delete the student's record/],
    [(f) => householdActions.addToHousehold(IDLE, f), { household: HH, user: BOB, can_edit: "on" }, "admin_link", "household_full", /full/],
    [(f) => householdActions.addToHousehold(IDLE, f), { household: HH, student: STUDENT }, "admin_link", "already_member", /already in this household/],
    [(f) => householdActions.closeHousehold(IDLE, f), { household: HH }, "admin_close_household", "household_not_empty", /empty household/],
    [(f) => peopleActions.deleteAccount(IDLE, f), { user: BOB, confirm: "delete" }, "admin_delete_account", "revoke_admin_first", /Revoke their admin access first/],
    [(f) => studentActions.attachStudent(IDLE, f), { student: STUDENT, user: BOB }, "admin_claim_student", "user_has_student", /already has their own student record/],
    [(f) => studentActions.deleteStudent(IDLE, f), { student: STUDENT, confirm: "delete" }, "admin_delete_student", "student_has_account", /belongs to an account/],
    [(f) => adminsActions.revokeAdmin(IDLE, f), { user: ALICE }, "admin_revoke", "cannot_revoke_self", /own admin access/],
    [(f) => adminsActions.revokeAdmin(IDLE, f), { user: BOB }, "admin_revoke", "last_admin", /last admin/],
    [(f) => adminsActions.grantAdmin(IDLE, f), { user: BOB }, "admin_grant", "already_admin", /already an admin/],
    [(f) => peopleActions.restoreAccount(IDLE, f), { user: BOB }, "admin_restore_account", "not_deleted", /isn't scheduled for deletion/],
  ];
  for (const [run, fields, rpc, code, says] of cases) {
    asAdmin({ rpcErrors: { [rpc]: { message: code } } });
    const got = await run(form(fields));
    assert.equal(got.status, "error", code);
    assert.match(errorText(got), says, code);
    assert.equal(ui.current.refreshed, 0, `${code} refreshed the page after a refusal`);
  }
});

test("a refusal's log line names the action and the code, and nothing else", async () => {
  asAdmin({ rpcErrors: { admin_unlink: { message: "last_guardian_of_managed" } } });
  await householdActions.removeMember(IDLE, form({ member: MEMBER, confirm: "remove" }));
  assert.deepEqual(ui.current.logs, ["admin: household unlink failed: last_guardian_of_managed"]);
});

test("a thrown error becomes the generic message, not its text", async () => {
  asAdmin();
  // The console client (with its header) is the second client a request makes; the first one reads the session.
  (globalThis as unknown as { __ui: { client: unknown } }).__ui.client = (o?: { headers?: Record<string, string> }) => {
    if (o?.headers) throw new Error("secret internal detail with bob@example.com");
    return fakeClient(o);
  };
  try {
    const got = await peopleActions.editProfile(IDLE, form({ user: BOB, display_name: "Bob" }));
    assert.equal(errorText(got), consoleLib.ADMIN_FAILED);
    assert.ok(!errorText(got).includes("bob@example.com"));
  } finally {
    (globalThis as unknown as { __ui: { client: unknown } }).__ui.client = fakeClient;
  }
});

/* ------------------------------------------------------------------ */
/* Typed confirmations                                                 */
/* ------------------------------------------------------------------ */

test("typedMatches: the word or address, ignoring case and surrounding spaces, and nothing else", () => {
  assert.ok(consoleLib.typedMatches("delete", "delete"));
  assert.ok(consoleLib.typedMatches("  DELETE ", "delete"));
  assert.ok(consoleLib.typedMatches("Bob@Example.com", "bob@example.com"));
  assert.ok(!consoleLib.typedMatches("delet", "delete"));
  assert.ok(!consoleLib.typedMatches("delete it", "delete"));
  assert.ok(!consoleLib.typedMatches("", "delete"));
  assert.ok(!consoleLib.typedMatches(null, "delete"));
  // An empty expectation never matches: a missing email can't be satisfied by typing nothing.
  assert.ok(!consoleLib.typedMatches("", ""));
});

test("the typed confirmation is enforced by the action too: a forged form without it changes nothing", async () => {
  const gated: [string, (f: FormData) => Promise<State>, Record<string, string>][] = [
    ["deleteAccount", (f) => peopleActions.deleteAccount(IDLE, f), { user: BOB }],
    ["deleteAccount (wrong word)", (f) => peopleActions.deleteAccount(IDLE, f), { user: BOB, confirm: "yes" }],
    ["removeMember", (f) => householdActions.removeMember(IDLE, f), { member: MEMBER }],
    ["removeMember (wrong word)", (f) => householdActions.removeMember(IDLE, f), { member: MEMBER, confirm: "delete" }],
    ["deleteStudent", (f) => studentActions.deleteStudent(IDLE, f), { student: STUDENT, confirm: "remove" }],
  ];
  for (const [label, run, fields] of gated) {
    asAdmin();
    const got = await run(form(fields));
    assert.equal(got.status, "error", label);
    assert.match(errorText(got), /to confirm/, label);
    assert.equal(ui.current.rpcCalls.length, 0, label);
    assert.equal(ui.current.fetchCalls.length, 0, label);
  }
});

test("Delete now: the account's own email is the word, read by the action (a forged form can't pick it); then the purge, then the people list", async () => {
  asAdmin({ rpcData: { admin_user_auth: [{ email: "bob@example.com" }] } });
  const wrong = await peopleActions.deleteNow(IDLE, form({ user: BOB, confirm: "delete" }));
  assert.match(errorText(wrong), /email address exactly/);
  assert.equal(ui.current.fetchCalls.length, 0);

  asAdmin({ rpcData: { admin_user_auth: [{ email: "bob@example.com" }] } });
  await assert.rejects(peopleActions.deleteNow(IDLE, form({ user: BOB, confirm: " Bob@Example.com " })), (err: Error & { digest?: string }) => {
    assert.match(err.digest ?? "", /^NEXT_REDIRECT;replace;\/admin\/people;/);
    return true;
  });
  assert.deepEqual(ui.current.fetchCalls.map((c) => [c.body.op, c.body.user]), [["purge", BOB]]);

  // An account with no email is confirmed by the word "delete".
  asAdmin({ rpcData: { admin_user_auth: [{ email: null }] } });
  assert.match(errorText(await peopleActions.deleteNow(IDLE, form({ user: BOB, confirm: "x" }))), /Type "delete"/);
});

test("Delete account also signs them out: the database delete, then admin-auth sign_out; a failed sign-out is reported, not hidden", async () => {
  asAdmin();
  const ok = await peopleActions.deleteAccount(IDLE, form({ user: BOB, confirm: "delete" }));
  assert.equal(ok.status, "done");
  assert.deepEqual(ui.current.rpcCalls.map((c) => c.name), ["admin_delete_account"]);
  assert.deepEqual(ui.current.fetchCalls.map((c) => [c.body.op, c.body.user]), [["sign_out", BOB]]);
  assert.equal(ui.current.fetchCalls[0].authorization, "Bearer admin-access-token");

  asAdmin({ fetchStatus: 500, fetchAnswer: { error: "internal_error" } });
  const warned = await peopleActions.deleteAccount(IDLE, form({ user: BOB, confirm: "delete" }));
  assert.equal(warned.status, "done");
  assert.match(warned.status === "done" ? (warned.message ?? "") : "", /Account deleted\. Signing them out everywhere didn't finish/);

  // Refused by the database (an admin account): nothing signed out.
  asAdmin({ rpcErrors: { admin_delete_account: { message: "revoke_admin_first" } } });
  assert.equal((await peopleActions.deleteAccount(IDLE, form({ user: BOB, confirm: "delete" }))).status, "error");
  assert.equal(ui.current.fetchCalls.length, 0);
});

test("guard: a Delete account that skips the sign-out is caught by the check on the source", () => {
  const step = (src: string) => /admin_delete_account[\s\S]*op: "sign_out"/.test(src);
  const src = read("app/admin/people/actions.ts");
  assert.ok(step(src));
  assert.ok(!step(src.replace('op: "sign_out", user }, ""', 'op: "unsuspend", user }, ""')));
});

test("Remove a person, Delete account, Delete now, and Delete the record use ConfirmTyped; no other action does", () => {
  const person = read("app/admin/people/[user]/page.tsx");
  const hh = read("app/admin/households/[id]/page.tsx");
  const student = read("app/admin/students/[id]/page.tsx");
  assert.match(person, /<ConfirmTyped\s+action=\{deleteAccount\}[\s\S]*?expected=\{CONFIRM_DELETE\}/);
  assert.match(person, /<ConfirmTyped\s+action=\{deleteNow\}[\s\S]*?expected=\{email \?\? CONFIRM_DELETE\}/);
  assert.match(person, /<ConfirmTyped\s+action=\{removeMember\}[\s\S]*?expected=\{CONFIRM_REMOVE\}/);
  assert.match(hh, /<ConfirmTyped\s+action=\{removeMember\}[\s\S]*?expected=\{CONFIRM_REMOVE\}/);
  assert.match(student, /<ConfirmTyped\s+action=\{deleteStudent\}[\s\S]*?expected=\{CONFIRM_DELETE_RECORD\}/);
  for (const [name, src] of [["person", person], ["household", hh], ["student", student]]) {
    const used = [...src.matchAll(/<ConfirmTyped\s+action=\{(\w+)\}/g)].map((m) => m[1]);
    assert.deepEqual(used.filter((a) => !["deleteAccount", "deleteNow", "removeMember", "deleteStudent"].includes(a)), [], name);
  }
});

test("the typed field gates the button: disabled until typedMatches, in the component every typed action renders", () => {
  const form2 = read("components/admin/AdminForm.tsx");
  assert.match(form2, /const ready = typed \? typedMatches\(typedValue, typed\.expected\) : true;/);
  assert.match(form2, /disabled=\{pending \|\| !ready\}/);
  assert.match(form2, /name="confirm"/);
  assert.match(read("components/admin/ConfirmTyped.tsx"), /typed=\{\{ expected, instruction \}\}/);
  // Guard: with the gate removed the same pattern fails.
  assert.doesNotMatch(form2.replace("disabled={pending || !ready}", "disabled={pending}"), /disabled=\{pending \|\| !ready\}/);
});

/* ------------------------------------------------------------------ */
/* Copy reset link, and what is never logged                           */
/* ------------------------------------------------------------------ */

test("Copy reset link returns the link in the action's state only: not logged, not redirected to, not stored", async () => {
  asAdmin({ fetchAnswer: { ok: true, link: LINK } });
  const got = await peopleActions.copyResetLink(IDLE, form({ user: BOB }));
  assert.equal(got.status, "done");
  assert.equal(got.status === "done" ? got.link : null, LINK);
  assert.deepEqual(ui.current.fetchCalls.map((c) => c.body.op), ["recovery_link"]);
  assert.equal(ui.current.fetchCalls[0].body.redirect_to, "https://quad.example/auth/confirm?next=%2Faccount%2Fpassword");
  assert.deepEqual(ui.current.logs, [], "nothing is logged");
  assert.ok(!JSON.stringify(ui.current.rpcCalls).includes("SECRET-TOKEN"), "the link never reaches the database");

  // A failure is logged without the link or the address.
  asAdmin({ fetchStatus: 500, fetchAnswer: { error: "internal_error", detail: "boom" } });
  const failed = await peopleActions.copyResetLink(IDLE, form({ user: BOB }));
  assert.equal(failed.status, "error");
  assert.ok((ui.current.logs as string[]).every((l) => !l.includes("SECRET-TOKEN") && !l.includes("@")), (ui.current.logs as string[]).join("\n"));
});

test("the link is shown from component state once, and is never put in a URL, a storage key, or a log call", () => {
  const src = read("components/admin/AdminForm.tsx");
  assert.match(src, /state\.link && !hiddenLink/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|router\.(push|replace)|searchParams|location\.(href|search)/);
  for (const f of adminFiles.concat(["lib/admin/console-actions.ts"])) {
    const text = read(f);
    assert.doesNotMatch(text, /redirect\([^)]*\blink\b/, f);
    assert.doesNotMatch(text, /console\.\w+\([^)]*\blink\b/, f);
  }
});

test("no console call in the console's code interpolates an email, a reset link, or a typed confirmation", () => {
  const files = [...adminFiles.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")), "lib/admin/console-actions.ts", "lib/admin/console-reads.ts", ...walk("components/admin")];
  for (const f of files) {
    for (const line of read(f).split("\n")) {
      if (!/console\.(log|warn|error|info)\(/.test(line)) continue;
      assert.doesNotMatch(line, /email|\blink\b|confirm|reason|token/i, `${f}: ${line.trim()}`);
    }
  }
});

test("Change email sends the typed-twice address and the re-point choice; a mismatch or bad address never leaves the site", async () => {
  asAdmin();
  const ok = await peopleActions.changeEmail(IDLE, form({ user: BOB, email: "New@Example.com", email_again: "new@example.com ", repoint: "on" }));
  assert.equal(ok.status, "done");
  assert.deepEqual(ui.current.fetchCalls[0].body, { op: "set_email", user: BOB, request_id: ui.current.fetchCalls[0].body.request_id, email: "new@example.com", repoint_invitations: true });
  assert.deepEqual(ui.current.logs, []);

  for (const fields of [{ email: "a@example.com", email_again: "b@example.com" }, { email: "nope", email_again: "nope" }, { email: "", email_again: "" }]) {
    asAdmin();
    const got = await peopleActions.changeEmail(IDLE, form({ user: BOB, ...fields }));
    assert.equal(got.status, "error");
    assert.equal(ui.current.fetchCalls.length, 0);
  }
  asAdmin({ fetchStatus: 409, fetchAnswer: { error: "email_taken" } });
  assert.match(errorText(await peopleActions.changeEmail(IDLE, form({ user: BOB, email: "a@example.com", email_again: "a@example.com" }))), /already uses/);
});

test("Deactivate needs a reason and sends it to admin-auth (which logs it); Reactivate needs none", async () => {
  asAdmin();
  assert.match(errorText(await peopleActions.deactivate(IDLE, form({ user: BOB, reason: " " }))), /Say why/);
  assert.equal(ui.current.fetchCalls.length, 0);
  asAdmin();
  assert.equal((await peopleActions.deactivate(IDLE, form({ user: BOB, reason: "Asked by a parent" }))).status, "done");
  assert.deepEqual(ui.current.fetchCalls[0].body.reason, "Asked by a parent");
  assert.deepEqual(ui.current.logs, []);
});

test("Send reset email says Copy reset link is the way until email exists", async () => {
  asAdmin({ fetchStatus: 400, fetchAnswer: { error: "email_not_configured" } });
  assert.match(errorText(await peopleActions.sendResetEmail(IDLE, form({ user: BOB }))), /Copy reset link/);
});

/* ------------------------------------------------------------------ */
/* Forms: edits, links                                                 */
/* ------------------------------------------------------------------ */

test("Edit details sends the four keys; a blank birth year is left alone; a phone is stored in E.164; a bad one is refused", async () => {
  asAdmin();
  await peopleActions.editProfile(IDLE, form({ user: BOB, display_name: " Bob ", birth_year: "", role_hint: "guardian", phone: "(615) 555-0100" }));
  assert.deepEqual(ui.current.rpcCalls[0], {
    name: "admin_update_profile",
    args: { p_user: BOB, p_patch: { display_name: "Bob", role_hint: "guardian", phone: "+16155550100" } },
  });
  for (const fields of [{ birth_year: "08" }, { birth_year: "2999" }, { role_hint: "admin" }, { phone: "12" }, { display_name: "x".repeat(81) }] as Record<string, string>[]) {
    asAdmin();
    const got = await peopleActions.editProfile(IDLE, form({ user: BOB, ...fields }));
    assert.equal(got.status, "error", JSON.stringify(fields));
    assert.equal(ui.current.rpcCalls.length, 0);
  }
  asAdmin();
  assert.equal((await peopleActions.editProfile(IDLE, form({ display_name: "Bob" }))).status, "error"); // no user id
});

test("Add to a household: a parent's can-edit box is read as sent (unticked sends nothing); a student or a user, never both or neither", async () => {
  asAdmin();
  await householdActions.addToHousehold(IDLE, form({ household: HH, user: BOB, can_edit: "on" }));
  assert.deepEqual(ui.current.rpcCalls[0].args, { p_household: HH, p_student: null, p_user: BOB, p_can_edit: true });
  asAdmin();
  await householdActions.addToHousehold(IDLE, form({ household: HH, user: BOB }));
  assert.equal(ui.current.rpcCalls[0].args.p_can_edit, false);
  asAdmin();
  await householdActions.addToHousehold(IDLE, form({ household: HH, student: STUDENT }));
  assert.deepEqual(ui.current.rpcCalls[0].args, { p_household: HH, p_student: STUDENT, p_user: null });
  for (const fields of [{ household: HH }, { household: HH, user: BOB, student: STUDENT }, { user: BOB }, { household: "nope", user: BOB }] as Record<string, string>[]) {
    asAdmin();
    assert.equal((await householdActions.addToHousehold(IDLE, form(fields))).status, "error");
    assert.equal(ui.current.rpcCalls.length, 0);
  }
});

test("moveWarning names the household the person is leaving, and is silent for someone not elsewhere", () => {
  const other = "99999999-9999-4999-8999-999999999999";
  assert.match(consoleLib.moveWarning("Jordan", "Rivera", other, HH) ?? "", /^Jordan is in the household “Rivera”\. Adding them here moves them out of it/);
  assert.equal(consoleLib.moveWarning("Jordan", "Rivera", HH, HH), null);
  assert.equal(consoleLib.moveWarning("Jordan", null, null, HH), null);
  const page = read("app/admin/households/[id]/page.tsx");
  assert.match(page, /moveWarning\(row\.name, row\.household, row\.household_id, household\.id\)/);
  assert.match(page, /trigger=\{warning \? "Move here"/);
});

test("Rename needs a name; Close household and Cancel invitation are one call each", async () => {
  asAdmin();
  assert.equal((await householdActions.renameHousehold(IDLE, form({ household: HH, name: "  " }))).status, "error");
  assert.equal(ui.current.rpcCalls.length, 0);
  asAdmin();
  assert.equal((await householdActions.renameHousehold(IDLE, form({ household: HH, name: " The Riveras " }))).status, "done");
  assert.deepEqual(ui.current.rpcCalls[0], { name: "admin_update_household", args: { p_household: HH, p_patch: { name: "The Riveras" } } });
});

test("Edit a student record: name, a sensible grad year, a phone", async () => {
  const year = new Date().getFullYear();
  asAdmin();
  await studentActions.editStudent(IDLE, form({ student: STUDENT, display_name: "Alex", grad_year: String(year + 2), phone: "" }));
  assert.deepEqual(ui.current.rpcCalls[0].args, { p_student: STUDENT, p_patch: { display_name: "Alex", grad_year: year + 2, phone: null } });
  asAdmin();
  assert.equal((await studentActions.editStudent(IDLE, form({ student: STUDENT, grad_year: "1999" }))).status, "error");
  assert.equal(ui.current.rpcCalls.length, 0);
});

/* ------------------------------------------------------------------ */
/* The student page logs access once                                   */
/* ------------------------------------------------------------------ */

test("logStudentView records one access row through admin_log_access, with a fixed label and no free text", async () => {
  asAdmin();
  await people.logStudentView(STUDENT, consoleLib.STUDENT_PAGE_VIEW);
  assert.deepEqual(ui.current.rpcCalls, [{ name: "admin_log_access", args: { p_student: STUDENT, p_what: "student page" } }]);
  assert.ok(!consoleLib.STUDENT_PAGE_VIEW.includes("@"));
  // For a non-admin it is a 404 before any call.
  reset({ isAdmin: false });
  await assert.rejects(people.logStudentView(STUDENT, "x"), /NEXT_HTTP_ERROR_FALLBACK|404|Error/);
  assert.equal(ui.current.rpcCalls.length, 0);
});

/** The page logs once, first, and only then reads the student's data. */
function logsOnceBeforeReading(src: string): boolean {
  const calls = [...src.matchAll(/logStudentView\(/g)].length;
  const logAt = src.indexOf("await logStudentView(");
  const readAt = src.indexOf("await adminStudent(");
  return calls === 1 && logAt > 0 && readAt > logAt;
}

test("the student page calls logStudentView() exactly once per render, before it reads anything, and a missing student is a 404", () => {
  const page = read("app/admin/students/[id]/page.tsx");
  assert.ok(logsOnceBeforeReading(page));
  assert.match(page, /student_not_found[\s\S]*notFound\(\)/);
  assert.match(page, /logStudentView\(id, STUDENT_PAGE_VIEW\)/);
  // Guards: logging twice, or after the read, or not at all, is caught.
  assert.ok(!logsOnceBeforeReading(page.replace("await adminStudent(id);", "await adminStudent(id); await logStudentView(id, STUDENT_PAGE_VIEW);")));
  assert.ok(!logsOnceBeforeReading(page.replace("await logStudentView(id, STUDENT_PAGE_VIEW);", "")));
  const swapped = page.replace("await logStudentView(id, STUDENT_PAGE_VIEW);", "").replace("const student = await adminStudent(id);", "const student = await adminStudent(id); await logStudentView(id, STUDENT_PAGE_VIEW);");
  assert.ok(!logsOnceBeforeReading(swapped));
});

test("no other console page shows a student's lists, numbers, or plan (only the student page does, and it logs)", () => {
  for (const f of adminFiles.filter((f) => f.endsWith(".tsx") && !f.includes("/students/"))) {
    assert.doesNotMatch(read(f), /adminStudent\(|\.lists\b.*items|student\.profile/, f);
  }
});

test("the student page renders the standing panel under every list college (a server component; tests/admin-hidden.test.mts covers its body)", () => {
  const page = read("app/admin/students/[id]/page.tsx");
  assert.match(page, /<StandingPanelSlot studentId=\{studentId\} unitId=\{item\.unit_id\} itemId=\{item\.id\} \/>/);
  const slot = read("components/admin/StandingPanelSlot.tsx");
  assert.match(slot, /export async function StandingPanelSlot\(\{ studentId, unitId, itemId \}: StandingPanelSlotProps\)/);
  assert.doesNotMatch(slot, /^\s*["']use client["']/);
});

/* ------------------------------------------------------------------ */
/* The household notice                                                */
/* ------------------------------------------------------------------ */

test("the household notice reads 'Quad support added Jordan to this household on Oct 12', never an admin's name or an email", () => {
  const link = { at: "2026-10-12T15:00:00Z", action: "household.link", member_name: "Jordan" };
  assert.equal(consoleLib.householdNoticeLine(link), "Quad support added Jordan to this household on Oct 12");
  assert.equal(consoleLib.householdNoticeLine({ ...link, action: "household.unlink" }), "Quad support removed Jordan from this household on Oct 12");
  assert.equal(consoleLib.householdNoticeLine({ ...link, member_name: null }), "Quad support added someone to this household on Oct 12");
  // A "name" that is really an email address is not shown to the household.
  const leaked = consoleLib.householdNoticeLine({ ...link, member_name: "jordan@example.com" });
  assert.ok(!leaked.includes("@") && /added someone/.test(leaked), leaked);
  assert.ok(consoleLib.householdNoticeLine(link).startsWith(constants.SUPPORT_VIEWER_NAME));
  assert.deepEqual(
    consoleLib.householdNoticeLines([
      { at: "2026-10-01T12:00:00Z", action: "household.link", member_name: "Sam" },
      { at: "2026-10-12T12:00:00Z", action: "household.unlink", member_name: "Jordan" },
      { at: "2026-10-12T13:00:00Z", action: "profile.update", member_name: "x" },
    ]),
    ["Quad support removed Jordan from this household on Oct 12", "Quad support added Sam to this household on Oct 1"],
  );
});

test("/household shows the notice from admin_household_notice for the member's own household", async () => {
  const layout = read("app/household/layout.tsx");
  assert.match(layout, /householdNoticeLines\(await householdAdminNotice\(first\.id\)\)/);
  assert.match(layout, /adminNotices\.map\(\(line\) => \(/);

  asAdmin({ rpcData: { admin_household_notice: [{ at: "2026-10-12T15:00:00Z", action: "household.link", member_name: "Jordan" }] } });
  const rows = await people.householdAdminNotice(HH);
  assert.deepEqual(ui.current.rpcCalls, [{ name: "admin_household_notice", args: { p_household: HH } }]);
  assert.deepEqual(consoleLib.householdNoticeLines(rows), ["Quad support added Jordan to this household on Oct 12"]);
  // The notice is the member's own read: no console header, so no admin policy is involved.
  assert.deepEqual(ui.current.headers, []);
  // Any error (the migration missing, not a member) is no notice, not a failed page.
  asAdmin({ rpcErrors: { admin_household_notice: { message: "function does not exist" } } });
  assert.deepEqual(await people.householdAdminNotice(HH), []);
});

/* ------------------------------------------------------------------ */
/* Search, the log, and the rail                                       */
/* ------------------------------------------------------------------ */

test("search: one hit opens its page, none or several list; an invitation opens its household", () => {
  const user = { kind: "user", id: ALICE, household_id: null } as const;
  assert.equal(consoleLib.singleHitHref([user]), `/admin/people/${ALICE}`);
  assert.equal(consoleLib.singleHitHref([{ kind: "student", id: STUDENT, household_id: HH }]), `/admin/students/${STUDENT}`);
  assert.equal(consoleLib.singleHitHref([{ kind: "household", id: HH, household_id: HH }]), `/admin/households/${HH}`);
  assert.equal(consoleLib.singleHitHref([{ kind: "invitation", id: MEMBER, household_id: HH }]), `/admin/households/${HH}`);
  assert.equal(consoleLib.singleHitHref([]), null);
  assert.equal(consoleLib.singleHitHref([user, user]), null);
  assert.equal(consoleLib.searchHref("  Jordan Rivera "), "/admin/people?q=Jordan%20Rivera");
  assert.deepEqual(consoleLib.statusChips("deleting").map((c) => c.label), ["Deleting"]);
  assert.deepEqual(consoleLib.statusChips("active"), []);
  assert.deepEqual(consoleLib.statusChips("managed").map((c) => c.label), ["No account yet"]);
  assert.equal(consoleLib.deletingLabel("2026-10-24T12:00:00Z", new Date("2026-10-12T12:00:00Z")), "Deleting in 12 days");
});

test("search runs through admin_search_people with the console header; a blank query makes no call", async () => {
  asAdmin({ rpcData: { admin_search_people: [{ kind: "user", id: BOB, name: "Bob", email: "b@example.com", status: "active" }] } });
  assert.equal((await people.searchPeople("bob")).length, 1);
  assert.deepEqual(ui.current.rpcCalls, [{ name: "admin_search_people", args: { q: "bob", max_rows: 50 } }]);
  assert.deepEqual(ui.current.headers, [{ [constants.ADMIN_CONSOLE_HEADER]: "1" }]);
  asAdmin();
  assert.deepEqual(await people.searchPeople("   "), []);
  assert.equal(ui.current.rpcCalls.length, 0);
});

test("the unsearched list runs admin_list_people a page at a time and reads the full count", async () => {
  asAdmin({ rpcData: { admin_list_people: [{ kind: "user", id: BOB, name: "Bob", email: "b@example.com", status: "active", total: 120 }] } });
  const page = await people.listPeople(3);
  assert.equal(page.total, 120);
  assert.equal(page.rows.length, 1);
  assert.deepEqual(ui.current.rpcCalls, [{ name: "admin_list_people", args: { p_page: 3, p_size: people.PEOPLE_PAGE_SIZE } }]);
  assert.deepEqual(ui.current.headers, [{ [constants.ADMIN_CONSOLE_HEADER]: "1" }]);
});

test("the rail has the five sections, highlights the right one, and every console page sits under one", () => {
  assert.deepEqual(consoleLib.ADMIN_SECTIONS.map((s) => s.label), ["People", "Colleges", "Health", "Operations", "Log"]);
  assert.equal(consoleLib.activeSection("/admin"), null);
  assert.equal(consoleLib.activeSection(`/admin/households/${HH}`), "people");
  assert.equal(consoleLib.activeSection(`/admin/students/${STUDENT}`), "people");
  assert.equal(consoleLib.activeSection("/admin/high-schools/abc"), "colleges");
  assert.equal(consoleLib.activeSection("/admin/admins"), "log");
  assert.equal(consoleLib.activeSection("/admin/peoplex"), null);
  const rail = read("components/admin/AdminRail.tsx");
  assert.match(rail, /<AdminSearch \/>/);
  assert.match(rail, /aria-current=/);
  assert.match(rail, /overflow-x-auto/); // the phone strip
});

test("dates: a moment is shown in the site's zone; a bare date (a deadline) is shown as written, not shifted a day", () => {
  assert.equal(consoleLib.fmtDate("2027-01-01"), "Jan 1, 2027");
  assert.equal(consoleLib.fmtDate("2026-10-12T03:00:00Z"), "Oct 11, 2026");
  assert.equal(consoleLib.fmtDate(null), "—");
  assert.equal(consoleLib.fmtDateTime("2026-10-12T15:04:00Z"), "Oct 12, 2026, 11:04 AM");
});

test("log filters: action, admin, target; malformed values are ignored; paging keeps the filters", () => {
  const q = consoleLib.parseLogQuery({ action: "account.delete", admin: ALICE, kind: "user", target: BOB, before: "120" });
  assert.deepEqual(q, { action: "account.delete", adminId: ALICE, targetKind: "user", targetId: BOB, before: 120 });
  assert.deepEqual(consoleLib.parseLogQuery({ action: "x; drop table", admin: "nope", kind: "robot", before: "-1" }), {});
  assert.deepEqual(consoleLib.parseLogQuery({ action: ["account.delete", "x"] }), { action: "account.delete" });
  assert.equal(consoleLib.logHref(q), `/admin/log?action=account.delete&admin=${ALICE}&kind=user&target=${BOB}&before=120`);
  assert.equal(consoleLib.logHref({}), "/admin/log");
  assert.equal(consoleLib.actionLabel("account.suspend"), "Deactivated an account");
  assert.equal(consoleLib.actionLabel("ops.dispatch"), "ops.dispatch");
  assert.equal(consoleLib.targetHref("user", BOB), `/admin/people/${BOB}`);
  assert.equal(consoleLib.targetHref("member", MEMBER), null);
});

test("every action the migration logs has words in the log's labels", () => {
  const sql = read("supabase/migrations/20261012200000_admin.sql");
  const logged = [...new Set([...sql.matchAll(/admin_log_write\('([a-z_.]+)'/g)].map((m) => m[1]))];
  assert.ok(logged.length >= 15, logged.join(", "));
  assert.deepEqual(logged.filter((a) => !(a in consoleLib.LOG_ACTIONS)), []);
});

/* ------------------------------------------------------------------ */
/* Robots, analytics, the proxy                                        */
/* ------------------------------------------------------------------ */

test("every console page, and the layout, is noindex", () => {
  for (const f of [...pages, "app/admin/layout.tsx"]) assert.match(read(f), /robots: \{ index: false/, f);
});

test("no analytics under /admin: the provider renders nothing there, and no console file tracks anything", () => {
  assert.ok(analytics.isAdminPath("/admin"));
  assert.ok(analytics.isAdminPath("/admin/people/abc"));
  assert.ok(!analytics.isAdminPath("/administration"));
  assert.ok(!analytics.isAdminPath("/schools/1"));
  assert.ok(!analytics.isAdminPath(null));
  const provider = read("components/analytics/AnalyticsProvider.tsx");
  assert.match(provider, /if \(isAdminPath\(pathname\)\) return null;\s*return <AnalyticsRuntime \/>;/);
  assert.match(provider, /if \(isAdminPath\(window\.location\.pathname\)\) return null;/);
  for (const f of [...adminFiles, ...walk("components/admin"), "lib/admin/console.ts", "lib/admin/console-actions.ts"]) {
    assert.doesNotMatch(read(f), /posthog|from "@\/lib\/analytics|\btrack\(|\bidentify\(/i, f);
  }
  // Guard: a provider without the pathname check is caught.
  assert.doesNotMatch(provider.replace("if (isAdminPath(pathname)) return null;", ""), /if \(isAdminPath\(pathname\)\) return null;/);
});

test("proxy.ts refreshes the session under /admin", () => {
  assert.match(read("proxy.ts"), /matcher: \[[^\]]*"\/admin\/:path\*"/);
  assert.match(read("tests/accounts.test.mts"), /const ACCOUNT_ROUTES = \[[^\]]*"\/admin"/);
});

test("console reads go through the console header: the pickers and counts use adminSupabase(), never the plain client", () => {
  const reads = read("lib/admin/console-reads.ts");
  assert.match(reads, /adminSupabase\(\)/);
  assert.doesNotMatch(reads, /createServerSupabase\(/);
  // The MFA actions use the admin's own session (they are about the session itself), not the console's reads.
  for (const f of adminFiles.filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes("/mfa/"))) assert.doesNotMatch(read(f), /createServerSupabase\(/, f);
});

/* ------------------------------------------------------------------ */
/* The MFA step                                                        */
/* ------------------------------------------------------------------ */

test("MFA: only an admin at aal1 with no verified factor can start enrolling; stale unverified factors are cleared first", async () => {
  reset({ claims: { sub: ALICE, aal: "aal1" }, isAdmin: true, factors: [{ id: "old", factor_type: "totp", status: "unverified" }] });
  const got = await mfaActions.startEnrollment();
  assert.deepEqual(got, { status: "enrolled", factorId: "new-factor", qr: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP" });
  assert.deepEqual(ui.current.mfaCalls, ["unenroll old", "enroll"]);

  for (const over of [
    { claims: null, isAdmin: false },
    { isAdmin: false },
    { claims: { sub: ALICE, aal: "aal2" }, isAdmin: true }, // already through
    { claims: { sub: ALICE, aal: "aal1" }, isAdmin: true, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] }, // can't add a second from aal1
  ] as Partial<Ui>[]) {
    reset(over);
    assert.equal((await mfaActions.startEnrollment()).status, "error", JSON.stringify(over));
    assert.deepEqual(ui.current.mfaCalls, []);
  }
});

test("MFA: a six-digit code verifies the session's own factor; a wrong one says so; another person's factor id is refused", async () => {
  const aal1 = { claims: { sub: ALICE, aal: "aal1" }, isAdmin: true };
  reset({ ...aal1, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] });
  const ok = await mfaActions.verifyCode({ status: "idle" }, form({ code: "123 456" }));
  assert.deepEqual(ok, { status: "verified" });
  assert.deepEqual(ui.current.mfaCalls, ["verify f1 123456"]);

  reset({ ...aal1, factors: [{ id: "f1", factor_type: "totp", status: "verified" }], mfaVerifyError: { message: "Invalid TOTP code entered" } });
  const bad = await mfaActions.verifyCode({ status: "idle" }, form({ code: "000000" }));
  assert.equal(bad.status, "error");
  assert.match(bad.status === "error" ? bad.message : "", /That code didn't work/);

  reset({ ...aal1, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] });
  assert.equal((await mfaActions.verifyCode({ status: "idle" }, form({ code: "12345" }))).status, "error");
  assert.equal((await mfaActions.verifyCode({ status: "idle" }, form({ code: "123456", factor: "66666666-6666-4666-8666-666666666666" }))).status, "error");
  assert.deepEqual(ui.current.mfaCalls, []);

  // Enrolling: the factor just made is confirmed; an enrolled admin can't confirm an unverified one instead.
  reset({ ...aal1, factors: [{ id: "55555555-5555-4555-8555-555555555556", factor_type: "totp", status: "unverified" }] });
  assert.equal((await mfaActions.verifyCode({ status: "idle" }, form({ code: "123456", factor: "55555555-5555-4555-8555-555555555556" }))).status, "verified");
  // Not an admin at aal1: refused without touching MFA.
  reset({ isAdmin: false, claims: { sub: ALICE, aal: "aal1" } });
  assert.equal((await mfaActions.verifyCode({ status: "idle" }, form({ code: "123456" }))).status, "error");
  assert.deepEqual(ui.current.mfaCalls, []);
});

test("the MFA step refreshes the router when verified, and its actions run on the server (the browser holds no Supabase key)", () => {
  const step = read("components/admin/MfaStep.tsx");
  assert.match(step, /if \(state\.status === "verified"\) router\.refresh\(\);/);
  assert.match(step, /autoComplete="one-time-code"/);
  assert.doesNotMatch(step, /createBrowserClient|NEXT_PUBLIC|supabase-js/);
});

test("parseTotpCode takes six digits with spaces and nothing else", () => {
  assert.equal(consoleLib.parseTotpCode(" 123 456 "), "123456");
  for (const bad of ["12345", "1234567", "abcdef", "", null, 123456]) assert.equal(consoleLib.parseTotpCode(bad), null, String(bad));
});

test("isNextControlFlow recognizes redirect() and notFound(), and nothing a database error could look like", () => {
  assert.ok(consoleLib.isNextControlFlow({ digest: "NEXT_REDIRECT;replace;/admin/people;307;" }));
  assert.ok(consoleLib.isNextControlFlow({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }));
  assert.ok(!consoleLib.isNextControlFlow(new Error("NEXT_REDIRECT")));
  assert.ok(!consoleLib.isNextControlFlow(null));
});

test("the console files are all under the paths this unit owns", () => {
  const owned = ["app/admin/layout.tsx", "app/admin/page.tsx"];
  const dirs = ["people", "households", "students", "log", "admins", "mfa"].map((d) => `app/admin/${d}/`);
  for (const f of adminFiles) assert.ok(owned.includes(f) || dirs.some((d) => f.startsWith(d)) || /^app\/admin\/(colleges|health|operations|high-schools)\//.test(f), relative(ROOT, join(ROOT, f)));
});
