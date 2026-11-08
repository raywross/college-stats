/**
 * The header's role item and the phone's middle tab (specs/product/role-nav.md): the role rule `/api/me` applies
 * (lib/accounts.ts meRoleOf), what `roleNav()` shows each role (components/layout/role-nav.ts), the avatar menu's
 * remaining links, the wiring in Header.tsx and BottomNav.tsx, and the pages that refresh the header's answer. No
 * network, no database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { meRoleOf, type MeState } from "../lib/accounts.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

// `@/…` imports resolve to the repo root (components/layout/role-nav.ts reads lib/ through the alias).
type ResolveResult = { url: string; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
const { registerHooks } = nodeModule as unknown as { registerHooks(hooks: { resolve(s: string, c: { parentURL?: string }, n: NextResolve): ResolveResult }): void };
const asFile = (b: string) => [b, `${b}.ts`, `${b}.tsx`].find((c) => existsSync(c)) ?? null;
registerHooks({
  resolve(specifier, context, next) {
    let b: string | null = null;
    if (specifier.startsWith("@/")) b = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !context.parentURL.includes("/node_modules/")) b = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = b ? (/\.tsx?$/.test(b) && existsSync(b) ? b : asFile(b)) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    return next(specifier, context);
  },
});

const { roleNav, childEntryLabel } = (await import("../components/layout/role-nav.ts")) as typeof import("../components/layout/role-nav.ts");
const { accountMenuLinks } = (await import("../components/account/account-menu-links.ts")) as typeof import("../components/account/account-menu-links.ts");

const me = (over: Partial<MeState>): MeState => ({ configured: true, signedIn: true, id: "u1", name: "Tracy Ross", email: "t@example.com", org: false, admin: false, role: "student", children: [], ...over });
const kids = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Jordan Ross" },
  { id: "22222222-2222-4222-8222-222222222222", name: null },
];

test("the role rule: a member of an organization is a counselor whatever else; a student on the roster or a guardian role hint makes a guardian; else a student", () => {
  assert.equal(meRoleOf({ org: true, roleHint: "student", children: 0 }), "counselor");
  assert.equal(meRoleOf({ org: true, roleHint: "guardian", children: 2 }), "counselor", "a counselor who is also a parent keeps the Caseload item");
  assert.equal(meRoleOf({ org: false, roleHint: "guardian", children: 0 }), "guardian", "said 'a parent or guardian' at sign-up, nobody added yet");
  assert.equal(meRoleOf({ org: false, roleHint: "student", children: 1 }), "guardian", "a guardian whose sign-up role was never switched (the form defaults to student)");
  assert.equal(meRoleOf({ org: false, roleHint: null, children: 1 }), "guardian");
  assert.equal(meRoleOf({ org: false, roleHint: "student", children: 0 }), "student");
  assert.equal(meRoleOf({ org: false, roleHint: null, children: 0 }), "student");
  assert.equal(meRoleOf({ org: false, roleHint: "counselor", children: 0 }), "student", "a counselor role hint without an organization yet: nothing to show but their own advisor");
});

test("Advisor, a plain link, for a student, a signed-out visitor, and an answer not yet in", () => {
  for (const m of [null, me({ signedIn: false, role: null }), me({ role: "student" }), me({ role: "student", children: kids })]) {
    const nav = roleNav(m);
    assert.equal(nav.label, "Advisor");
    assert.equal(nav.href, "/advisor");
    assert.deepEqual(nav.menu, []);
    assert.deepEqual(nav.activePaths, ["/advisor"]);
  }
});

test("Household for a guardian: one click to the advisor, each child's advisor by name in the menu, then Manage household", () => {
  const nav = roleNav(me({ role: "guardian", children: kids }));
  assert.equal(nav.label, "Household");
  assert.equal(nav.href, "/advisor", "the last child's advisor opens (the people line is the switcher)");
  assert.deepEqual(
    nav.menu.map((e) => [e.kind, e.label, e.href]),
    [
      ["child", "Jordan's advisor", `/advisor?for=${kids[0].id}`],
      ["child", "Their advisor", `/advisor?for=${kids[1].id}`],
      ["page", "Manage household", "/household"],
    ],
  );
  assert.deepEqual(nav.activePaths, ["/advisor", "/household"]);
  assert.equal(childEntryLabel("  Maya  Chen "), "Maya's advisor");
  assert.equal(childEntryLabel(""), "Their advisor");
});

test("a guardian with nobody on the roster yet: Household goes to the household page, and the menu says Add someone", () => {
  const nav = roleNav(me({ role: "guardian", children: [] }));
  assert.equal(nav.href, "/household");
  assert.deepEqual(nav.menu.map((e) => [e.kind, e.label, e.href]), [["page", "Add someone", "/household"]]);
});

test("Caseload for a counselor: one click to /org; Add students and Members and settings in the menu; a counselor who is also a parent gets their children and Household after", () => {
  const nav = roleNav(me({ role: "counselor", org: true }));
  assert.equal(nav.label, "Caseload");
  assert.equal(nav.href, "/org");
  assert.deepEqual(nav.menu.map((e) => [e.kind, e.label, e.href]), [
    ["page", "Add students", "/org/students/new"],
    ["page", "Members and settings", "/org/members"],
  ]);
  assert.deepEqual(nav.activePaths, ["/org", "/advisor", "/household"], "a caseload student's advisor lights Caseload");
  const parentToo = roleNav(me({ role: "counselor", org: true, children: kids.slice(0, 1) }));
  assert.deepEqual(parentToo.menu.map((e) => [e.kind, e.label]), [
    ["page", "Add students"],
    ["page", "Members and settings"],
    ["child", "Jordan's advisor"],
    ["page", "Household"],
  ]);
});

test("every menu entry has an icon and a caption for the phone's More sheet, which lists the pages only", () => {
  for (const m of [me({ role: "guardian", children: kids }), me({ role: "guardian" }), me({ role: "counselor", org: true, children: kids })]) {
    for (const e of roleNav(m).menu) {
      assert.ok(e.icon, e.label);
      assert.ok(e.sub.length > 0, e.label);
    }
  }
  const bottom = read("components", "layout", "BottomNav.tsx");
  assert.match(bottom, /role\.menu\.filter\(\(e\) => e\.kind === "page"\)\.map/);
  assert.doesNotMatch(bottom, /CASELOAD_HREF|Briefcase/, "the sheet's own Caseload row is gone; the role item carries it");
});

test("the avatar menu keeps the personal things: Household for a student only, Your account, Admin for an admin", () => {
  assert.deepEqual(accountMenuLinks({ role: "student" }).map((l) => l.label), ["Household", "Your account"]);
  assert.deepEqual(accountMenuLinks({ role: "guardian" }).map((l) => l.label), ["Your account"]);
  assert.deepEqual(accountMenuLinks({ role: "counselor", admin: true }).map((l) => l.label), ["Your account", "Admin"]);
  assert.deepEqual(accountMenuLinks({ role: null }).map((l) => l.label), ["Household", "Your account"]);
});

test("the header renders the role item in the Advisor slot, the tab bar in the middle, and both read roleNav(me)", () => {
  const header = read("components", "layout", "Header.tsx");
  assert.match(header, /const role = roleNav\(me\);/);
  assert.match(header, /if \(item\.href === ADVISOR_PATH\) return <RoleNavItem key=\{item\.href\} nav=\{role\} dot=\{planDot\} \/>;/);
  const bottom = read("components", "layout", "BottomNav.tsx");
  assert.match(bottom, /const role = roleNav\(me\);/);
  assert.match(bottom, /<Tab href=\{role\.href\} label=\{role\.label\} icon=\{<RoleIcon \/>\} active=\{roleActive && !sheet\}/);
  const item = read("components", "layout", "RoleNavItem.tsx");
  assert.match(item, /<Link\s+href=\{nav\.href\}/, "the label is a link, one click to the role's page");
  assert.match(item, /\{hasMenu && \(\s*<Menu\.Root>/, "the chevron opens the menu only when there is one");
});

test("/api/me answers role and children, and the pages where they change refresh the header", () => {
  const route = read("app", "api", "me", "route.ts");
  assert.match(route, /meRoleOf\(\{ org, roleHint: profile\.roleHint, children: children\.length \}\)/);
  assert.match(route, /householdChildren\(\)/);
  assert.match(route, /role: null, children: \[\]/, "signed out: no role");
  assert.match(read("components", "account", "useMe.ts"), /"role" in parsed\.data/, "a stored answer from before the role item is stale");
  assert.match(read("app", "household", "layout.tsx"), /<RefreshHeader \/>/, "adding a child or becoming a guardian shows at once");
  // /org says what it knows, so the header is asked again only when its answer disagrees (tests/counselor-perf-pages).
  assert.match(read("app", "org", "page.tsx"), /<RefreshHeader org=\{false\} \/>/);
  assert.match(read("app", "org", "page.tsx"), /<RefreshHeader org \/>/);
});
