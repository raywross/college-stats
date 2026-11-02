/**
 * Joining a counselor, the account, and the way in (specs/product/counselor-portal.md "How a student joins", "The
 * student's side", "The channel"): the join page's decision (lib/join-rules.ts joinState) and every state it renders
 * (JoinView, with react-dom/server, from fabricated previews and access lists); a token told from a code;
 * parseJoinCode and what /join accepts typed; the `next` round trip through sign-in and sign-up keeping the code;
 * "Your counselors" with and without grants, for a student and for a parent; the access log naming a counselor's
 * role; the menu's Caseload only for members; a new counselor's first landing; and the wiring (routes, proxy,
 * telemetry, metadata). No network, no database (tests/join-db.test.mts runs the joins against Postgres). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { ReactElement } from "react";
import { firstLanding, safeNextPath } from "../lib/accounts.ts";
import { groupAccessLog } from "../lib/household-rules.ts";
import {
  isNewAccount,
  joinPath,
  joinState,
  joinTarget,
  joinedHref,
  namesLine,
  signUpHref,
  typedJoinPath,
  type JoinCodePreview,
  type JoinInput,
  type JoinInvitationPreview,
  type JoinState,
} from "../lib/join-rules.ts";
import { ORG_ERRORS, parseJoinCode, type CounselorGrantView } from "../lib/org-rules.ts";
import { FRESH_CONFIRMATION_MS } from "../lib/signup-events-rules.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TOKEN = "ab".repeat(32);
const CODE: JoinCodePreview = { org_name: "Rivera Advising", org_kind: "iec", join_code: "RIVERA", counselor_names: ["Ms. Rivera", "Mr. Lee"] };
const invitation = (over: Partial<JoinInvitationPreview> = {}): JoinInvitationPreview => ({
  org_name: "Rivera Advising",
  org_kind: "iec",
  inviter_name: "Ms. Rivera",
  side: "student",
  display_name: "Alice Smith",
  expires_at: "2026-12-01T00:00:00Z",
  state: "pending",
  ...over,
});
const student = { ownStudentId: "s-alice", guardianOf: [] };
const parent = { ownStudentId: null, guardianOf: [{ id: "s-ben", name: "Ben Smith" }, { id: "s-cara", name: "Cara Smith" }] };
const nobody = { ownStudentId: null, guardianOf: [] };
const byCode = (viewer: JoinInput["viewer"], segment = "QUAD-RIVERA"): JoinState => joinState({ segment, codePreview: CODE, invitationPreview: null, viewer });
const byInvite = (viewer: JoinInput["viewer"], over: Partial<JoinInvitationPreview> = {}): JoinState =>
  joinState({ segment: TOKEN, codePreview: null, invitationPreview: invitation(over), viewer });

/* ------------------------------------------------------------------ */
/* Codes and tokens                                                    */
/* ------------------------------------------------------------------ */

test("a token is told from a code: 64 hex is an invitation, letters are a code, anything else is neither", () => {
  assert.deepEqual(joinTarget(TOKEN), { kind: "invitation", token: TOKEN });
  assert.deepEqual(joinTarget("RIVERA"), { kind: "code", code: "RIVERA" });
  assert.deepEqual(joinTarget("quad-rivera"), { kind: "code", code: "RIVERA" });
  assert.deepEqual(joinTarget("QUAD%20RIVERA"), { kind: "code", code: "RIVERA" }, "a URL-encoded space");
  assert.deepEqual(joinTarget("AB".repeat(32)), { kind: "invalid" }, "capital hex is no token, and too long for a code");
  assert.deepEqual(joinTarget("ab".repeat(31)), { kind: "invalid" }, "62 hex: neither");
  assert.deepEqual(joinTarget("abc"), { kind: "invalid" }, "too short for a code");
  assert.deepEqual(joinTarget("%E0%A4%A"), { kind: "invalid" }, "a broken escape reads as typed");
});

test("parseJoinCode: case, spaces, and the QUAD- prefix don't matter; 4 to 6 letters", () => {
  const cases: [unknown, string | null][] = [
    ["QUAD-RIVERA", "RIVERA"],
    ["rivera", "RIVERA"],
    [" quad rivera ", "RIVERA"],
    ["Quad-Kobe", "KOBE"],
    ["BOB", null],
    ["RIVERAS1", null],
    ["", null],
    [42, null],
    [null, null],
  ];
  for (const [input, want] of cases) assert.equal(parseJoinCode(input), want, JSON.stringify(input));
});

