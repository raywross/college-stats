/**
 * The admin console's organizations section (specs/product/counselor-portal.md "The channel";
 * specs/product/admin.md "the admin console lists organizations"; specs/product/admin-console-ui.md "Organizations"):
 * lib/admin/organizations.ts's reads over a fake Supabase client, the rail entry, the one-line additions on a
 * person's and a student's page, the glossary keys, and the telemetry registry entries. Pages are rendered for real
 * with react-dom/server, with Next.js and the console's auth stubbed the way tests/admin-edits.test.mts does.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "admin-organizations-"));

/* ------------------------------------------------------------------ */
/* Next.js and the console's auth, stood in for                       */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const NOT_FOUND = "const e=new Error('NEXT_HTTP_ERROR_FALLBACK;404');e.digest='NEXT_HTTP_ERROR_FALLBACK;404';throw e";
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "next/navigation": `export function notFound(){${NOT_FOUND}} export function redirect(u){const e=new Error('NEXT_REDIRECT');e.digest='NEXT_REDIRECT;replace;'+u+';307;';throw e}`,
  "next/server": "export async function connection(){}",
  "@/lib/admin/auth": `export async function requireAdmin(){globalThis.__world.calls.push('requireAdmin'); if(!globalThis.__world.admin){${NOT_FOUND}} return {userId:'admin-1'}}`,
  "@/lib/admin/people": "export async function adminSupabase(){globalThis.__world.calls.push('adminSupabase'); return globalThis.__world.supabase()}",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return stub(STUBS[specifier]);
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

interface World {
  admin: boolean;
  calls: string[];
  supabase: () => unknown;
}
const world: World = { admin: true, calls: [], supabase: () => ({}) };
(globalThis as unknown as { __world: World }).__world = world;
function reset(over: Partial<World> = {}) {
  Object.assign(world, { admin: true, calls: [] }, over);
}

let networkCalls = 0;
globalThis.fetch = (() => {
  networkCalls++;
  throw new Error("network call in a test");
}) as typeof fetch;

const { fakeSupabase } = await import("./helpers/fake-supabase.mts");
const orgs = await import("../lib/admin/organizations.ts");
const consoleLib = await import("../lib/admin/console.ts");
const orgRules = await import("../lib/org-rules.ts");
const { GLOSSARY, isTermKey } = await import("../lib/glossary.ts");
const { EVENTS } = await import("../lib/analytics.ts");

const is404 = (e: unknown) => (e as { digest?: string })?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const COUNSELOR = "44444444-4444-4444-8444-444444444444";
const STUDENT_WITH_ACCOUNT = "55555555-5555-4555-8555-555555555555";
const STUDENT_MANAGED = "66666666-6666-4666-8666-666666666666";

type OrgTableRow = { id: string; name: string; kind: string; ncessch: string | null; website: string | null; join_code: string; created: string; created_by: string; deleted_at: string | null };

