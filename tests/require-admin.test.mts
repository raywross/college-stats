/**
 * The admin console's app-side gate and the paused account (lib/admin/auth.ts, lib/auth.ts, app/login/page.tsx;
 * specs/product/admin.md "Who is an admin", "What deactivate means"): requireAdmin() is a 404 signed out, for a
 * non-admin, for an admin at aal1, and before the migration; adminState() tells the MFA step whether a factor is
 * enrolled; getAccount() is null for a paused profile and requireUser() sends that person to /login?paused=1, which
 * shows the notice (no support address yet) instead of bouncing them back. Also: "Quad support" in the student's
 * "Who viewed your information", and the admin export's exporter review. Each guard is shown failing when its rule is
 * broken. Runs the real modules against a fake Supabase client. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

const ROOT = join(import.meta.dirname, "..");

// lib/auth.ts and lib/admin/*.ts are Next.js server code: `server-only`, next/navigation, `@/` paths, extensionless
// imports, and a Supabase client bound to the request's cookies. Stand in a fake for the client (driven by `fake`
// below) and for redirect()/notFound() (they throw what Next.js throws), and resolve paths the way the bundler does.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const FAKE_SUPABASE = "export function supabaseAuthEnv(){return globalThis.__adminTest.env} export async function createServerSupabase(o){return globalThis.__adminTest.client(o)}";
// lib/auth.ts reads the profile from the viewer bundle when it's installed (lib/bundles.ts), else from the table.
const FAKE_BUNDLES = "export async function viewerBundle(){const p=globalThis.__adminTest.bundleProfile();return p?{profile:p}:null}";
const FAKE_NAVIGATION =
  "export function redirect(u){const e=new Error('NEXT_REDIRECT');e.digest='NEXT_REDIRECT;replace;'+u+';307;';throw e} export function notFound(){const e=new Error('NEXT_HTTP_ERROR_FALLBACK;404');e.digest='NEXT_HTTP_ERROR_FALLBACK;404';throw e}";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "@/lib/supabase-server") return { url: `data:text/javascript,${encodeURIComponent(FAKE_SUPABASE)}`, shortCircuit: true };
    if (specifier === "@/lib/bundles") return { url: `data:text/javascript,${encodeURIComponent(FAKE_BUNDLES)}`, shortCircuit: true };
    if (specifier === "next/navigation") return { url: `data:text/javascript,${encodeURIComponent(FAKE_NAVIGATION)}`, shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

/** What the fake Supabase answers. Reset per scenario. */
interface Fake {
  claims: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  /** The profiles table has no suspended_at column yet (the admin migration isn't applied). */
  noSuspendedColumn: boolean;
  isAdmin: boolean | "missing";
  factors: { factor_type: string; status: string }[];
  headers: Record<string, string>[];
  /** The viewer bundle's profile (20261013100000_viewer_bundle_pause.sql), or null: no bundle installed, read the table. */
  bundleProfile: Record<string, unknown> | null;
}
const state = { fake: null as unknown as Fake };
function reset(o: Partial<Fake> = {}): Fake {
  state.fake = { claims: null, profile: null, noSuspendedColumn: false, isAdmin: false, factors: [], headers: [], bundleProfile: null, ...o };
  return state.fake;
}

function fakeClient(options?: { headers?: Record<string, string> }) {
  const fake = state.fake;
  if (options?.headers) fake.headers.push(options.headers);
  return {
    auth: {
      getClaims: async () => (fake.claims ? { data: { claims: fake.claims }, error: null } : { data: null, error: { message: "Auth session missing" } }),
      mfa: { listFactors: async () => ({ data: { all: fake.factors, totp: [] }, error: null }) },
    },
    rpc: async (name: string) => {
      if (name !== "is_admin_any_aal") return { data: null, error: { message: `unexpected rpc ${name}` } };
      if (fake.isAdmin === "missing") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.is_admin_any_aal" } };
      return { data: fake.isAdmin, error: null };
    },
    from: (table: string) => {
      assert.equal(table, "profiles");
      let columns = "";
      const builder = {
        select(cols: string) {
          columns = cols;
          return builder;
        },
        eq() {
          return builder;
        },
        insert(row: Record<string, unknown>) {
          fake.profile = { id: row.id, display_name: null, birth_year: null, role_hint: null, created: "2026-10-12", updated: "2026-10-12", deleted_at: null };
          return builder;
        },
        async maybeSingle() {
          if (fake.noSuspendedColumn && columns.includes("suspended_at")) return { data: null, error: { code: "42703", message: "column profiles.suspended_at does not exist" } };
          return { data: fake.profile ? pick(fake.profile, columns) : null, error: null };
        },
        async single() {
          return { data: fake.profile ? pick(fake.profile, columns) : null, error: null };
        },
      };
      return builder;
    },
  };
}
const pick = (row: Record<string, unknown>, columns: string) => Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, row[c] ?? null]));

