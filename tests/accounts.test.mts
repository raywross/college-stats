/**
 * Accounts foundation, pure parts (specs/product/accounts.md): the 13+ rule (and that it matches the database's),
 * safe `?next=` redirects, who-can-edit resolution, the email seam, and two guards that keep public pages static:
 * proxy.ts runs only on account routes, and only account routes read cookies or the session. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  birthYearAllowed,
  initialsFor,
  loginHref,
  parseAuthFragment,
  parseBirthYear,
  resolveStudentAccess,
  safeNextPath,
  wantsOwnStudent,
  type HouseholdMember,
  type StudentRecord,
} from "../lib/accounts.ts";
import { emailConfigured, sendEmail } from "../lib/email.ts";
import { asUser, createAuthDb, createUser } from "./helpers/pg-auth.mts";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* 13+                                                                 */
/* ------------------------------------------------------------------ */

test("birthYearAllowed: 13+ only, conservatively, from a year alone", () => {
  const today = new Date(2026, 9, 5);
  assert.equal(birthYearAllowed(2012, today), true); // 13 or 14: certainly 13
  assert.equal(birthYearAllowed(2013, today), false); // 12 or 13: might be 12
  assert.equal(birthYearAllowed(2020, today), false);
  assert.equal(birthYearAllowed(1960, today), true);
  assert.equal(birthYearAllowed(1906, today), true);
  assert.equal(birthYearAllowed(1905, today), false); // typo guard: over 120
  assert.equal(birthYearAllowed(2010.5, today), false);
  // On January 1 the boundary moves with the year.
  assert.equal(birthYearAllowed(2013, new Date(2027, 0, 1)), true);
});

test("birthYearAllowed matches the database's birth_year_allowed() for every year around the boundary", async () => {
  const db = await createAuthDb(["20261005120000_accounts.sql"]);
  const user = await createUser(db, { email: "x@example.com", birthYear: 1990 });
  const today = new Date();
  for (let year = today.getFullYear() - 125; year <= today.getFullYear() + 1; year++) {
    const [{ ok }] = await asUser<{ ok: boolean }>(db, user, "select public.birth_year_allowed($1) as ok", [year]);
    assert.equal(ok, birthYearAllowed(year, today), `year ${year}`);
  }
});

test("parseBirthYear takes four digits only", () => {
  assert.equal(parseBirthYear("2008"), 2008);
  assert.equal(parseBirthYear(" 2008 "), 2008);
  assert.equal(parseBirthYear(2008), 2008);
  for (const bad of ["08", "20080", "2oo8", "", null, undefined, "2008.0", "-2008"]) assert.equal(parseBirthYear(bad), null, String(bad));
});

/* ------------------------------------------------------------------ */
/* Redirects                                                           */
/* ------------------------------------------------------------------ */

test("parseAuthFragment: the session a magic link brings back, or Supabase's error, or nothing", () => {
  assert.deepEqual(parseAuthFragment("#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=magiclink"), {
    ok: true,
    accessToken: "a.b.c",
    refreshToken: "r1",
  });
  assert.deepEqual(parseAuthFragment("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"), {
    ok: false,
    code: "otp_expired",
    message: "Email link is invalid or has expired",
  });
  // An error wins over tokens; a fragment missing either token is nothing.
  assert.equal(parseAuthFragment("#access_token=a&refresh_token=r&error=server_error")?.ok, false);
  assert.equal(parseAuthFragment("#access_token=a"), null);
  assert.equal(parseAuthFragment(""), null);
});