function baseTables() {
  return {
    organizations: [
      { id: ORG_A, name: "Rivera College Consulting", kind: "iec", ncessch: null, website: "https://example.com", join_code: "RIVERA", created: "2026-10-01T12:00:00Z", created_by: OWNER, deleted_at: null },
      { id: ORG_B, name: "Lincoln High Counseling", kind: "school", ncessch: "100000100001", website: null, join_code: "LCOLHS", created: "2026-10-15T12:00:00Z", created_by: OWNER, deleted_at: null },
    ] as OrgTableRow[],
    org_members: [
      { id: "m1", org_id: ORG_A, user_id: OWNER, role: "owner", created: "2026-10-01T12:00:00Z" },
      { id: "m2", org_id: ORG_A, user_id: COUNSELOR, role: "counselor", created: "2026-10-02T12:00:00Z" },
    ],
    org_students: [
      { id: "g1", org_id: ORG_A, student_id: STUDENT_WITH_ACCOUNT, can_edit: true, source: "invite", granted_by: OWNER, granted_at: "2026-10-05T12:00:00Z", ended_at: null, ended_by: null },
      { id: "g2", org_id: ORG_A, student_id: STUDENT_MANAGED, can_edit: false, source: "code", granted_by: OWNER, granted_at: "2026-10-06T12:00:00Z", ended_at: null, ended_by: null },
    ],
    org_invitations: [
      { id: "i1", org_id: ORG_A, side: "student", email: "pending@example.com", display_name: "Pending Pat", grad_year: 2028, invited_by: OWNER, created: "2026-10-20T12:00:00Z", expires_at: "2099-01-01T00:00:00Z", accepted_at: null, accepted_by: null, revoked_at: null },
      { id: "i2", org_id: ORG_A, side: "student", email: "expired@example.com", display_name: null, grad_year: null, invited_by: OWNER, created: "2026-01-01T12:00:00Z", expires_at: "2026-02-01T00:00:00Z", accepted_at: null, accepted_by: null, revoked_at: null },
    ],
    org_requests: [
      { id: "a1", org_id: ORG_A, student_id: STUDENT_WITH_ACCOUNT, kind: "record_section", section: "scores", note: null, created_by: OWNER, created: "2026-10-10T12:00:00Z", done_at: null, seen_at: null },
      { id: "a2", org_id: ORG_A, student_id: STUDENT_WITH_ACCOUNT, kind: "custom", section: null, note: "Add your SAT score", created_by: OWNER, created: "2026-10-11T12:00:00Z", done_at: "2026-10-12T12:00:00Z", seen_at: "2026-10-12T12:00:00Z" },
    ],
    students: [
      { id: STUDENT_WITH_ACCOUNT, display_name: "Jordan River", grad_year: 2027, user_id: "jordan-user" },
      { id: STUDENT_MANAGED, display_name: "Sam Lee", grad_year: 2028, user_id: null },
    ],
    profiles: [
      { id: OWNER, display_name: "Pat Rivera" },
      { id: COUNSELOR, display_name: "Chris Lane" },
    ],
    high_schools: [{ id: "100000100001", data: { id: "100000100001", name: "Lincoln High School", city: "Springfield", state: "IL" } }],
  };
}

/* ------------------------------------------------------------------ */
/* lib/admin/organizations.ts                                         */
/* ------------------------------------------------------------------ */

test("requireAdmin() gates every read: a non-admin gets a 404 before any Supabase call", async () => {
  reset({ admin: false, supabase: () => fakeSupabase(baseTables()) });
  await assert.rejects(orgs.listOrganizations(1), is404);
  await assert.rejects(orgs.adminOrganization(ORG_A), is404);
  await assert.rejects(orgs.personOrganization(OWNER), is404);
  await assert.rejects(orgs.studentOrganizationGrants(STUDENT_WITH_ACCOUNT), is404);
  assert.equal(world.calls.includes("adminSupabase"), false);
});

test("listOrganizations: every organization, newest first, with kind, high school, members, and counts", async () => {
  reset({ supabase: () => fakeSupabase(baseTables()) });
  const { rows, total } = await orgs.listOrganizations(1);
  assert.equal(total, 2);
  assert.deepEqual(rows.map((r) => r.id), [ORG_B, ORG_A], "newest first");
  const a = rows.find((r) => r.id === ORG_A)!;
  assert.equal(a.kind, "iec");
  assert.equal(a.highSchoolName, null);
  assert.deepEqual(a.members, [{ name: "Pat Rivera", role: "owner" }, { name: "Chris Lane", role: "counselor" }]);
  assert.equal(a.liveStudents, 2);
  assert.equal(a.pendingInvitations, 1, "only the unexpired student invitation counts");
  const b = rows.find((r) => r.id === ORG_B)!;
  assert.equal(b.highSchoolName, "Lincoln High School, Springfield, IL");
  assert.equal(b.liveStudents, 0);
});

test("listOrganizations pages in code (there is no admin_list_organizations())", async () => {
  const tables = baseTables();
  // A third organization so paging at size 2 has something on page 2 (ORG_PAGE_SIZE is 50, so page a smaller size by hand).
  tables.organizations.push({ id: "77777777-7777-4777-8777-777777777777", name: "Third", kind: "iec", ncessch: null, website: null, join_code: "THIRD1", created: "2026-10-30T12:00:00Z", created_by: OWNER, deleted_at: null });
  reset({ supabase: () => fakeSupabase(tables) });
  const page1 = await orgs.listOrganizations(1);
  assert.equal(page1.total, 3);
  assert.equal(page1.rows.length, 3, "all fit on page 1 at ORG_PAGE_SIZE 50");
  const page2 = await orgs.listOrganizations(2);
  assert.equal(page2.rows.length, 0);
});

