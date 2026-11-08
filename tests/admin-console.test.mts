/**
 * The admin console's shell after the redesign (specs/product/admin-redesign.md "The shell", "Model and files", "Tests"):
 * the four doors cover every console page; every address the console had before redirects to a page that exists; no
 * link in the console still names an old address; every Panel and PageHeader explains itself with a help key the
 * glossary has; no field code is written on a screen without its name; the site's tab bar steps aside under /admin for
 * the console's own. Pure modules run for real; pages are checked by reading their source. Each guard is shown failing
 * when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ADMIN_DOORS, activeDoor, activeScreen } from "../lib/admin/console.ts";
import { ADMIN_REDIRECTS, nextAdminRedirects, resolveAdminRedirect } from "../lib/admin/redirects.ts";
import { HELP, helpByDoor, isHelpKey } from "../lib/admin/help.ts";
import { attemptResultWords, codeLabel, codeName, codeWordsInText, collectionLabel, itemKeyLabel, reasonLabel, REASON_WORDS, stewardText, targetKindLabel, changeKindLabel } from "../lib/admin/words.ts";
import { REASON_CODES } from "../scripts/lib/college-failures.mts";
import { ESSAY_STATUS_LABELS } from "../lib/admin/essays.ts";
import { CDS_ITEM_NAMES } from "../lib/cds-sections.ts";
import nextConfig from "../next.config.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((n) => (statSync(join(ROOT, dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

/** Every route under app/admin today: a page's or a route handler's folder, as a pattern ("/admin/data/colleges/[unit]"). */
const routeFiles = walk("app/admin").filter((f) => /\/(page\.tsx|route\.ts)$/.test(f));
const ROUTES = routeFiles.map((f) => "/" + relative("app", f).replace(/\/(page\.tsx|route\.ts)$/, "").replace(/\\/g, "/"));
const PAGES = routeFiles.filter((f) => f.endsWith("page.tsx")).map((f) => "/" + relative("app", f).replace(/\/page\.tsx$/, "").replace(/\\/g, "/"));
const routeRegex = (route: string) => new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}$`);
const isPage = (path: string) => PAGES.some((r) => routeRegex(r).test(path));
const isRoute = (path: string) => ROUTES.some((r) => routeRegex(r).test(path));

/** Sample values for a route's dynamic segments. */
const SAMPLE: Record<string, string> = { unit: "100654", id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", key: "value-cornell-c1", job: "digests", run: "12", name: "aid-policies", user: "1b4e28ba-2fa1-11d2-883f-0016d3cca427" };
const fill = (route: string) => route.replace(/\[([^\]]+)\]/g, (_, k: string) => SAMPLE[k] ?? "x");

/** Every page and route handler the console had before the redesign (main at 2026-11-08). */
const OLD_ROUTES = [
  "/admin",
  "/admin/admins",
  "/admin/colleges",
  "/admin/colleges/[unit]",
  "/admin/colleges/[unit]/edit",
  "/admin/colleges/[unit]/review",
  "/admin/colleges/[unit]/views",
  "/admin/data",
  "/admin/data/audits",
  "/admin/data/change-sets",
  "/admin/data/change-sets/[id]",
  "/admin/data/decisions",
  "/admin/data/holds",
  "/admin/data/issues",
  "/admin/data/proposals",
  "/admin/data/proposals/[key]",
  "/admin/data/reference",
  "/admin/data/reference/[name]",
  "/admin/data/snapshots",
  "/admin/data/todo",
  "/admin/essays",
  "/admin/essays/[unit]",
  "/admin/health",
  "/admin/health/csv",
  "/admin/health/files",
  "/admin/health/inputs-csv",
  "/admin/high-schools/[id]",
  "/admin/households",
  "/admin/households/[id]",
  "/admin/jobs",
  "/admin/jobs/[job]",
  "/admin/jobs/[job]/runs/[run]",
  "/admin/log",
  "/admin/mfa",
  "/admin/operations",
  "/admin/organizations",
  "/admin/organizations/[id]",
  "/admin/people",
  "/admin/people/[user]",
  "/admin/people/[user]/export",
  "/admin/people/[user]/views",
  "/admin/selectivity",
  "/admin/settings",
  "/admin/students/[id]",
];

/* ------------------------------------------------------------------ */
/* Doors                                                               */
/* ------------------------------------------------------------------ */

test("the four doors, in order, each with its landing page and screens; every screen's href is a page", () => {
  assert.deepEqual(
    ADMIN_DOORS.map((d) => [d.key, d.label, d.href]),
    [
      ["steward", "Steward", "/admin"],
      ["people", "People", "/admin/people"],
      ["data", "Data", "/admin/data"],
      ["more", "More", "/admin/more"],
    ],
  );
  assert.deepEqual(ADMIN_DOORS.find((d) => d.key === "steward")!.screens.map((s) => s.label), ["Inbox", "Findings", "Proposals", "To do", "Decisions", "Audits", "Jobs", "Runs"]);
  assert.deepEqual(ADMIN_DOORS.find((d) => d.key === "people")!.screens.map((s) => s.label), ["People", "Households", "Organizations"]);
  assert.deepEqual(ADMIN_DOORS.find((d) => d.key === "data")!.screens.map((s) => s.label), ["Colleges", "Health", "Selectivity", "Essays", "Reference", "Changes", "Published versions"]);
  assert.deepEqual(ADMIN_DOORS.find((d) => d.key === "more")!.screens.map((s) => s.label), ["Admins", "Settings", "Log", "Help"]);
  for (const d of ADMIN_DOORS) {
    assert.ok(isPage(d.href), `${d.label}'s landing ${d.href} is a page`);
    for (const s of d.screens) {
      assert.ok(isPage(s.href), `${d.label} › ${s.label}: ${s.href} is a page`);
      assert.ok(isHelpKey(s.help), `${s.label}'s help key ${s.help} is in the glossary`);
      assert.ok(s.hint.length > 0 && s.hint.length <= 40, `${s.label} has a one-line hint`);
    }
  }
  const keys = ADMIN_DOORS.flatMap((d) => d.screens.map((s) => s.key));
  assert.equal(new Set(keys).size, keys.length, "screen keys are unique");
});