test("magic links are sent in the implicit flow and land on /auth/confirm (the default email works in any browser)", () => {
  const src = readFileSync(join(ROOT, "app/login/actions.ts"), "utf8");
  assert.match(src, /flowType: "implicit"/, "a PKCE link only works in the browser that asked for it");
  assert.match(src, /emailRedirectTo: `\$\{origin\}\/auth\/confirm\?next=/);
});

test("safeNextPath keeps same-origin paths and refuses everything else", () => {
  assert.equal(safeNextPath("/schools/166027?x=1#cost"), "/schools/166027?x=1#cost");
  assert.equal(safeNextPath("/me/list"), "/me/list");
  for (const bad of [
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "schools/1",
    "/login",
    "/login?next=/x",
    "/auth/callback?code=1",
    "/x\nSet-Cookie: a=b",
    "",
    null,
    42,
    "/" + "a".repeat(3000),
  ]) {
    assert.equal(safeNextPath(bad), "/account", JSON.stringify(bad));
  }
  assert.equal(safeNextPath("https://evil.example", "/"), "/");
});

test("loginHref encodes a safe return path and drops an unsafe one", () => {
  assert.equal(loginHref("/schools/1?a=b"), "/login?next=%2Fschools%2F1%3Fa%3Db");
  assert.equal(loginHref("https://evil.example"), "/login");
  assert.equal(loginHref(), "/login");
});

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

const student = (id: string, over: Partial<StudentRecord> = {}): StudentRecord => ({
  id,
  user_id: null,
  display_name: id,
  grad_year: null,
  managed_by: null,
  created: "2026-10-05",
  deleted_at: null,
  ...over,
});
const member = (over: Partial<HouseholdMember>): HouseholdMember => ({
  id: Math.random().toString(36),
  household_id: "h1",
  user_id: null,
  student_id: null,
  role: "guardian",
  status: "active",
  invited_email: null,
  can_edit: false,
  created: "2026-10-05",
  accepted_at: null,
  ...over,
});

test("resolveStudentAccess: self first and editable; guardians edit only managed records or with can_edit", () => {
  const me = "u-me";
  const access = resolveStudentAccess(
    me,
    [
      student("zoe", { user_id: "u-zoe" }), // reached through h1 (view only)
      student("amy", { user_id: "u-amy" }), // reached through h2 (can edit)
      student("ben", { managed_by: me }), // managed by me
      student("mine", { user_id: me }),
      student("gone", { user_id: "u-gone", deleted_at: "2026-10-01" }),
    ],
    [
      member({ household_id: "h1", user_id: me }),
      member({ household_id: "h1", role: "student", student_id: "zoe" }),
      member({ household_id: "h2", user_id: me, can_edit: true }),
      member({ household_id: "h2", role: "student", student_id: "amy" }),
      member({ household_id: "h3", user_id: me, can_edit: true, status: "invited" }),
      member({ household_id: "h3", role: "student", student_id: "zoe" }),
    ],
  );
  assert.deepEqual(
    access.map((a) => [a.student.id, a.relation, a.canEdit]),
    [
      ["mine", "self", true],
      ["amy", "guardian", true],
      ["ben", "guardian", true],
      ["zoe", "guardian", false],
    ],
  );
});

test("wantsOwnStudent: students (and people who didn't say) get a student record; guardians and counselors don't", () => {
  assert.deepEqual([wantsOwnStudent("student"), wantsOwnStudent(null), wantsOwnStudent("guardian"), wantsOwnStudent("counselor")], [true, true, false, false]);
});

test("initialsFor", () => {
  // One letter: the first name's (household-hub.md "Names, not logins").
  assert.equal(initialsFor("Ada Lovelace", "a@b.c"), "A");
  assert.equal(initialsFor("ada", null), "A");
  assert.equal(initialsFor("  Émile Zola", "z@b.c"), "É");
  assert.equal(initialsFor(null, "zed@example.com"), "Z");
  assert.equal(initialsFor("  ", null), "?");
});

/* ------------------------------------------------------------------ */
/* Email seam                                                          */
/* ------------------------------------------------------------------ */

const msg = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

test("sendEmail without RESEND_API_KEY/EMAIL_FROM sends nothing and says so", async () => {
  const logs: string[] = [];
  let called = false;
  const fetchSpy = (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch;
  for (const env of [{}, { RESEND_API_KEY: "k" }, { EMAIL_FROM: "Quad <x@y.z>" }]) {
    assert.equal(emailConfigured(env), false);
    assert.deepEqual(await sendEmail(msg, { env, fetch: fetchSpy, log: (m) => logs.push(m) }), { sent: false, reason: "not-configured" });
  }
  assert.equal(called, false);
  assert.equal(logs.length, 3);
});

test("sendEmail posts to Resend when configured, and reports failures without throwing", async () => {
  const env = { RESEND_API_KEY: "re_test", EMAIL_FROM: "Quad <hello@example.com>" };
  let request: { url: string; init: RequestInit } | undefined;
  const ok = (async (url: string, init: RequestInit) => {
    request = { url, init };
    return Response.json({ id: "em_1" });
  }) as unknown as typeof fetch;
  const result = await sendEmail({ ...msg, headers: { "List-Unsubscribe": "<https://x/u>" } }, { env, fetch: ok, log: () => {} });
  assert.deepEqual(result, { sent: true, id: "em_1" });
  assert.equal(request!.url, "https://api.resend.com/emails");
  assert.equal((request!.init.headers as Record<string, string>).Authorization, "Bearer re_test");
  assert.deepEqual(JSON.parse(request!.init.body as string), {
    from: "Quad <hello@example.com>",
    to: ["a@example.com"],
    subject: "Hi",
    html: "<p>Hi</p>",
    text: "Hi",
    headers: { "List-Unsubscribe": "<https://x/u>" },
  });

  const bad = (async () => new Response("domain not verified", { status: 403 })) as typeof fetch;
  const failed = await sendEmail(msg, { env, fetch: bad, log: () => {} });
  assert.equal(failed.sent, false);
  assert.equal(failed.sent === false && failed.reason, "error");

  const throws = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  assert.deepEqual(await sendEmail(msg, { env, fetch: throws, log: () => {} }), { sent: false, reason: "error", error: "network down" });
});

/* ------------------------------------------------------------------ */
/* Public pages stay static                                            */
/* ------------------------------------------------------------------ */

/**
 * Route prefixes (under app/) that may read cookies or the session. Account features add theirs here. Anything
 * else is a public page that must stay static/ISR.
 */
const ACCOUNT_ROUTES = ["/account", "/login", "/auth", "/api/me", "/me", "/invite", "/l", "/unsubscribe", "/api/cron"];

function underAccountRoute(path: string): boolean {
  return ACCOUNT_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
}

/** proxy.ts matcher entries that would run the session refresh outside account routes. */
function matcherProblems(matcher: string[]): string[] {
  return matcher.filter((m) => {
    const base = m.replace(/\/:path\*$/, "");
    return !base.startsWith("/") || /[(*]/.test(base) || !underAccountRoute(base);
  });
}

function proxyMatcher(): string[] {
  const src = readFileSync(join(ROOT, "proxy.ts"), "utf8");
  const block = src.match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(block, "proxy.ts must export config.matcher as a literal array");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("proxy.ts refreshes sessions on account routes only", () => {
  const matcher = proxyMatcher();
  assert.ok(matcher.includes("/account/:path*") && matcher.includes("/login") && matcher.includes("/api/me"), matcher.join(", "));
  assert.deepEqual(matcherProblems(matcher), []);
});

test("guard: the matcher check flags a catch-all or a public route", () => {
  assert.deepEqual(matcherProblems(["/account/:path*", "/((?!_next/static).*)", "/schools/:path*", "/"]), ["/((?!_next/static).*)", "/schools/:path*", "/"]);
});

const SESSION_READ = /from\s+["'](next\/headers|@\/lib\/auth|@\/lib\/supabase-server)["']|\bconnection\(\)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|mts)$/.test(name) ? [path] : [];
  });
}

/** Route path of a file under app/ ("/schools/[id]" for app/schools/[id]/page.tsx), ignoring route groups. */
function routeOf(file: string): string {
  const rel = relative(join(ROOT, "app"), file).split("/").slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return `/${rel.join("/")}`;
}

/** Files that read cookies/the session while rendering, outside account routes. Server Actions files are exempt. */
function sessionReadProblems(entries: { file: string; route: string; src: string }[]): string[] {
  return entries
    .filter(({ src }) => SESSION_READ.test(src) && !/^["']use server["']/m.test(src))
    .filter(({ route }) => !underAccountRoute(route))
    .map(({ file }) => file);
}

test("only account routes read cookies or the session (public pages stay static)", () => {
  const entries = files(join(ROOT, "app")).map((file) => ({ file: relative(ROOT, file), route: routeOf(file), src: readFileSync(file, "utf8") }));
  assert.deepEqual(sessionReadProblems(entries), []);
});

test("guard: a public page that reads the session is flagged", () => {
  const fake = [
    { file: "app/schools/[id]/page.tsx", route: "/schools/[id]", src: 'import { getUser } from "@/lib/auth";' },
    { file: "app/page.tsx", route: "/", src: 'import { cookies } from "next/headers";' },
    { file: "app/schools/[id]/actions.ts", route: "/schools/[id]", src: '"use server";\nimport { getUser } from "@/lib/auth";' },
    { file: "app/account/page.tsx", route: "/account", src: 'import { getUser } from "@/lib/auth";' },
  ];
  assert.deepEqual(sessionReadProblems(fake), ["app/schools/[id]/page.tsx", "app/page.tsx"]);
});