test("adminOrganization: members, live students with grant dates, invited students (never a token), and ask counts", async () => {
  reset({ supabase: () => fakeSupabase(baseTables()) });
  const detail = await orgs.adminOrganization(ORG_A);
  assert.ok(detail);
  assert.equal(detail!.joinCode, "RIVERA");
  assert.equal(detail!.members.length, 2);
  assert.equal(detail!.members[0].role, "owner", "owners first");
  assert.deepEqual(
    detail!.students.map((s) => s.name),
    ["Jordan River", "Sam Lee"],
  );
  const jordan = detail!.students.find((s) => s.name === "Jordan River")!;
  assert.equal(jordan.granted_at, "2026-10-05T12:00:00Z");
  assert.equal(jordan.has_account, true);
  assert.equal(jordan.can_edit, true);
  const sam = detail!.students.find((s) => s.name === "Sam Lee")!;
  assert.equal(sam.has_account, false);
  assert.equal(sam.can_edit, false);
  assert.equal(detail!.invitedStudents.length, 2);
  const invited = detail!.invitedStudents.find((i) => i.display_name === "Pending Pat")!;
  assert.equal(invited.state, "invited");
  const expired = detail!.invitedStudents.find((i) => i.email === "expired@example.com")!;
  assert.equal(expired.state, "expired");
  for (const i of detail!.invitedStudents as unknown as Record<string, unknown>[]) assert.ok(!("token" in i) && !("token_hash" in i));
  assert.equal(detail!.asks.total, 2);
  assert.equal(detail!.asks.open, 1);
  assert.equal(await orgs.adminOrganization("00000000-0000-0000-0000-000000000099"), null);
});

test("no read in lib/admin/organizations.ts selects an invitation's token or token_hash", () => {
  const src = read("lib/admin/organizations.ts");
  for (const m of src.matchAll(/\.select\("([^"]+)"\)/g)) {
    assert.doesNotMatch(m[1], /\btoken\b|\btoken_hash\b/, m[1]);
  }
});

test("personOrganization: the person's organization and role, or null", async () => {
  reset({ supabase: () => fakeSupabase(baseTables()) });
  const owner = await orgs.personOrganization(OWNER);
  assert.deepEqual(owner, { org_id: ORG_A, org_name: "Rivera College Consulting", role: "owner" });
  const counselor = await orgs.personOrganization(COUNSELOR);
  assert.equal(counselor?.role, "counselor");
  assert.equal(await orgs.personOrganization("no-such-user"), null);
});

test("studentOrganizationGrants: a student's live grants, organization name and since when, oldest first", async () => {
  reset({ supabase: () => fakeSupabase(baseTables()) });
  const grants = await orgs.studentOrganizationGrants(STUDENT_WITH_ACCOUNT);
  assert.deepEqual(grants, [{ org_id: ORG_A, org_name: "Rivera College Consulting", granted_at: "2026-10-05T12:00:00Z" }]);
  assert.deepEqual(await orgs.studentOrganizationGrants("no-such-student"), []);
});

/* ------------------------------------------------------------------ */
/* The rail                                                            */
/* ------------------------------------------------------------------ */

test("the rail lists Organizations right after Households, linking to /admin/organizations", () => {
  const keys = consoleLib.ADMIN_SECTIONS.map((s) => s.key);
  const hIdx = keys.indexOf("households");
  assert.equal(keys[hIdx + 1], "organizations");
  const section = consoleLib.ADMIN_SECTIONS.find((s) => s.key === "organizations")!;
  assert.equal(section.href, "/admin/organizations");
  assert.equal(consoleLib.activeSection("/admin/organizations"), "organizations");
  assert.equal(consoleLib.activeSection(`/admin/organizations/${ORG_A}`), "organizations");
});

/* ------------------------------------------------------------------ */
/* Pages, rendered for real                                            */
/* ------------------------------------------------------------------ */