test("/join accepts what people type or paste and opens /join/<CODE>", () => {
  assert.equal(typedJoinPath("quad-rivera"), "/join/RIVERA");
  assert.equal(typedJoinPath("  Rivera "), "/join/RIVERA");
  assert.equal(typedJoinPath("https://usequad.app/join/QUAD-RIVERA"), "/join/RIVERA");
  assert.equal(typedJoinPath(`https://usequad.app/join/${TOKEN}?x=1`), `/join/${TOKEN}`);
  assert.equal(typedJoinPath("hello world, this is long"), null);
  assert.equal(typedJoinPath("ab"), null);
  assert.equal(typedJoinPath(undefined), null);
});

test("the next round trip keeps the code (and the token) through Sign in and Create an account", () => {
  for (const segment of ["QUAD-RIVERA", "rivera", TOKEN]) {
    const state = segment === TOKEN ? byInvite(null) : byCode(null, segment);
    assert.equal(state.kind, "signed_out");
    if (state.kind !== "signed_out") continue;
    const want = segment === TOKEN ? `/join/${TOKEN}` : "/join/RIVERA";
    const signIn = new URL(state.signInHref, "https://quad.test");
    assert.equal(signIn.pathname, "/login");
    assert.equal(safeNextPath(signIn.searchParams.get("next")), want, `sign in returns to ${want}`);
    const signUp = new URL(state.signUpHref, "https://quad.test");
    assert.equal(signUp.searchParams.get("mode"), "signup");
    assert.equal(signUp.searchParams.get("role"), "student", "the sign-up role defaults to student");
    assert.equal(safeNextPath(signUp.searchParams.get("next")), want, `sign up returns to ${want}`);
  }
  // A counselor-side invitation's sign-up picks "A counselor".
  const counselor = byInvite(null, { side: "counselor" });
  assert.equal(counselor.kind === "signed_out" && new URL(counselor.signUpHref, "https://q.test").searchParams.get("role"), "counselor");
  assert.equal(joinPath("not a code!!"), "/join");
  assert.equal(signUpHref("//evil.test"), "/login?mode=signup&role=student", "a foreign next is dropped");
  // The login page reads ?role= and ?mode=, and the form takes the role for both sign-up paths.
  const login = read("app/login/page.tsx");
  assert.match(login, /initialRole=\{isRoleHint\(params\.role\) \? params\.role : "student"\}/);
  assert.equal((read("app/login/LoginForm.tsx").match(/name="role_hint" defaultValue=\{role\}/g) ?? []).length, 2);
});

/* ------------------------------------------------------------------ */
/* The decision                                                        */
/* ------------------------------------------------------------------ */

test("joinState: every state from the previews and who is looking", () => {
  assert.deepEqual(joinState({ segment: "NOPE", codePreview: null, invitationPreview: null, viewer: null }), { kind: "not_found", message: ORG_ERRORS.no_such_code });
  assert.deepEqual(joinState({ segment: TOKEN, codePreview: null, invitationPreview: null, viewer: student }), { kind: "not_found", message: ORG_ERRORS.invitation_not_found });
  assert.equal(joinState({ segment: "!!", codePreview: CODE, invitationPreview: null, viewer: null }).kind, "not_found", "a preview never rescues a bad segment");

  for (const [st, msg] of [
    ["accepted", ORG_ERRORS.invitation_used],
    ["expired", ORG_ERRORS.invitation_expired],
    ["revoked", ORG_ERRORS.invitation_revoked],
  ] as const) {
    for (const viewer of [null, student]) {
      const s = byInvite(viewer, { state: st });
      assert.equal(s.kind, "closed", `${st} ${viewer ? "signed in" : "signed out"}`);
      assert.equal(s.kind === "closed" && s.message, msg);
    }
  }

  assert.equal(byCode(null).kind, "signed_out");
  const self = byCode(student);
  assert.deepEqual(self.kind === "student" && self.segment, "RIVERA", "the code goes to the form in its stored form");
  const pick = byCode(parent);
  assert.equal(pick.kind, "guardian");
  assert.deepEqual(pick.kind === "guardian" && pick.students.map((s) => s.id), ["s-ben", "s-cara"]);
  assert.equal(byCode(nobody).kind, "not_for_you");
  // A student with a parent's reach too joins for their own record.
  assert.equal(byCode({ ownStudentId: "s-alice", guardianOf: [{ id: "s-ben", name: "Ben" }] }).kind, "student");

  const inv = byInvite(student);
  assert.equal(inv.kind === "student" && inv.segment, TOKEN);
  assert.equal(inv.kind === "student" && inv.asker.line, "Ms. Rivera invited you");
  assert.equal(inv.kind === "student" && inv.asker.greet, "Alice");
  assert.equal(byInvite(nobody, { side: "counselor" }).kind, "counselor_invite", "a counselor's invitation needs no student");
  assert.equal(byInvite(parent).kind, "guardian");
  assert.equal(byCode(student).kind === "student" && (byCode(student) as Extract<JoinState, { kind: "student" }>).asker.line, "Ms. Rivera and Mr. Lee");
});

