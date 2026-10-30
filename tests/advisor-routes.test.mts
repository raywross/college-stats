/**
 * The rename's routes and labels (specs/product/advisor.md "1. The name", "How the rename is built"): the plan became
 * Quad Advisor, its page tree moved from `/plan` to `/advisor`, and `/plan/*` redirects there for good. Pins the names
 * (lib/planner/advisor.ts), the hrefs every link is built from (`planHref`, `planPrintHref`, the household redirect),
 * the permanent redirects in next.config.ts, the proxy matcher, the navigation labels, and a sweep that no source file
 * under app/, components/, lib/, or proxy.ts still writes a `/plan` route (`/api/plan/*` is internal and stays).
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ADVISOR_NAME, ADVISOR_PATH, ADVISOR_SHORT, advisorTitle } from "../lib/planner/advisor.ts";
import { planHref, planPrintHref } from "../lib/planner/plan-tabs.ts";
import { personPlanRedirectHref } from "../lib/planner/plan-frame.ts";
import { guideHref } from "../lib/planner/guides.ts";
import { personListHref } from "../lib/household-hub.ts";
import nextConfig from "../next.config.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

test("the names: Quad Advisor for the product, Advisor for the tab, /advisor for the route", () => {
  assert.equal(ADVISOR_NAME, "Quad Advisor");
  assert.equal(ADVISOR_SHORT, "Advisor");
  assert.equal(ADVISOR_PATH, "/advisor");
});

test("advisorTitle: \"Your advisor\" for the student, \"Jordan's advisor\" to a parent, a blank name is no name", () => {
  assert.equal(advisorTitle(null), "Your advisor");
  assert.equal(advisorTitle("Jordan"), "Jordan's advisor");
  assert.equal(advisorTitle("  Jordan "), "Jordan's advisor");
  assert.equal(advisorTitle("  "), "Your advisor");
  assert.equal(advisorTitle(""), "Your advisor");
});

test("planHref keeps its signature and builds /advisor links", () => {
  assert.equal(planHref({}), "/advisor");
  assert.equal(planHref({ person: "kid-1", tab: "calendar" }), "/advisor?for=kid-1&tab=calendar");
  assert.equal(planHref({ setup: true, step: 3 }), "/advisor?setup=1&step=3");
  assert.equal(planHref({ tab: "next", move: "t1" }), "/advisor?tab=next&move=t1");
});

test("the print view, the guides, the household's links, and an old six-stage link all land under /advisor", () => {
  assert.equal(planPrintHref(), "/advisor/print");
  assert.equal(planPrintHref({ person: "kid-1" }), "/advisor/print?for=kid-1");
  assert.equal(planPrintHref({ each: true }), "/advisor/print?each=1");
  assert.ok(personPlanRedirectHref("kid-1", undefined).startsWith("/advisor"));
  assert.equal(personPlanRedirectHref("kid-1", "4"), "/advisor?for=kid-1&tab=calendar");
  assert.ok(guideHref("list", {}).startsWith("/advisor/guide/list"));
  assert.equal(personListHref("student", "s1"), "/advisor?for=s1");
});

test("next.config.ts redirects /plan and /plan/* to /advisor for good (the query string passes through)", async () => {
  const redirects = await nextConfig.redirects!();
  const rule = (source: string) => redirects.find((r) => r.source === source);
  assert.deepEqual(
    { destination: rule("/plan")?.destination, permanent: rule("/plan")?.permanent },
    { destination: "/advisor", permanent: true },
  );
  assert.deepEqual(
    { destination: rule("/plan/:path*")?.destination, permanent: rule("/plan/:path*")?.permanent },
    { destination: "/advisor/:path*", permanent: true },
  );
  assert.ok(!redirects.some((r) => r.source.startsWith("/api/plan")), "/api/plan/* is not redirected");
});

test("the page tree moved: app/advisor exists, app/plan does not; /me/plan goes to /advisor", () => {
  assert.equal(existsSync(join(ROOT, "app", "plan")), false, "app/plan is gone (git mv to app/advisor)");
  for (const f of ["page.tsx", "layout.tsx", "loading.tsx", "print/page.tsx", "guide/[slug]/page.tsx"]) {
    assert.ok(existsSync(join(ROOT, "app", "advisor", f)), `app/advisor/${f}`);
  }
  assert.match(read("app", "me", "plan", "route.ts"), /new URL\(ADVISOR_PATH, /);
  assert.match(read("app", "household", "[person]", "plan", "print", "page.tsx"), /redirect\(planPrintHref\(\{ person: id \}\)\)/);
});

test("the proxy refreshes the session on /advisor (and still on /plan, harmless)", () => {
  const proxy = read("proxy.ts");
  assert.match(proxy, /"\/advisor\/:path\*"/);
  assert.match(proxy, /"\/plan\/:path\*"/);
});

test("the tab bar, the header, and the person pill say Advisor and link /advisor; the internal cookie keeps its name", () => {
  const bottom = read("components", "layout", "BottomNav.tsx");
  assert.match(bottom, /<Tab href=\{ADVISOR_PATH\} label=\{ADVISOR_SHORT\} icon=\{<ListChecks \/>\} active=\{isActive\(ADVISOR_PATH\)/);
  assert.doesNotMatch(bottom, /label="Plan"/);
  const header = read("components", "layout", "Header.tsx");
  assert.match(header, /\{ label: ADVISOR_SHORT, href: ADVISOR_PATH \}/);
  assert.match(header, /item\.href === ADVISOR_PATH && planDot\.lit/);
  assert.doesNotMatch(header, /label: "Plan"/);
  const pill = read("components", "account", "PersonHeader.tsx");
  assert.match(pill, /\{ value: "list", label: ADVISOR_SHORT, href: `\/household\/\$\{id\}` \}/);
  assert.doesNotMatch(read("components", "account", "AccountMenu.tsx"), /\/plan\b|\bPlan\b/, "the account menu has no plan link");
  assert.match(read("app", "advisor", "page.tsx"), /export const metadata: Metadata = \{ title: ADVISOR_SHORT \};/);
  assert.match(read("app", "advisor", "guide", "[slug]", "page.tsx"), /const PLAN_CHILD_COOKIE = "plan_child";/);
});

/* ------------------------------------------------------------------ */
/* The sweep: no `/plan` route written in code                         */
/* ------------------------------------------------------------------ */