(globalThis as unknown as { __adminTest: unknown }).__adminTest = { env: { url: "https://x.supabase.co", key: "sb_publishable_x" }, client: fakeClient, bundleProfile: () => state.fake.bundleProfile };

const auth = await import("../lib/auth.ts");
const adminAuth = await import("../lib/admin/auth.ts");
const constants = await import("../lib/admin/constants.ts");
const { groupAccessLog, describeAccessTable } = await import("../lib/household-rules.ts");
const people = await import("../lib/admin/people.ts");
const { ACCOUNT_EXPORTERS } = await import("../lib/account-export.ts");

const ALICE = "11111111-1111-4111-8111-111111111111";
const PROFILE = { id: ALICE, display_name: "Alice", birth_year: 2009, role_hint: "student", created: "2026-10-01", updated: "2026-10-01", deleted_at: null, suspended_at: null };
const session = (aal: "aal1" | "aal2") => ({ sub: ALICE, email: "alice@example.com", aal });

/** "allowed", "404", "redirect <path>", or the error. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "allowed";
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    if (digest.startsWith("NEXT_REDIRECT;")) return `redirect ${digest.split(";")[2]}`;
    return `error ${(err as Error).message}`;
  }
}

/* ------------------------------------------------------------------ */
/* requireAdmin                                                        */
/* ------------------------------------------------------------------ */

const GATE_SCENARIOS: [label: string, fake: Partial<Fake>, expected: "allowed" | "404"][] = [
  ["signed out", {}, "404"],
  ["a signed-in non-admin at aal2", { claims: session("aal2"), isAdmin: false }, "404"],
  ["an admin at aal1", { claims: session("aal1"), isAdmin: true }, "404"],
  ["an admin at aal1 with a factor enrolled", { claims: session("aal1"), isAdmin: true, factors: [{ factor_type: "totp", status: "verified" }] }, "404"],
  ["a session with no aal claim", { claims: { sub: ALICE, email: "alice@example.com" }, isAdmin: true }, "404"],
  ["before the migration", { claims: session("aal2"), isAdmin: "missing" }, "404"],
  ["an admin at aal2", { claims: session("aal2"), isAdmin: true }, "allowed"],
];

/** Scenarios where a gate lets the wrong person in (or keeps the admin out). Empty when it holds. */
async function gateProblems(gate: () => Promise<unknown>): Promise<string[]> {
  const problems: string[] = [];
  for (const [label, fake, expected] of GATE_SCENARIOS) {
    reset(fake);
    const got = await outcome(gate);
    if (got !== expected) problems.push(`${label}: ${got}`);
  }
  return problems;
}

test("requireAdmin: a 404 signed out, for a non-admin, at aal1, and before the migration; the admin at aal2 gets their id", async () => {
  assert.deepEqual(await gateProblems(adminAuth.requireAdmin), []);
  reset({ claims: session("aal2"), isAdmin: true });
  assert.deepEqual(await adminAuth.requireAdmin(), { userId: ALICE });
});