const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);`);

function stubModule(name: string, names: string[]): string {
  const file = join(tmp, `stub-${name}.mjs`);
  writeFileSync(
    file,
    `import React from ${JSON.stringify(reactUrl)};
const make = (n) => ({ children, ...props }) => {
  const plain = Object.fromEntries(Object.entries(props).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) || v === null));
  return React.createElement("div", { "data-stub": n, "data-props": JSON.stringify(plain) }, children);
};
${names.map((n) => `export const ${n} = make(${JSON.stringify(n)});`).join("\n")}\n`,
  );
  return pathToFileURL(file).href;
}

/** Transpiles a page .tsx; component imports become stand-ins, except those in `real`, which are transpiled too. */
async function loadTsx(rel: string, real: string[] = []): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  let n = 0;
  const reals: Record<string, string> = {};
  for (const r of real) {
    await loadTsx(`${r.slice(2)}.tsx`);
    reals[r] = pathToFileURL(join(tmp, `${`${r.slice(2)}.tsx`.replace(/[^a-z]/gi, "_")}.mjs`)).href;
  }
  const code = outputText
    .replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`)
    .replace(/from "next\/link"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`)
    .replace(/import \{([^}]*)\} from "(@\/components\/[^"]+)";/g, (_m, names: string, spec: string) => {
      if (reals[spec]) return `import {${names}} from ${JSON.stringify(reals[spec])};`;
      const list = names.split(",").map((s) => s.trim().replace(/^type\s+/, "").split(" as ").pop()!.trim()).filter(Boolean);
      return `import {${names}} from ${JSON.stringify(stubModule(`${rel.replace(/[^a-z]/gi, "_")}${n++}-${spec.split("/").pop()}`, list))};`;
    });
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}
type ListPage = (props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) => Promise<import("react").ReactElement>;
type DetailPage = (props: { params: Promise<{ id: string }> }) => Promise<import("react").ReactElement>;

test("the organizations list page: a 404 signed out; for an admin, every organization with its kind, members, and counts", async () => {
  const page = (await loadTsx("app/admin/organizations/page.tsx", ["@/components/admin/Panel", "@/components/admin/StatusChip"])).default as ListPage;
  reset({ admin: false, supabase: () => fakeSupabase(baseTables()) });
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), is404);

  reset({ admin: true, supabase: () => fakeSupabase(baseTables()) });
  const markup = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
  assert.match(markup, /Rivera College Consulting/);
  assert.match(markup, /Lincoln High Counseling/);
  assert.match(markup, /Lincoln High School, Springfield, IL/);
  assert.match(markup, new RegExp(`href="/admin/organizations/${ORG_A}"`));
  assert.match(markup, /Pat Rivera/);
  assert.match(markup, /2 students/);
  assert.doesNotMatch(markup, /token/i);
});

test("the organization page: members link to their person page, students link to their student page, invited students never show a token", async () => {
  const page = (await loadTsx("app/admin/organizations/[id]/page.tsx", ["@/components/admin/Panel", "@/components/admin/StatusChip"])).default as DetailPage;
  reset({ admin: true, supabase: () => fakeSupabase(baseTables()) });
  const markup = renderToStaticMarkup(await page({ params: Promise.resolve({ id: ORG_A }) }));
  assert.match(markup, new RegExp(`href="/admin/people/${OWNER}"[^>]*>Pat Rivera`));
  assert.match(markup, new RegExp(`href="/admin/students/${STUDENT_WITH_ACCOUNT}"[^>]*>Jordan River`));
  assert.doesNotMatch(markup, new RegExp(`href="/admin/students/${STUDENT_MANAGED}"`), "a managed student with no account isn't linked");
  assert.match(markup, /Sam Lee/);
  assert.match(markup, />View only</);
  assert.match(markup, /Pending Pat/);
  assert.match(markup, />Invited</);
  assert.match(markup, />Expired</);
  assert.match(markup, /QUAD-RIVERA/);
  assert.match(markup, /the console holds no token/);
  // The only mention of "token" is that sentence; no actual token value (a copy-link hex string) ever appears.
  assert.equal((markup.match(/token/gi) ?? []).length, 1);

  reset({ admin: true, supabase: () => fakeSupabase(baseTables()) });
  await assert.rejects(page({ params: Promise.resolve({ id: "not-a-uuid" }) }), is404);
  await assert.rejects(page({ params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000099" }) }), is404);
});

test("static: both pages call connection() then requireAdmin() first, and are noindex", () => {
  for (const f of ["app/admin/organizations/page.tsx", "app/admin/organizations/[id]/page.tsx"]) {
    const src = read(f);
    assert.match(src.slice(src.indexOf("export default async function")), /\{\n\s+await connection\(\);\n\s+await requireAdmin\(\);/);
    assert.match(src, /robots: \{ index: false, follow: false \}/);
  }
});

test("the organizations page never shows a student's lists, numbers, or plan (that's the student page's job, and it logs)", () => {
  for (const f of ["app/admin/organizations/page.tsx", "app/admin/organizations/[id]/page.tsx"]) {
    assert.doesNotMatch(read(f), /adminStudent\(|\.lists\b.*items|student\.profile/, f);
  }
});

/* ------------------------------------------------------------------ */
/* The one-line additions on the person and student pages              */
/* ------------------------------------------------------------------ */

test("the person page reads personOrganization and names it 'Counselor organization', linking to the organization", () => {
  const src = read("app/admin/people/[user]/page.tsx");
  assert.match(src, /personOrganization\(profile\.id\)/);
  assert.match(src, /Counselor organization/);
  assert.match(src, /\/admin\/organizations\/\$\{organization\.org_id\}/);
});

test("the student page reads studentOrganizationGrants and names it 'Counselor access', with organization name and since when", () => {
  const src = read("app/admin/students/[id]/page.tsx");
  assert.match(src, /studentOrganizationGrants\(id\)/);
  assert.match(src, /Counselor access/);
  assert.match(src, /\/admin\/organizations\/\$\{g\.org_id\}/);
  assert.match(src, /since \{fmtDate\(g\.granted_at\)\}/);
});

/* ------------------------------------------------------------------ */
/* Glossary                                                            */
/* ------------------------------------------------------------------ */

test("the four counselor-portal glossary keys exist, each with a term, a short definition, a category, and valid related keys", () => {
  for (const key of ["counselor-organization", "join-code", "counselor-access", "ask"] as const) {
    assert.ok(isTermKey(key), key);
    const entry = GLOSSARY[key];
    assert.ok(entry.term.trim().length > 0, key);
    assert.ok(entry.short.trim().length > 0, key);
    assert.equal(entry.category, "Your account", key);
    for (const r of entry.related ?? []) assert.ok(isTermKey(r), `${key} relates to ${r}`);
  }
});

test("the access log's entry now relates to counselor access too (a counselor's reads show there, like a guardian's)", () => {
  assert.ok(GLOSSARY["access-log"].related?.includes("counselor-access"));
});

/* ------------------------------------------------------------------ */
/* Telemetry                                                           */
/* ------------------------------------------------------------------ */

test("the five counselor-portal events are registered with the brief's exact property shapes", () => {
  assert.deepEqual(EVENTS.org_created.properties, ["kind"]);
  assert.equal(EVENTS.org_created.side, "server");
  assert.deepEqual(EVENTS.org_student_invited.properties, ["method"]);
  assert.deepEqual(EVENTS.org_student_joined.properties, ["source", "new_account"]);
  assert.equal(EVENTS.org_student_joined.side, "server");
  assert.deepEqual(EVENTS.org_ask_sent.properties, ["kind"]);
  assert.equal(EVENTS.org_ask_sent.side, "server");
  assert.deepEqual(EVENTS.org_caseload_viewed.properties, ["size"]);
});

/* ------------------------------------------------------------------ */
/* Pure org-rules used by this module                                  */
/* ------------------------------------------------------------------ */

test("ORG_KIND_LABEL and formatJoinCode (used by the admin pages) read as the pages expect", () => {
  assert.equal(orgRules.ORG_KIND_LABEL.iec, "Independent consultant");
  assert.equal(orgRules.ORG_KIND_LABEL.school, "School counseling office");
  assert.equal(orgRules.formatJoinCode("RIVERA"), "QUAD-RIVERA");
});

test("no network call happened in this file", () => {
  assert.equal(networkCalls, 0);
});