test("every console page and route belongs to a door; every page but a door's landing belongs to a screen", () => {
  const landings = new Set(ADMIN_DOORS.map((d) => d.href));
  assert.ok(ROUTES.length >= 40, "the walk found the console's routes");
  for (const route of ROUTES) {
    const path = fill(route);
    assert.ok(activeDoor(path), `${route} belongs to a door`);
    if (!landings.has(route) && route !== "/admin") assert.ok(activeScreen(path), `${route} belongs to a screen`);
  }
  assert.equal(activeScreen("/admin")?.key, "inbox");
  assert.equal(activeScreen("/admin/data"), null, "a door's landing is no screen");
  assert.equal(activeDoor("/admin/data"), "data");
  assert.equal(activeDoor("/admin/more"), "more");
  assert.equal(activeDoor("/admin/steward"), "steward");
  assert.equal(activeDoor("/admin/data/colleges/100654/review"), "data");
  assert.equal(activeScreen("/admin/data/high-schools/abc")?.key, "colleges");
  assert.equal(activeScreen("/admin/students/abc")?.key, "people");
  assert.equal(activeScreen("/admin/steward/jobs/digests/runs/1")?.key, "jobs");
  assert.equal(activeScreen("/admin/data/changes/"), activeScreen("/admin/data/changes"), "a trailing slash doesn't matter");
  assert.equal(activeScreen("/admin/peoplex"), null);
  assert.equal(activeDoor("/explore"), null, "outside the console, no door");
});

test("guard: a page under no door is caught", () => {
  const route = "/admin/nowhere/[id]";
  const path = fill(route);
  assert.equal(activeScreen(path), null);
  assert.equal(activeDoor(path), "steward", "an unknown /admin path falls to the Steward door (its home), which the screen check above catches");
});

/* ------------------------------------------------------------------ */
/* Redirects                                                           */
/* ------------------------------------------------------------------ */