test("namesLine: one, two, three, and many counselors", () => {
  assert.equal(namesLine([]), null);
  assert.equal(namesLine([" "]), null);
  assert.equal(namesLine(["Ms. Rivera"]), "Ms. Rivera");
  assert.equal(namesLine(["A", "B"]), "A and B");
  assert.equal(namesLine(["A", "B", "C"]), "A, B, and C");
  assert.equal(namesLine(["A", "B", "C", "D", "E"]), "A, B, and 3 others");
});

test("new_account: confirmed in the last two minutes (as signup_completed judges it), or a profile that new", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(isNewAccount({ email_confirmed_at: ago(30_000) }, now), true);
  assert.equal(isNewAccount({ email_confirmed_at: ago(FRESH_CONFIRMATION_MS + 1000) }, now), false);
  assert.equal(isNewAccount({ email_confirmed_at: ago(86_400_000), profileCreated: ago(60_000) }, now), true);
  assert.equal(isNewAccount({ email_confirmed_at: ago(86_400_000), profileCreated: ago(86_400_000) }, now), false);
  assert.equal(isNewAccount({}, now), false);
});

test("a join lands on the student's advisor with the notice", () => {
  assert.equal(joinedHref("/advisor", "g1"), "/advisor?joined=g1");
  assert.equal(joinedHref("/advisor?for=s1", "g1"), "/advisor?for=s1&joined=g1");
  const action = read("app", "join", "[code]", "actions.ts");
  assert.match(action, /planHref\(\{ person: studentId \}\)/);
  assert.match(action, /redirect\(CASELOAD_HREF\)/, "a counselor-side invitation lands on the caseload");
  assert.match(action, /trackServer\("org_student_joined", \{ source: target\.kind === "invitation" \? "invite" : "code", new_account: await newAccount\(\) \}\)/);
  assert.match(action, /currentStudent\(\)/, "the student's own record is made if missing");
  assert.match(read("app", "advisor", "page.tsx"), /<JoinedNotice grantId=\{joined\}/);
});

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
type NextLoad = (url: string, context: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(s: string, c: { parentURL?: string }, n: NextResolve): ResolveResult; load(u: string, c: unknown, n: NextLoad): LoadResult }): void;
};