/** A `/plan` path: not `/api/plan`, not `/planner`, `/plan-tabs`, `/plans`. */
const PLAN_ROUTE = /(?<!\/api)\/plan(?![\w-])/;

/** Lines that may keep it: the proxy matcher (kept on purpose; harmless). */
const ALLOWED: Array<{ file: string; line: RegExp }> = [{ file: "proxy.ts", line: /"\/plan\/:path\*"/ }];

/** The line's code: comment lines (`*`, `//`, `/*`, `{/*`) dropped and a trailing ` // …` cut (a URL's `://` stays). */
function codeOf(line: string): string {
  const t = line.trim();
  if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("{/*")) return "";
  return line.replace(/(^|\s)\/\/.*$/, "");
}

function* sourceFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|tsx|mts)$/.test(e)) yield p;
  }
}

/** Every `/plan` route written in code under the given roots, as "file:line: text". */
function planRouteHits(files: Iterable<string>, readText: (f: string) => string = (f) => readFileSync(f, "utf8")): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const rel = relative(ROOT, f);
    // lib/roadmap.ts is the roadmap's prose (not ours to edit here), never a link.
    if (rel === join("lib", "roadmap.ts")) continue;
    readText(f)
      .split("\n")
      .forEach((line, i) => {
        if (!PLAN_ROUTE.test(codeOf(line))) return;
        if (ALLOWED.some((a) => a.file === rel && a.line.test(line))) return;
        hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

test("the sweep finds a /plan route in code and ignores comments, /api/plan, and /planner", () => {
  const fake = join(ROOT, "lib", "fake.ts");
  const hits = planRouteHits([fake], () =>
    [
      'const a = "/plan?setup=1";',
      "const b = `/household/${id}/plan`;",
      " * see /plan (a comment)",
      'fetch("/api/plan/next"); // the old /plan',
      'import x from "@/lib/planner/plan-tabs";',
      'const c = "https://example.org/plans";',
    ].join("\n"),
  );
  assert.deepEqual(hits.map((h) => h.split(": ")[0]), [join("lib", "fake.ts") + ":1", join("lib", "fake.ts") + ":2"]);
});

test("no source file under app/, components/, lib/, or proxy.ts writes a /plan route (outside /api/plan)", () => {
  const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components")), ...sourceFiles(join(ROOT, "lib")), join(ROOT, "proxy.ts")];
  assert.deepEqual(planRouteHits(files), [], "build links with planHref / planPrintHref / ADVISOR_PATH (lib/planner)");
});

test("next.config.ts redirects the bare /advisor/essays to the Essays tab for good; a ?college= link is left to the page's own redirect (the card anchor)", async () => {
  const redirects = await nextConfig.redirects!();
  const rule = redirects.find((r) => r.source === "/advisor/essays");
  assert.ok(rule, "a rule for /advisor/essays");
  assert.equal(rule!.destination, "/advisor?tab=essays");
  assert.equal(rule!.permanent, true);
  // Without this guard the rule would swallow a `?college=` link's card anchor (specs/product/essays/tab.md).
  assert.deepEqual(rule!.missing, [{ type: "query", key: "college" }]);
});