test("every page the console had before redirects to a page that exists, or is still where it was", () => {
  for (const route of OLD_ROUTES) {
    const path = fill(route);
    if (isRoute(path)) continue;
    const to = resolveAdminRedirect(path);
    assert.ok(to, `${route} has a redirect row`);
    const target = to.split(/[?#]/)[0];
    assert.ok(isRoute(target), `${route} → ${to}: the target is a page`);
  }
});

test("the redirects named in the brief go where it says, query strings kept", () => {
  const cases: [string, string][] = [
    ["/admin/data/issues", "/admin/steward/findings"],
    ["/admin/data/holds", "/admin/steward/findings"],
    ["/admin/data/holds?unit=100654", "/admin/data/colleges/100654/review?unit=100654"],
    ["/admin/data/proposals/value-x", "/admin/steward/proposals/value-x"],
    ["/admin/data/todo?kind=cds", "/admin/steward/todo?kind=cds"],
    ["/admin/jobs", "/admin/steward/jobs"],
    ["/admin/jobs/digests/runs/12", "/admin/steward/jobs/digests/runs/12"],
    ["/admin/operations", "/admin/steward/jobs"],
    ["/admin/operations?unit=100654", "/admin/data/colleges/100654/review?unit=100654"],
    ["/admin/data/change-sets/7", "/admin/data/changes/7"],
    ["/admin/data/change-sets?status=held", "/admin/data/changes?status=held"],
    ["/admin/data/snapshots", "/admin/data/versions"],
    ["/admin/health", "/admin/data/health"],
    ["/admin/health?status=failing", "/admin/data/health?status=failing"],
    ["/admin/health/files", "/admin/data/health?tab=sources"],
    ["/admin/health/files?group=reported", "/admin/data/health?tab=sources&group=reported"],
    ["/admin/health/csv?status=stale", "/admin/data/health/csv?status=stale"],
    ["/admin/colleges", "/admin/data/colleges"],
    ["/admin/colleges/100654/edit", "/admin/data/colleges/100654/edit"],
    ["/admin/high-schools/abc", "/admin/data/high-schools/abc"],
    ["/admin/essays/100654", "/admin/data/essays/100654"],
    ["/admin/selectivity?days=30", "/admin/data/selectivity?days=30"],
    ["/admin/mfa", "/admin/admins#second-factor"],
  ];
  for (const [from, to] of cases) assert.equal(resolveAdminRedirect(from), to, from);
  assert.equal(resolveAdminRedirect("/admin/people"), null, "a page that didn't move has no row");
  assert.equal(resolveAdminRedirect("/admin/data/colleges/100654"), null, "nor does a new address");
});

test("next.config.ts carries every row, not permanent, the query rows matched on their parameter", async () => {
  const rows = await (nextConfig.redirects as () => Promise<{ source: string; destination: string; permanent: boolean; has?: { key: string; value?: string }[] }[]>)();
  for (const r of nextAdminRedirects()) {
    const found = rows.find((x) => x.source === r.source && x.destination === r.destination && JSON.stringify(x.has ?? null) === JSON.stringify(r.has ?? null));
    assert.ok(found, `${r.source} → ${r.destination}`);
    assert.equal(found.permanent, false, `${r.source} is not permanent: the addresses may move again`);
  }
  const unit = nextAdminRedirects().find((r) => r.source === "/admin/operations" && r.has);
  assert.deepEqual(unit?.has, [{ type: "query", key: "unit", value: "(?<unit>[^&]+)" }]);
  // The narrower row first: with the plain row first, ?unit= would never reach the Review page.
  const ops = ADMIN_REDIRECTS.filter((r) => r.from === "/admin/operations");
  assert.ok(ops[0].query === "unit" && !ops[1].query);
});

test("guard: an old page with no redirect row is caught", () => {
  const without = (path: string) => (path === "/admin/selectivity" ? null : resolveAdminRedirect(path));
  assert.equal(without("/admin/selectivity"), null);
  assert.ok(!isRoute("/admin/selectivity"), "and nothing lives there now: the check above would fail");
});

/* ------------------------------------------------------------------ */
/* No old address in the console's links                              */
/* ------------------------------------------------------------------ */

const OLD_PATH = /(?<![\w-])\/admin\/(?:colleges|essays|high-schools|selectivity|health|jobs|operations|mfa)(?![\w.-])|(?<![\w-])\/admin\/data\/(?:issues|proposals|todo|decisions|audits|holds|change-sets|snapshots)(?![\w.-])/;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

function oldPathsIn(src: string): string[] {
  return stripComments(src)
    .split("\n")
    .filter((l) => OLD_PATH.test(l))
    .map((l) => l.trim());
}

test("no link, form, or redirect in the console names an old address (lib/admin/redirects.ts alone keeps them)", () => {
  const files = [...walk("app/admin"), ...walk("components/admin"), ...walk("lib/admin"), "lib/jobs/view.ts", "lib/jobs/registry.ts"].filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("redirects.ts"));
  for (const f of files) assert.deepEqual(oldPathsIn(read(f)), [], f);
});

test("guard: an old address in a link is caught; the same words in a comment or a lib path are not", () => {
  assert.deepEqual(oldPathsIn('<Link href="/admin/operations#start-a-run">'), ['<Link href="/admin/operations#start-a-run">']);
  assert.deepEqual(oldPathsIn("const href = `/admin/colleges/${unit}`;"), ["const href = `/admin/colleges/${unit}`;"]);
  assert.deepEqual(oldPathsIn("/** once /admin/health/files */\nimport { x } from \"@/lib/admin/health\";"), []);
});

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */

/** Every `<Panel …>` and `<PageHeader …>` opening tag in a source file. */
function openingTags(src: string): string[] {
  const out: string[] = [];
  const re = /<(Panel|PageHeader)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote && src[i - 1] !== "\\") quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

/** The tags without a `help` key from the glossary (a literal key it has, or an expression the type checks). */
function unexplained(src: string): string[] {
  return openingTags(src).filter((tag) => {
    const lit = /\bhelp="([^"]+)"/.exec(tag);
    if (lit) return !isHelpKey(lit[1]);
    return !/\bhelp=\{/.test(tag);
  });
}