const STUB_DIR = join(ROOT, "__join_page_stubs__");
const STUBS: Record<string, string> = {
  "next/link": `import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return React.createElement("a", { href, ...rest }, children); }`,
  "next/navigation": `export function redirect(to) { throw Object.assign(new Error("redirect"), { to }); } export function useRouter() { return { push() {}, refresh() {} }; }`,
  "join-actions": `export async function joinOrganization() { return { status: "idle" }; }`,
  "@/app/account/counselor-actions": `export async function setCounselorCanEdit() { return { status: "done" }; } export async function endCounselorAccess() { return { status: "done" }; }`,
  "@/lib/orgs": `export async function myCounselorGrants() { return globalThis.__joinGrants ?? []; }`,
};
const stubUrl = (name: string) => pathToFileURL(join(STUB_DIR, `${name.replace(/[^a-z]/gi, "_")}.mjs`)).href;
const STUB_SOURCES = new Map(Object.entries(STUBS).map(([name, src]) => [stubUrl(name), src]));
const asFile = (b: string) => [b, `${b}.ts`, `${b}.tsx`].find((c) => existsSync(c)) ?? null;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./actions" && context.parentURL?.includes("/app/join/")) return { url: stubUrl("join-actions"), shortCircuit: true };
    if (specifier in STUBS) return { url: stubUrl(specifier), shortCircuit: true };
    let b: string | null = null;
    if (specifier.startsWith("@/")) b = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) b = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = b ? (/\.tsx?$/.test(b) && existsSync(b) ? b : asFile(b)) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    if (context.parentURL && STUB_SOURCES.has(context.parentURL)) return next(specifier, { ...context, parentURL: pathToFileURL(join(ROOT, "package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    const stub = STUB_SOURCES.get(url);
    if (stub) return { format: "module", source: stub, shortCircuit: true };
    if (url.startsWith("file:") && /\.tsx$/.test(url) && !url.includes("/node_modules/")) {
      const file = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const view = (await import("../app/join/[code]/JoinView.tsx")) as {
  JoinView: (p: { state: JoinState; signedIn: boolean }) => ReactElement;
  notForYouLine: (org: string) => string;
};
const { CounselorsSection } = (await import("../components/account/CounselorsSection.tsx")) as { CounselorsSection: (p: { grants: CounselorGrantView[]; first?: string | null }) => ReactElement | null };
const { JoinedLine } = (await import("../components/account/JoinedNotice.tsx")) as { JoinedLine: (p: { orgName: string; settings: string }) => ReactElement };
const { accountMenuLinks } = (await import("../components/account/account-menu-links.ts")) as { accountMenuLinks: (me: { org?: boolean }) => { href: string; label: string }[] };
const CodePage = (await import("../app/join/page.tsx")) as { default: (p: { searchParams: Promise<{ code?: string }> }) => Promise<ReactElement> };

const decode = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (state: JoinState, signedIn = true) => decode(renderToStaticMarkup(React.createElement(view.JoinView, { state, signedIn })));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("render: signed out shows who is asking, the truth, and Sign in / Create an account back here", () => {
  const html = render(byCode(null), false);
  assert.match(html, /<h1[^>]*>Join Rivera Advising<\/h1>/);
  assert.match(text(html), /With Ms\. Rivera and Mr\. Lee\./);
  assert.match(text(html), /Rivera Advising will have access to your record, your college list and advisor, and your essays\./);
  assert.match(html, /never see your parents' finances/);
  assert.match(html, /can see each time they look, and end it any time/);
  assert.match(html, /href="\/login\?mode=signup&role=student&next=%2Fjoin%2FRIVERA"[^>]*>Create an account</);
  assert.match(html, /href="\/login\?next=%2Fjoin%2FRIVERA"[^>]*>Sign in</);
  assert.doesNotMatch(html, /<form/, "nothing to submit signed out");
  // An invitation names who sent it and greets the student.
  const inv = render(byInvite(null), false);
  assert.match(text(inv), /Hi Alice\. Ms\. Rivera invited you\./);
});

test("render: a student gets Join for their own record", () => {
  const html = render(byCode(student));
  assert.match(html, /<input type="hidden" name="segment" value="RIVERA"\/>/);
  assert.match(html, /<input type="hidden" name="side" value="student"\/>/);
  assert.match(html, /<button type="submit"[^>]*>Join Rivera Advising<\/button>/);
  assert.doesNotMatch(html, /name="student"/, "no choice of student for a student");
  assert.match(html, /your record, your college list and advisor, and your essays/);
});

test("render: a guardian picks one of the students they can see, then Join", () => {
  const html = render(byCode(parent));
  assert.match(html, /Which student is joining\?/);
  assert.match(html, /<input type="radio"[^>]*checked=""[^>]*value="s-ben"/, "the first student is chosen to start");
  assert.match(html, /<input type="radio"[^>]*value="s-cara"/);
  assert.match(text(html), /Ben Smith .*Cara Smith/);
  assert.match(html, />Join<\/button>/);
  assert.match(text(html), /Rivera Advising will have access to your student's record, college list and advisor, and essays\./);
  assert.match(html, /never see your finances or your household/);
});

test("render: a counselor or an account with no student sees the plain message with the organization's name", () => {
  const html = render(byCode(nobody));
  assert.ok(html.includes(view.notForYouLine("Rivera Advising")));
  assert.match(html, /This link is for students and their parents joining Rivera Advising/);
  assert.doesNotMatch(html, /<form/);
  assert.match(html, /href="\/account"[^>]*>Your account</);
});

test("render: a counselor's invitation, signed in, offers Join as a counselor", () => {
  const html = render(byInvite(nobody, { side: "counselor" }));
  assert.match(html, /<h1[^>]*>Join Rivera Advising as a counselor<\/h1>/);
  assert.match(html, /<input type="hidden" name="side" value="counselor"\/>/);
  assert.match(html, />Join as a counselor<\/button>/);
  assert.match(html, /Counselors use Quad free/);
});

test("render: used, expired, cancelled, and unknown links say so in plain words", () => {
  for (const [st, msg] of [
    ["accepted", ORG_ERRORS.invitation_used],
    ["expired", ORG_ERRORS.invitation_expired],
    ["revoked", ORG_ERRORS.invitation_revoked],
  ] as const) {
    const html = render(byInvite(student, { state: st }));
    assert.ok(html.includes(msg), st);
    assert.doesNotMatch(html, /<form/, `${st}: no Join`);
  }
  const none = render(joinState({ segment: "NOPE", codePreview: null, invitationPreview: null, viewer: null }), false);
  assert.match(none, /This link doesn't work/);
  assert.ok(none.includes(ORG_ERRORS.no_such_code));
  assert.match(none, /href="\/join"[^>]*>Type a code</);
  assert.match(render(joinState({ segment: TOKEN, codePreview: null, invitationPreview: null, viewer: null }), false), new RegExp(ORG_ERRORS.invitation_not_found.replace(/[.']/g, ".")));
});

test("render: /join is a form to type a code; a code redirects to /join/<CODE>; a bad one says so", async () => {
  const empty = decode(renderToStaticMarkup(await CodePage.default({ searchParams: Promise.resolve({}) })));
  assert.match(empty, /<form[^>]*action="\/join" method="get"/);
  assert.match(empty, /name="code"/);
  assert.doesNotMatch(empty, /role="alert"/);
  await assert.rejects(CodePage.default({ searchParams: Promise.resolve({ code: "quad-rivera" }) }), (e: { to?: string }) => e.to === "/join/RIVERA");
  const bad = decode(renderToStaticMarkup(await CodePage.default({ searchParams: Promise.resolve({ code: "no" }) })));
  assert.match(bad, /role="alert"[^>]*>That isn't a code/);
});

const grant = (over: Partial<CounselorGrantView> = {}): CounselorGrantView => ({
  grant_id: "g1",
  org_id: "o1",
  org_name: "Rivera Advising",
  counselor_names: ["Ms. Rivera", "Mr. Lee"],
  can_edit: true,
  granted_at: "2026-10-02T15:00:00Z",
  student_id: "s-alice",
  ...over,
});

test("Your counselors: nothing without grants; each grant's name, counselors, date, Can edit / View only, End access", () => {
  assert.equal(renderToStaticMarkup(React.createElement(CounselorsSection, { grants: [] })), "", "no section, no upsell");
  const html = decode(
    renderToStaticMarkup(React.createElement(CounselorsSection, { grants: [grant(), grant({ grant_id: "g2", org_name: "Northside High", counselor_names: [], can_edit: false })] })),
  );
  assert.match(html, /id="counselors"/);
  assert.match(text(html), /Your counselors/);
  assert.match(text(html), /Northside High Since Oct 2, 2026 .*Rivera Advising Ms\. Rivera and Mr\. Lee · Since Oct 2, 2026/, "sorted by name; names when there are some");
  assert.equal((html.match(/aria-pressed="true"[^>]*>Can edit</g) ?? []).length, 1, "Rivera: Can edit");
  assert.equal((html.match(/aria-pressed="true"[^>]*>View only</g) ?? []).length, 1, "Northside: View only");
  assert.equal((html.match(/>End access</g) ?? []).length, 2);
  // A parent's view on the child's page.
  const child = decode(renderToStaticMarkup(React.createElement(CounselorsSection, { grants: [grant()], first: "Ben" })));
  assert.match(text(child), /Ben's counselors/);
  assert.match(child, /never your finances or your household/);
});

test("the access log names a counselor with their role", () => {
  const lines = groupAccessLog([{ at: "2026-10-02T15:00:00Z", table_name: "lists", viewer_id: "c", viewer_name: "Ms. Rivera", viewer_role: "counselor" }]);
  assert.equal(`${lines[0].viewer} viewed ${lines[0].what}`, "Ms. Rivera (counselor) viewed your list");
  const parentLine = groupAccessLog([{ at: "2026-10-02T15:00:00Z", table_name: "lists", viewer_id: "g", viewer_name: "Mom", viewer_role: "guardian" }]);
  assert.equal(parentLine[0].viewer, "Mom", "a parent stays just their name");
});

test("the joined notice names the organization and links to where it's changed", () => {
  const html = decode(renderToStaticMarkup(React.createElement(JoinedLine, { orgName: "Rivera Advising", settings: "/account#counselors" })));
  assert.match(text(html), /Rivera Advising can see this advisor now\./);
  assert.match(html, /href="\/account#counselors"[^>]*>Change or end it</);
});

test("the menu shows Caseload only for members of an organization", () => {
  assert.deepEqual(accountMenuLinks({ org: false }).map((l) => l.label), ["Household", "Your account"]);
  assert.deepEqual(accountMenuLinks({}).map((l) => l.label), ["Household", "Your account"], "an older stored answer without org");
  assert.deepEqual(accountMenuLinks({ org: true }).map((l) => [l.label, l.href]), [["Caseload", "/org"], ["Household", "/household"], ["Your account", "/account"]]);
  assert.match(read("app", "api", "me", "route.ts"), /myOrganization\(\)\s*\.then\(\(o\) => o !== null\)/);
  assert.match(read("components", "layout", "BottomNav.tsx"), /me\?\.signedIn && me\.org && \(/, "and the phone's More sheet");
});

/* ------------------------------------------------------------------ */
/* The way in                                                          */
/* ------------------------------------------------------------------ */

test("a new counselor with nowhere particular to go lands on /org; nobody else moves", () => {
  assert.equal(firstLanding("/account", "counselor", true), "/org");
  assert.equal(firstLanding("/account", "counselor", false), "/account", "an ordinary sign-in");
  assert.equal(firstLanding("/join/RIVERA", "counselor", true), "/join/RIVERA", "an explicit next wins");
  assert.equal(firstLanding("/account", "student", true), "/account");
  assert.equal(firstLanding("/account", "guardian", true), "/account");
  assert.match(read("app", "auth", "callback", "route.ts"), /firstLanding\(next, data\.user\.user_metadata\?\.role_hint, isFreshConfirmation\(data\.user\)\)/);
  assert.match(read("app", "auth", "confirm", "actions.ts"), /firstLanding\(target, data\.user\.user_metadata\?\.role_hint, isFreshConfirmation\(data\.user\)\)/);
  assert.match(read("app", "auth", "confirm", "ConfirmSignIn.tsx"), /completeSignIn\(fragment\.accessToken, fragment\.refreshToken, target\)/);
  assert.match(read("app", "login", "actions.ts"), /redirect\(firstLanding\(next, role, true\)\)/);
});

test("wiring: the splash's Counselors links to /org with the free line; routes, proxy, and metadata", () => {
  const splash = read("components", "advisor", "sections", "Counselors.tsx");
  assert.match(splash, /Counselors and consultants use Quad free: see your students&apos; advisors, ask for what&apos;s missing, keep your notes\./);
  assert.match(splash, /href=\{CASELOAD_HREF\}/);
  const proxy = read("proxy.ts");
  assert.match(proxy, /"\/org\/:path\*"/);
  assert.match(proxy, /"\/join\/:path\*"/);
  const page = read("app", "join", "[code]", "page.tsx");
  assert.match(page, /robots: \{ index: false \}, referrer: "no-referrer"/);
  assert.match(read("app", "join", "page.tsx"), /robots: \{ index: false \}/);
  assert.match(read("app", "account", "page.tsx"), /<CounselorsSection grants=\{grants\} \/>/);
  assert.match(read("app", "household", "[person]", "page.tsx"), /<CounselorsSection grants=\{childGrants\} first=/);
  assert.match(read("specs", "product", "telemetry.md"), /`org_student_joined` \(server, `source`: invite \/ code, `new_account`: bool\)/);
});