test("guard: a gate that only turns away non-admins (forgetting aal2) is caught", async () => {
  const broken = async () => {
    const s = await adminAuth.adminState();
    if (s.kind === "not-admin" || s.kind === "setup-missing") throw Object.assign(new Error("404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    return { userId: s.userId };
  };
  const problems = await gateProblems(broken);
  assert.deepEqual(problems.map((p) => p.split(":")[0]), ["an admin at aal1", "an admin at aal1 with a factor enrolled", "a session with no aal claim"]);
});

test("adminState: the MFA step learns whether a TOTP factor is verified; setup-missing before the migration", async () => {
  reset({ claims: session("aal1"), isAdmin: true });
  assert.deepEqual(await adminAuth.adminState(), { kind: "needs-mfa", userId: ALICE, enrolled: false });
  reset({ claims: session("aal1"), isAdmin: true, factors: [{ factor_type: "totp", status: "unverified" }] });
  assert.deepEqual(await adminAuth.adminState(), { kind: "needs-mfa", userId: ALICE, enrolled: false });
  reset({ claims: session("aal1"), isAdmin: true, factors: [{ factor_type: "totp", status: "verified" }] });
  assert.deepEqual(await adminAuth.adminState(), { kind: "needs-mfa", userId: ALICE, enrolled: true });
  reset({ claims: session("aal2"), isAdmin: "missing" });
  assert.deepEqual(await adminAuth.adminState(), { kind: "setup-missing" });
  reset({});
  assert.deepEqual(await adminAuth.adminState(), { kind: "not-admin" });
});

test("lib/admin/auth.ts reads the aal from the verified claims, never getSession()", () => {
  const src = readFileSync(join(ROOT, "lib/admin/auth.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/getSession\(/.test(src));
  assert.ok(/sessionAal\(\)/.test(src));
});

/* ------------------------------------------------------------------ */
/* The paused account                                                  */
/* ------------------------------------------------------------------ */

type AccountFns = { getAccount: () => Promise<unknown>; requireUser: (next?: string) => Promise<unknown> };

/** Where getAccount() and requireUser() mishandle a paused, an active, or a signed-out person. Empty when they hold. */
async function pausedProblems({ getAccount, requireUser }: AccountFns): Promise<string[]> {
  const problems: string[] = [];
  reset({ claims: session("aal2"), profile: { ...PROFILE, suspended_at: "2026-10-12T10:00:00Z" } });
  if ((await getAccount()) !== null) problems.push("getAccount returned a paused account");
  reset({ claims: session("aal2"), profile: { ...PROFILE, suspended_at: "2026-10-12T10:00:00Z" } });
  const paused = await outcome(() => requireUser("/account"));
  if (paused !== "redirect /login?paused=1") problems.push(`requireUser for a paused account: ${paused}`);
  reset({ claims: session("aal2"), profile: PROFILE });
  if ((await getAccount()) === null) problems.push("getAccount returned null for an active account");
  reset({ claims: session("aal2"), profile: PROFILE });
  const active = await outcome(() => requireUser("/account"));
  if (active !== "allowed") problems.push(`requireUser for an active account: ${active}`);
  reset({});
  const signedOut = await outcome(() => requireUser("/account"));
  if (signedOut !== "redirect /login?next=%2Faccount") problems.push(`requireUser signed out: ${signedOut}`);
  return problems;
}

test("a paused profile: getAccount() is null and requireUser() sends the person to /login?paused=1; others unchanged", async () => {
  assert.deepEqual(await pausedProblems(auth), []);
  // The account's profile carries no suspension field (the Profile type is unchanged).
  reset({ claims: session("aal2"), profile: PROFILE });
  const account = (await auth.getAccount()) as unknown as { profile: Record<string, unknown> };
  assert.ok(!("suspended_at" in account.profile));
  assert.equal(await auth.accountPaused(), false);
  reset({ claims: session("aal2"), profile: { ...PROFILE, suspended_at: "2026-10-12T10:00:00Z" } });
  assert.equal(await auth.accountPaused(), true);
});

test("from the viewer bundle: a bundled profile's suspended_at pauses the account, and the profile drops the field", async () => {
  const paused = { ...PROFILE, suspended_at: "2026-10-12T10:00:00Z" };
  // The table says active; the bundle says paused. The bundle is what's read.
  reset({ claims: session("aal2"), profile: PROFILE, bundleProfile: paused });
  assert.equal(await auth.getAccount(), null);
  reset({ claims: session("aal2"), profile: PROFILE, bundleProfile: paused });
  assert.equal(await outcome(() => auth.requireUser("/account")), "redirect /login?paused=1");
  reset({ claims: session("aal2"), profile: PROFILE, bundleProfile: { ...PROFILE, suspended_at: null } });
  const account = (await auth.getAccount()) as unknown as { profile: Record<string, unknown> } | null;
  assert.equal(account?.profile.display_name, "Alice");
  assert.ok(!("suspended_at" in (account?.profile ?? {})));
});

test("before the admin migration (no suspended_at column) accounts read as before and nobody is paused", async () => {
  reset({ claims: session("aal2"), profile: PROFILE, noSuspendedColumn: true });
  const account = (await auth.getAccount()) as { profile: { display_name: string } } | null;
  assert.equal(account?.profile.display_name, "Alice");
  reset({ claims: session("aal2"), profile: PROFILE, noSuspendedColumn: true });
  assert.equal(await outcome(() => auth.requireUser("/account")), "allowed");
});

test("guard: getAccount and requireUser that ignore the pause are caught", async () => {
  const ignoring: AccountFns = {
    getAccount: async () => ({ user: { id: ALICE, email: null }, profile: state.fake.profile }),
    requireUser: async (next?: string) => {
      const user = await auth.getUser();
      if (!user) throw Object.assign(new Error("redirect"), { digest: `NEXT_REDIRECT;replace;/login?next=${encodeURIComponent(next ?? "")};307;` });
      return user;
    },
  };
  assert.deepEqual(await pausedProblems(ignoring), ["getAccount returned a paused account", "requireUser for a paused account: allowed"]);
});

test("the paused notice: one constant, no support address yet", () => {
  assert.equal(constants.SUPPORT_CONTACT, null);
  assert.equal(constants.pausedNotice(), "This account is paused. Contact Quad support to restore it.");
  assert.equal(constants.pausedNotice("help@quad.example"), "This account is paused. Contact Quad support at help@quad.example to restore it.");
  assert.equal(constants.PAUSED_LOGIN_PATH, "/login?paused=1");
  assert.equal(constants.ADMIN_LOG_PAGE, 100);
});

/** What the login page gets wrong about a paused person. Empty when it holds. */
function loginProblems(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const problems: string[] = [];
  if (!/params\.paused === "1"/.test(code)) problems.push("doesn't read ?paused=1");
  if (!/\{pausedNotice\(\)\}/.test(code)) problems.push("doesn't show pausedNotice()");
  if (/if \(await getUser\(\)\) redirect\(/.test(code)) problems.push("sends every signed-in person on (a paused one loops back here)");
  if (!/accountPaused\(\)/.test(code)) problems.push("doesn't ask whether the signed-in account is paused");
  if (/support@|mailto:/.test(code)) problems.push("hard-codes a support address");
  return problems;
}

test("/login?paused=1 shows the paused notice and keeps a paused person there", () => {
  assert.deepEqual(loginProblems(readFileSync(join(ROOT, "app/login/page.tsx"), "utf8")), []);
});

test("guard: the login page as it was (redirect anyone signed in, no notice) is caught", () => {
  const before = `
    const next = safeNextPath(params.next, "/account");
    if (await getUser()) redirect(next);
    return <LoginForm next={next} />;`;
  assert.deepEqual(loginProblems(before), [
    "doesn't read ?paused=1",
    "doesn't show pausedNotice()",
    "sends every signed-in person on (a paused one loops back here)",
    "doesn't ask whether the signed-in account is paused",
  ]);
});

/* ------------------------------------------------------------------ */
/* "Quad support" in Who viewed your information                       */
/* ------------------------------------------------------------------ */

test("an admin's view reads 'Quad support viewed your information', never a name, one line per day", () => {
  const lines = groupAccessLog(
    [
      { at: "2026-10-12T15:00:00Z", table_name: "admin", viewer_id: null, viewer_name: "Quad support" },
      { at: "2026-10-12T14:00:00Z", table_name: "admin", viewer_id: null, viewer_name: null },
      // Even if a row ever carried an id and a name, an admin's view is labelled by its table.
      { at: "2026-10-12T13:00:00Z", table_name: "admin", viewer_id: "admin-2", viewer_name: "Quinn Admin" },
      { at: "2026-10-12T12:00:00Z", table_name: "lists", viewer_id: "mom", viewer_name: "Mom" },
    ],
    "UTC",
  );
  assert.deepEqual(lines.map((l) => [l.viewer, l.what, l.day, l.count]), [
    ["Quad support", "your information", "Oct 12, 2026", 3],
    ["Mom", "your list", "Oct 12, 2026", 1],
  ]);
  assert.equal(constants.SUPPORT_VIEWER_NAME, "Quad support");
  assert.equal(describeAccessTable("admin"), "your information");
});

/* ------------------------------------------------------------------ */
/* The admin export                                                    */
/* ------------------------------------------------------------------ */

test("the admin export runs every exporter, each reviewed for admin use; the four that rely on the person's session are replaced", () => {
  assert.deepEqual([...people.ADMIN_EXPORT_REVIEWED].sort(), ACCOUNT_EXPORTERS.map((e) => e.key).sort());
  const run = people.adminExporters();
  assert.deepEqual(run.map((e) => e.key), ACCOUNT_EXPORTERS.map((e) => e.key));
  const replaced = run.filter((e, i) => e !== ACCOUNT_EXPORTERS[i]).map((e) => e.key);
  assert.deepEqual(replaced, ["households", "invitations_sent", "home", "access_log"]);
});

test("guard: a new exporter nobody reviewed for admin use stops the admin export", () => {
  const extra = { key: "household_finances", description: "x", run: async () => [] };
  assert.throws(() => people.adminExporters([...ACCOUNT_EXPORTERS, extra]), /review household_finances/);
});

test("the lists exporter leaves out another person's private notes even when the read policy would return them", async () => {
  const lists = ACCOUNT_EXPORTERS.find((e) => e.key === "lists")!;
  const tables: Record<string, Record<string, unknown>[]> = {
    lists: [{ id: "l1", student_id: "s1", user_id: null, name: "My list", is_default: true, created: "2026-10-01" }],
    list_items: [{ id: "i1", unit_id: "243744", category: "reach", status: "considering" }],
    list_notes: [
      { item_id: "i1", author_id: ALICE, body: "mine, private", private: true, created: "2026-10-02" },
      { item_id: "i1", author_id: "mom", body: "mom's, shared", private: false, created: "2026-10-03" },
      { item_id: "i1", author_id: "mom", body: "mom's, private", private: true, created: "2026-10-04" },
    ],
  };
  // The exporter reads a student's lists (.in student_id), the user's own lists (.eq user_id: none here), each list's
  // items, and the items' notes.
  const query = (table: string) => {
    let ownLists = false;
    const q = {
      select: () => q,
      in: () => q,
      eq: (col: string) => ((ownLists = col === "user_id"), q),
      then: (resolve: (v: unknown) => void) => resolve({ data: ownLists ? [] : tables[table], error: null }),
    };
    return q;
  };
  const doc = (await lists.run({ supabase: { from: query } as never, userId: ALICE, email: null, ownStudentId: "s1", studentIds: ["s1"] })) as { notes: { body: string }[] }[];
  assert.deepEqual(doc[0].notes.map((n) => n.body), ["mine, private", "mom's, shared"]);
  assert.ok(doc[0].notes.every((n) => !("author_id" in n)));
});

test("the console's reads send the x-quad-console header the read policies require", async () => {
  reset({ claims: session("aal2"), isAdmin: true });
  await people.adminSupabase();
  assert.deepEqual(state.fake.headers, [{ "x-quad-console": "1" }]);
  assert.equal(constants.ADMIN_CONSOLE_HEADER, "x-quad-console");
  const sql = readFileSync(join(ROOT, "supabase/migrations/20261012200000_admin.sql"), "utf8");
  assert.ok(sql.includes(`->> '${constants.ADMIN_CONSOLE_HEADER}'`));
});