test("every Panel and PageHeader under app/admin passes help= with a key the glossary has", () => {
  const files = walk("app/admin").filter((f) => f.endsWith(".tsx"));
  let tags = 0;
  for (const f of files) {
    const src = read(f);
    tags += openingTags(src).length;
    assert.deepEqual(unexplained(src), [], f);
  }
  assert.ok(tags > 120, `the walk found the panels (${tags})`);
});

test("every help key written in the console is one the glossary has", () => {
  const files = [...walk("app/admin"), ...walk("components/admin")].filter((f) => f.endsWith(".tsx"));
  for (const f of files) {
    for (const m of read(f).matchAll(/\bhelp(?:=|: )"([^"]+)"/g)) assert.ok(isHelpKey(m[1]), `${f}: ${m[1]}`);
  }
});

/**
 * The `<h2>` headings written by hand (not through Panel or PageHeader) that carry no `<HelpTip help="…">` inside them.
 * Panel.tsx draws Panel's and PageHeader's own heading (the icon from their `help`); the rail's door labels and
 * /admin/help's door groups are navigation, not panels.
 */
const H2_EXEMPT = new Set(["components/admin/Panel.tsx", "components/admin/AdminRail.tsx", "components/admin/HelpList.tsx"]);
function headingsWithoutHelp(src: string): string[] {
  return [...stripComments(src).matchAll(/<h2\b[\s\S]*?<\/h2>/g)]
    .map((m) => m[0])
    .filter((h) => {
      const tip = /<HelpTip help="([^"]+)"/.exec(h);
      return !tip || !isHelpKey(tip[1]);
    })
    .map((h) => h.replace(/\s+/g, " "));
}

test("every hand-written <h2> in the console has the (i) icon beside its words", () => {
  const files = [...walk("app/admin"), ...walk("components/admin")].filter((f) => f.endsWith(".tsx") && !H2_EXEMPT.has(f));
  let headings = 0;
  for (const f of files) {
    headings += (read(f).match(/<h2\b/g) ?? []).length;
    assert.deepEqual(headingsWithoutHelp(read(f)), [], f);
  }
  assert.ok(headings >= 10, `the walk found the headings (${headings})`);
});

test("guard: an <h2> with no HelpTip, or one whose key the glossary lacks, is caught", () => {
  assert.equal(headingsWithoutHelp('<h2 id="x" className="text-lg">\n  History\n</h2>').length, 1);
  assert.equal(headingsWithoutHelp('<h2 className="sr-only">Hidden</h2>').length, 1);
  assert.equal(headingsWithoutHelp('<h2>History <HelpTip help="no-such-word" /></h2>').length, 1);
  assert.equal(headingsWithoutHelp('<h2 className="inline-flex">\n  History <HelpTip help="job-history" />\n</h2>').length, 0);
});

test("every Panel in a console component passes help= too", () => {
  for (const f of walk("components/admin").filter((f) => f.endsWith(".tsx") && f !== "components/admin/Panel.tsx")) assert.deepEqual(unexplained(read(f)), [], f);
});

test("guard: a Panel with no help, or a help key the glossary lacks, is caught", () => {
  assert.equal(unexplained('<Panel title="Summary">').length, 1);
  assert.equal(unexplained('<Panel title="Summary" help="no-such-word">').length, 1);
  assert.equal(unexplained('<Panel title={`A ${b}`} id="x" help="change">').length, 0);
  assert.equal(unexplained("<PageHeader title={x} help={t.help} />").length, 0);
});

test("the glossary: one entry per word the spec lists, kebab-case keys, each with a title and a short note; /admin/help groups them by door", () => {
  const words = [
    "published-version", "change", "held", "review-item", "finding", "cause", "proposal", "proposal-value", "proposal-systemic", "decision", "audit", "reach", "edition",
    "field-code", "hidden-value", "selectivity-pool", "percentile", "reading", "evidence", "data-health", "health-fresh", "health-watch", "health-stale", "health-failing",
    "core-input", "supporting-input", "job", "run", "trigger", "housekeeping-run", "hand-read", "cycle", "seat", "managed-record", "role-hint", "join-code", "ask", "second-factor",
  ];
  for (const w of words) assert.ok(isHelpKey(w), `the glossary explains ${w}`);
  for (const [key, entry] of Object.entries(HELP)) {
    assert.match(key, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${key} is kebab-case`);
    assert.ok(entry.title && entry.short, `${key} has a title and a short note`);
    if ("see" in entry && entry.see) assert.ok(existsSync(join(ROOT, entry.see.split("#")[0])), `${key}'s spec ${entry.see} exists`);
  }
  const groups = helpByDoor();
  assert.deepEqual(groups.map((g) => g.door).slice(0, 4), ["steward", "people", "data", "more"]);
  assert.equal(groups.reduce((n, g) => n + g.entries.length, 0), Object.keys(HELP).length, "every entry is listed once");
});

test("HelpTip: the base-ui Popover opening on hover, a 44px hit area, title, short, What you can do here, and More to /admin/help#key", () => {
  const tip = read("components/admin/HelpTip.tsx");
  assert.match(tip, /^"use client";/);
  assert.match(tip, /from "@base-ui\/react\/popover"/);
  assert.match(tip, /openOnHover/);
  assert.match(tip, /after:-inset-3/, "a 20px icon with a 12px ring of hit area each side: 44px");
  assert.match(tip, /What you can do here/);
  assert.match(tip, /href=\{`\/admin\/help#\$\{help\}`\}/);
  const panel = read("components/admin/Panel.tsx");
  assert.match(panel, /help\?: HelpKey/);
  assert.equal((panel.match(/\{help && <HelpTip help=\{help\} \/>\}/g) ?? []).length, 2, "Panel and PageHeader render the icon after the title");
  assert.match(read("components/admin/StatusChip.tsx"), /help\?: HelpKey/);
  assert.match(read("app/admin/help/page.tsx"), /<HelpList /);
  assert.match(read("components/admin/HelpList.tsx"), /id=\{key\}/, "each entry is the anchor More opens");
});

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

test("codeLabel names a field code from the CDS item names: C10, class rank", () => {
  assert.equal(codeLabel("C10"), "C10, class rank");
  assert.equal(codeLabel("C.1001"), "C.1001, class rank");
  assert.equal(codeLabel("C.701"), "C.701, admission factors");
  assert.equal(codeLabel("H.2A01"), "H.2A01, non-need aid");
  assert.equal(codeLabel("C.8D"), "C.8D, tests for advising");
  assert.equal(codeLabel("B7"), "B7, graduation rates");
  assert.equal(codeLabel("J.105"), "J.105, degrees by field");
  assert.equal(codeLabel(null), "the whole document", "a C1 extraction has no code");
  assert.equal(codeLabel("admissions.acceptance_rate"), "admissions.acceptance_rate", "not a code: as written");
  assert.equal(codeName("Z9"), null);
  for (const item of ["C1", "C7", "C9", "C10", "C11", "C12", "H2A", "B22", "G1"]) assert.ok(CDS_ITEM_NAMES[item], `${item} has a name`);
  assert.equal(itemKeyLabel("100654|2025-26|C.1001", "Alabama A & M University"), "Alabama A & M University, 2025–26, C.1001, class rank");
  assert.equal(itemKeyLabel("100654||"), "College 100654");
  assert.equal(collectionLabel("reported.review_queue"), "the review queue");
  assert.equal(collectionLabel("visit_events.hosts"), "visit events: hosts");
  assert.equal(changeKindLabel("revert"), "Undo");
  assert.equal(targetKindLabel("student"), "Student record");
});

/** Field codes written as text in a page (not inside codeLabel, a comment, or an attribute value the screen doesn't show). */
function bareCodes(src: string): string[] {
  const code = /(?<![\w.#/-])(?:[A-J]\.\d{3,4}|[A-J]\.\d[A-Z]\d{0,2}|[A-J]\d{1,2}[A-Z]?)(?![\w.-])/;
  return stripComments(src)
    .split("\n")
    .filter((l) => !/codeLabel\(|className=|import |key=|value="/.test(l))
    .flatMap((l) => {
      const texts = [...l.matchAll(/>([^<>{}]+)</g), ...l.matchAll(/"([^"]*)"/g), ...l.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
      return texts.filter((t) => code.test(t));
    });
}

test("no field code is written on a console screen without its name (codeLabel)", () => {
  for (const f of [...walk("app/admin"), ...walk("components/admin")].filter((f) => f.endsWith(".tsx"))) assert.deepEqual(bareCodes(read(f)), [], f);
});

test("guard: a bare code in a page's text is caught; codeLabel and class names are not", () => {
  assert.deepEqual(bareCodes("<p>Rejected C7 for this college</p>"), ["Rejected C7 for this college"]);
  assert.deepEqual(bareCodes('<span title="C.701">x</span>'), ["C.701"]);
  assert.deepEqual(bareCodes("<p>{codeLabel(\"C7\")}</p>"), []);
  assert.deepEqual(bareCodes('<div className="h-5 w-12 C7">'), []);
});

test("reasonLabel names every college-reported reason code; an unknown code reads as its words", () => {
  for (const code of REASON_CODES) assert.ok(REASON_WORDS[code], `${code} has words`);
  assert.equal(reasonLabel("class_profile_only"), "Only a class profile found");
  assert.equal(reasonLabel("not-a-url"), "The address isn't valid");
  assert.equal(reasonLabel("some_new_reason"), "Some new reason");
});

test("attemptResultWords: the explanation is the text, the code and the review key go to the title", () => {
  assert.deepEqual(attemptResultWords("class_profile_only: only class profile(s) found (2), no Common Data Set"), {
    text: "Only class profile(s) found (2), no Common Data Set",
    label: "Only a class profile found",
    code: "class_profile_only",
    key: null,
  });
  assert.deepEqual(attemptResultWords("unreachable: HTTP 404 (100654|2025-26|C.101)"), { text: "HTTP 404", label: "Couldn't reach it", code: "unreachable", key: "100654|2025-26|C.101" });
  assert.deepEqual(attemptResultWords("challenge"), { text: "A bot check", label: "A bot check", code: "challenge", key: null });
  assert.equal(attemptResultWords("Fetched by hand").text, "Fetched by hand", "not a code: as written");
  assert.equal(attemptResultWords("Fetched by hand").code, null);
});

test("codeWordsInText: snake_case codes in a stored sentence read as words", () => {
  assert.equal(
    codeWordsInText("status refers_to_form, but the quoted sentence counts the questions", ESSAY_STATUS_LABELS),
    "status “Refers to the form”, but the quoted sentence counts the questions",
  );
  assert.equal(codeWordsInText("a not_read page", {}), "a “not read” page");
  assert.equal(codeWordsInText("nothing to change here", {}), "nothing to change here");
});

test("stewardText: the Steward's codes and keys read in words, the first time each appears", () => {
  // A sample of what the Steward wrote on dev (QA finding 2): bare items, a range, a template code, a key.
  assert.equal(
    stewardText("The C7 grid was read from flattened text, so C7 marks sit a column off."),
    "The C7 (admission factors) grid was read from flattened text, so C7 marks sit a column off.",
  );
  assert.equal(stewardText("B4–B5 disagree with IPEDS"), "B4–B5 (graduation rates; graduation rates, Pell recipients) disagree with IPEDS");
  assert.equal(stewardText("H2A totals exceed H1 (H.2A01)"), "H2A (non-need aid) totals exceed H1 (aid awarded) (H.2A01)", "H.2A01 is H2A, named already");
  assert.equal(stewardText("Use C.1001 to C.1008"), "Use C.1001 to C.1008 (class rank)", "two template codes of one item: one name");
  assert.equal(stewardText("a blank row (C10)"), "a blank row (C10, class rank)", "inside parentheses, the name joins them");
  assert.equal(stewardText("loan_no_pell is set on 12 rows"), "“loan no pell” is set on 12 rows");
  assert.equal(stewardText("class_profile_only for 3 colleges"), "“Only a class profile found” for 3 colleges", "a reason code reads as REASON_WORDS says");
  assert.equal(stewardText("admissions.acceptance_rate reads 4.5"), "“acceptance rate” reads 4.5", "a registered field path reads as its label");
  // Left as written: a name the sentence already says, links and file names, review keys, words that only look like codes.
  for (const same of [
    "class rank (C10) is blank",
    "See https://x.edu/cds_2025-26.pdf#page=4 and cds_2025.pdf",
    "key 231624|2025-26|C.116 is held",
    "C2C, H2O and the 2025-26 edition",
    "admissions.not_registered and e.g. wm.edu",
    "",
  ]) assert.equal(stewardText(same), same.replace(/admissions\.not_registered/, "admissions.“not registered”"), same);
  assert.equal(stewardText(null), "");
});

test("Steward-written sentences go through stewardText where the console shows them", () => {
  assert.match(read("components/admin/steward/Bits.tsx"), /export function StewardWords[\s\S]*title=\{words !== text \? text : undefined\}/, "the raw sentence in the title");
  const uses: [string, RegExp[]][] = [
    ["components/admin/steward/ClustersTable.tsx", [/<StewardWords text=\{issue\.hypothesis\}/, /<StewardWords text=\{issue\.reason\}/]],
    ["components/admin/steward/ProposalParts.tsx", [/<StewardWords text=\{f\.shows\}/, /<StewardWords text=\{r\.proposed\}/, /<StewardWords text=\{p\.summary\}/]],
    ["components/admin/steward/Bits.tsx", [/<StewardWords text=\{why\}/]],
    ["components/admin/steward/TodoTable.tsx", [/<StewardWords text=\{r\.note\}/]],
    ["components/admin/jobs/JobFindings.tsx", [/<StewardWords text=\{i\.hypothesis\}/, /<StewardWords text=\{last\.shows\}/]],
    ["app/admin/steward/decisions/page.tsx", [/title=\{stewardText\(d\.question\)\}/, /<StewardWords text=\{d\.recommends\}/, /<StewardWords text=\{o\.effect\}/]],
    ["app/admin/steward/proposals/[key]/page.tsx", [/title=\{stewardText\(p\.summary\)\}/, /<StewardWords text=\{p\.change\.what\}/, /<StewardWords text=\{p\.answer\}/, /why: r\.why \? stewardText\(r\.why\)/]],
    ["app/admin/page.tsx", [/title=\{item\.raw\}/]],
  ];
  for (const [file, patterns] of uses) for (const re of patterns) assert.match(read(file), re, `${file}: ${re}`);
});

/**
 * Code words written as a page's visible text (a JSX text node): a route path (`/api/...`), a snake_case key
 * (`class_profile_only`, `job_runs`), or a dotted field path (`links.price_calculator`). Attribute values (a `title`,
 * an `href`) and expressions are not text, so the raw key may sit in a title.
 */
function rawCodeWords(src: string): string[] {
  const texts = [...stripComments(src).matchAll(/>([^<>{}]+)</g)].map((m) => m[1].replace(/\s+/g, " ").trim()).filter((t) => t && !/=>|[;=]/.test(t));
  return texts.filter((t) => /\/api\//.test(t) || /(?<![\w./-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\w-])/.test(t) || /(?<![\w/])(?:[a-z]+\.)+[a-z]+_[a-z0-9_]+/.test(t));
}

test("no route path, snake_case key or field path is a console screen's visible text", () => {
  for (const f of [...walk("app/admin"), ...walk("components/admin")].filter((f) => f.endsWith(".tsx"))) assert.deepEqual(rawCodeWords(read(f)), [], f);
});

test("guard: a route path, a reason code or a field path in a page's text is caught; the same in a title is not", () => {
  assert.deepEqual(rawCodeWords("<p>POST /api/cron/weekly with the cron secret</p>"), ["POST /api/cron/weekly with the cron secret"]);
  assert.deepEqual(rawCodeWords("<span>class_profile_only: only class profile(s) found</span>"), ["class_profile_only: only class profile(s) found"]);
  assert.deepEqual(rawCodeWords("<p>\n  The <code>job_runs</code> migration\n</p>"), ["job_runs"]);
  assert.deepEqual(rawCodeWords("<p>links.price_calculator</p>"), ["links.price_calculator"]);
  assert.deepEqual(rawCodeWords('<span title="links.price_calculator">Net price calculator</span>'), []);
  assert.deepEqual(rawCodeWords("<a href=\"/api/cron/weekly\">Its own web route</a>"), []);
});

test("the screens QA found showing code words use the words: To do's attempts, the field editor, the hidden fields, a job's route", () => {
  assert.match(read("components/admin/steward/TodoTable.tsx"), /attemptResultWords\(result\)/);
  assert.doesNotMatch(read("components/admin/steward/TodoTable.tsx"), />\{last\.result\}</, "the raw result is never the text");
  const editor = read("components/admin/FieldEditor.tsx");
  assert.match(editor, /title=\{row\.path\}/);
  assert.doesNotMatch(editor, />\{row\.path\}</, "the field's path is a title, not text");
  const college = read("app/admin/data/colleges/[unit]/page.tsx");
  assert.match(college, /title=\{r\.path\}/);
  assert.doesNotMatch(college, />\{r\.path\}</);
  const job = read("app/admin/steward/jobs/[job]/page.tsx");
  assert.match(job, /Its own web route, called with the cron secret/);
  assert.doesNotMatch(job, /\$\{job\.path\}`\s*:|POST \{job\.path\}/, "the route is under Details");
  assert.match(read("components/admin/Holds.tsx"), /codeWordsInText\(p, ESSAY_STATUS_LABELS\)/);
});

test("the words table: no old word left on the console's screens", () => {
  const OLD = /\b(Change sets?|Snapshots? \d|Point back here|Who is an admin|Pretend today is|Approvals)\b|>\s*(Issues|Holds|Operations|Revert)\s*</;
  for (const f of [...walk("app/admin"), ...walk("components/admin")].filter((f) => f.endsWith(".tsx"))) {
    const hits = stripComments(read(f))
      .split("\n")
      .filter((l) => OLD.test(l));
    assert.deepEqual(hits, [], f);
  }
});

/* ------------------------------------------------------------------ */
/* Tab bar and shell                                                   */
/* ------------------------------------------------------------------ */

test("the site's tab bar renders nothing under /admin, after its hooks; the console's tab bar takes over below md", () => {
  const nav = read("components/layout/BottomNav.tsx");
  assert.match(nav, /import \{ isAdminPath \} from "@\/lib\/analytics";/);
  const hooks = nav.indexOf("useEffect(");
  const out = nav.indexOf("if (isAdminPath(pathname)) return null;");
  assert.ok(out > hooks && hooks > 0, "the early return comes after every hook");
  const bar = read("components/admin/AdminTabBar.tsx");
  assert.match(bar, /^"use client";/);
  assert.match(bar, /ADMIN_DOORS\.map/);
  assert.match(bar, /activeDoor\(pathname\)/);
  assert.match(bar, /md:hidden/);
  assert.match(bar, /h-\(--tabbar-h\)/, "the same height as the site's bar");
  assert.match(read("components/admin/doorIcons.ts"), /steward: ShieldCheck, people: Users, data: Database, more: Ellipsis/);
  const layout = read("app/admin/layout.tsx");
  assert.match(layout, /<AdminRail needsYou=\{needsYou\} \/>/);
  assert.match(layout, /<AdminTabBar needsYou=\{needsYou\} \/>/);
  const rail = read("components/admin/AdminRail.tsx");
  assert.match(rail, /hidden border-r [^"]*md:block/, "the rail is hidden below md");
  assert.match(rail, /lg:block/, "the full rail from lg");
  assert.match(rail, /lg:hidden/, "the compact rail from md to lg");
});

test("each door has a landing that lists its screens; the Inbox is the Steward's", () => {
  assert.match(read("app/admin/data/page.tsx"), /<DoorScreens door="data"/);
  assert.match(read("app/admin/more/page.tsx"), /<DoorScreens door="more"/);
  assert.match(read("app/admin/people/page.tsx"), /<DoorScreens door="people"/);
  assert.match(read("app/admin/page.tsx"), /needsYou\(input\)/);
});

test("Operations and Holds are gone as screens; their work lives on a job's Run now, the Review page, the Essays page; MFA is a panel on Admins", () => {
  for (const gone of ["app/admin/operations/page.tsx", "app/admin/data/holds/page.tsx", "app/admin/mfa/page.tsx", "components/admin/ops/PullList.tsx"]) assert.ok(!existsSync(join(ROOT, gone)), gone);
  const job = read("app/admin/steward/jobs/[job]/page.tsx");
  assert.match(job, /<Panel title="Run now" id="run-now" help="run-now">/);
  assert.match(job, /blockingRun\(run, data\.recent\)/, "the dispatch guard");
  assert.match(job, /<RunForm run=\{run\} prefillUnit=\{prefillUnit\}/);
  assert.match(read("app/admin/steward/jobs/page.tsx"), /Open pull requests on GitHub/);
  const review = read("app/admin/data/colleges/[unit]/review/page.tsx");
  assert.match(review, /name="college"/);
  assert.match(review, /name="code"/);
  assert.match(read("components/admin/steward/ReviewTable.tsx"), /trigger="Re-run discovery"/, "Holds' third action came along");
  assert.match(read("app/admin/data/essays/page.tsx"), /<HeldEssaysList /);
  assert.match(read("app/admin/admins/page.tsx"), /id="second-factor"/);
});
