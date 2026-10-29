/**
 * The prompts, displayed (specs/product/essays/prompts.md "Display"; essays-build/brief.md "U2 Prompts display"):
 * `lib/essays/summary.ts`'s pure card line and plan count on fixtures (every status, limits in words and
 * characters, optional counts); `EssayPrompts` rendered for real (the fold lists every prompt cited, the platform
 * links show only for a platform this college takes, nothing for `refers_to_form` or no block); the Colleges tab's
 * count line's wording; the compare row's all-or-nothing rule. `npm test`. No network, no model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { ReactElement } from "react";
import type { EssayPrompt, School, SchoolEssays } from "../lib/types.ts";
import { ALL_OR_NOTHING_ROW_LABELS } from "../lib/compare-topics.ts";
import { essayCardLine, planEssayCount } from "../lib/essays/summary.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* essayCardLine                                                       */
/* ------------------------------------------------------------------ */

function prompt(overrides: Partial<EssayPrompt> = {}): EssayPrompt {
  return {
    id: "123456:2026-27:1",
    text: "Why do you want to attend?",
    kind: "essay",
    limit: { kind: "words", max: 400 },
    required: true,
    applies_to: "all",
    quote: "Essays must be 400 words or fewer.",
    ...overrides,
  };
}

function essays(overrides: Partial<SchoolEssays> = {}): SchoolEssays {
  return { cycle: "2026-27", status: "published", source_url: "https://example.edu/apply/essays", retrieved: "2026-10-01", prompts: [prompt()], ...overrides };
}

test("essayCardLine: null without an essays block", () => {
  assert.equal(essayCardLine(null), null);
  assert.equal(essayCardLine(undefined), null);
});

test("essayCardLine: refers_to_form shows nothing (counts as unknown)", () => {
  assert.equal(essayCardLine(essays({ status: "refers_to_form", prompts: [] })), null);
});

test("essayCardLine: none says so", () => {
  assert.equal(essayCardLine(essays({ status: "none", prompts: [] })), "No essays beyond the Common App's");
});

test("essayCardLine: essays and short answers, with word limits and an optional count", () => {
  const e = essays({
    prompts: [
      prompt({ id: "1", kind: "essay", limit: { kind: "words", max: 250 }, required: true }),
      prompt({ id: "2", kind: "essay", limit: { kind: "words", max: 400 }, required: false }),
      prompt({ id: "3", kind: "short_answer", limit: { kind: "words", max: 50 }, required: true }),
      prompt({ id: "4", kind: "short_answer", limit: { kind: "words", max: 50 }, required: true }),
      prompt({ id: "5", kind: "short_answer", limit: { kind: "words", max: 50 }, required: true }),
    ],
  });
  assert.equal(essayCardLine(e), "2 essays (250 and 400 words) and 3 short answers; 1 optional");
});

test("essayCardLine: character limits", () => {
  const e = essays({ prompts: [prompt({ id: "1", kind: "essay", limit: { kind: "characters", max: 1500 }, required: true })] });
  assert.equal(essayCardLine(e), "1 essay (1500 characters)");
});

test("essayCardLine: a prompt with no limit is left out of the parenthetical, not treated as zero", () => {
  const e = essays({
    prompts: [
      prompt({ id: "1", kind: "essay", limit: { kind: "words", max: 250 }, required: true }),
      prompt({ id: "2", kind: "why_us", limit: null, required: true }),
    ],
  });
  assert.equal(essayCardLine(e), "2 essays (250 words)");
});

test("essayCardLine: no limits at all omits the parenthetical", () => {
  const e = essays({ prompts: [prompt({ id: "1", kind: "essay", limit: null, required: true })] });
  assert.equal(essayCardLine(e), "1 essay");
});

test("essayCardLine: only short answers, none optional", () => {
  const e = essays({ prompts: [prompt({ id: "1", kind: "short_answer", limit: { kind: "words", max: 50 }, required: true })] });
  assert.equal(essayCardLine(e), "1 short answer");
});

/* ------------------------------------------------------------------ */
/* planEssayCount                                                      */
/* ------------------------------------------------------------------ */

test("planEssayCount: totals across the list, why-us called out, missing colleges counted not on file", () => {
  const published = (n: number, whyUs: number): SchoolEssays =>
    essays({ prompts: [...Array.from({ length: n - whyUs }, (_, i) => prompt({ id: `e${i}`, kind: "essay" })), ...Array.from({ length: whyUs }, (_, i) => prompt({ id: `w${i}`, kind: "why_us" }))] });
  const list: (SchoolEssays | null)[] = [published(10, 5), published(4, 4), essays({ status: "none", prompts: [] }), null, null, null];
  assert.equal(planEssayCount(list), `14 essays and short answers, 9 of them "why us"; 3 colleges not on file`);
});

test("planEssayCount: refers_to_form and none are known, not 'not on file'", () => {
  const list: (SchoolEssays | null)[] = [essays({ status: "none", prompts: [] }), essays({ status: "refers_to_form", prompts: [] })];
  assert.equal(planEssayCount(list), null);
});

test("planEssayCount: nothing to say for an empty list", () => {
  assert.equal(planEssayCount([]), null);
});

test("planEssayCount: not-on-file alone, with no essay count prefix", () => {
  assert.equal(planEssayCount([null, null]), "2 colleges not on file");
});

test("planEssayCount: singular wording", () => {
  assert.equal(planEssayCount([published1well()]), "1 essay and short answer");
  assert.equal(planEssayCount([null]), "1 college not on file");
});
function published1well(): SchoolEssays {
  return essays({ prompts: [prompt({ id: "1" })] });
}

/* ------------------------------------------------------------------ */
/* Compare: the Essays row is all-or-nothing                           */
/* ------------------------------------------------------------------ */

test("the compare table's all-or-nothing rule names the Essays row", () => {
  assert.ok(ALL_OR_NOTHING_ROW_LABELS.has("Essays"));
});

/* ------------------------------------------------------------------ */
/* EssayPrompts, rendered for real                                     */
/* ------------------------------------------------------------------ */

// The component is written for the Next bundler ("@/" paths, JSX, a JSON import with `with { type: "json" }`), which
// plain Node can't load; for this test only, a resolve/load hook maps "@/" to files, transpiles .tsx, parses .json,
// and stubs the two client components it renders through (the same technique as tests/advisor-splash.test.mts).
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
type NextLoad = (url: string, context: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: { parentURL?: string }, next: NextResolve): ResolveResult;
    load(url: string, context: unknown, next: NextLoad): LoadResult;
  }): void;
};

const STUB_DIR = join(ROOT, "__essay_display_stubs__");
const STUBS: Record<string, string> = {
  "@/components/ui/info-tip": `import React from "react";
const path = (c) => (c && typeof c === "object" ? c.path : undefined);
export const MetricLabel = ({ term, cited, children, className }) => React.createElement("span", { className, "data-term": term, "data-cited": path(cited) }, children);`,
  "@/components/profile/Panel": `import React from "react";
export const Block = ({ id, title, children }) => React.createElement("div", { id }, title ? React.createElement("h3", null, title) : null, children);`,
};
const stubUrl = (name: string) => pathToFileURL(join(STUB_DIR, `${name.replace(/[^a-z]/gi, "_")}.mjs`)).href;
const STUB_SOURCES = new Map(Object.entries(STUBS).map(([name, src]) => [stubUrl(name), src]));

function asFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) if (existsSync(candidate)) return candidate;
  return null;
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: stubUrl(specifier), shortCircuit: true };
    let base: string | null = null;
    if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    if (base?.endsWith(".json")) return { url: pathToFileURL(base).href, shortCircuit: true };
    const file = base ? (/\.tsx?$/.test(base) && existsSync(base) ? base : asFile(base)) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    if (context.parentURL && STUB_SOURCES.has(context.parentURL)) return next(specifier, { ...context, parentURL: pathToFileURL(join(ROOT, "package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    const stub = STUB_SOURCES.get(url);
    if (stub) return { format: "module", source: stub, shortCircuit: true };
    if (url.startsWith("file:") && url.endsWith(".json")) {
      return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
    }
    if (url.startsWith("file:") && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
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
const { EssayPrompts } = (await import("../components/school/EssayPrompts.tsx")) as {
  EssayPrompts: (p: { school: School; cite: (path: string, s?: School) => { path: string }; id?: string; standalone?: boolean }) => ReactElement | null;
};

function fixtureSchool(essaysBlock: SchoolEssays | undefined, extra: Partial<School> = {}): School {
  return { unit_id: "999999", name: "Fixture College", essays: essaysBlock, ...extra } as unknown as School;
}
const cite = (path: string) => ({ path });
const html = (school: School, standalone = false) => renderToStaticMarkup(React.createElement(EssayPrompts, { school, cite, standalone }));

test("EssayPrompts: renders nothing without a block", () => {
  assert.equal(html(fixtureSchool(undefined)), "");
});

test("EssayPrompts: renders nothing for refers_to_form", () => {
  assert.equal(html(fixtureSchool(essays({ status: "refers_to_form", prompts: [] }))), "");
});

test("EssayPrompts: 'none' shows the line and no fold", () => {
  const out = html(fixtureSchool(essays({ status: "none", prompts: [] })));
  assert.match(out, /No essays beyond the Common App&#x27;s/);
  assert.doesNotMatch(out, /Show the prompts/);
});

test("EssayPrompts: the fold lists every prompt, each cited to essays.prompts", () => {
  const e = essays({
    prompts: [
      prompt({ id: "a", text: "Tell us about a challenge.", kind: "essay", limit: { kind: "words", max: 400 } }),
      prompt({ id: "b", text: "Why this college?", kind: "why_us", limit: { kind: "words", max: 250 }, required: false }),
    ],
  });
  const out = html(fixtureSchool(e));
  assert.match(out, /Tell us about a challenge\./);
  assert.match(out, /Why this college\?/);
  // Both rows carry the one lineage record's path (essays.prompts), via the stubbed MetricLabel's data-cited.
  assert.equal(out.match(/data-cited="essays\.prompts"/g)?.length, 2);
  assert.match(out, /The application may ask a few short questions beyond these\./);
});

test("EssayPrompts: platform links show only for a platform this college takes", () => {
  const e = essays({ prompts: [prompt({ id: "a" })] });
  const neither = html(fixtureSchool(e));
  assert.doesNotMatch(neither, /Common App&#x27;s own essay prompts/);
  assert.doesNotMatch(neither, /Coalition&#x27;s own essay prompts/);

  const commonAppOnly = html(fixtureSchool(e, { apply: { common_app: { member: true } } } as never));
  assert.match(commonAppOnly, /Common App&#x27;s own essay prompts/);
  assert.doesNotMatch(commonAppOnly, /Coalition&#x27;s own essay prompts/);

  const both = html(fixtureSchool(e, { apply: { common_app: { member: true } }, coalition: { member: true } } as never));
  assert.match(both, /Common App&#x27;s own essay prompts/);
  assert.match(both, /Coalition&#x27;s own essay prompts/);
});

test("EssayPrompts: standalone wraps in its own Block titled Essays", () => {
  const e = essays({ prompts: [prompt({ id: "a" })] });
  const out = html(fixtureSchool(e), true);
  assert.match(out, /<h3>Essays<\/h3>/);
});

/* ------------------------------------------------------------------ */
/* Guards: the display reads the data, never a hard-coded limit         */
/* ------------------------------------------------------------------ */

test("the display never types the Common App's 650-word figure: the Common App's prompts carry limit: null and the sentence shows a limit only when the data has one", () => {
  const file = JSON.parse(read("data", "reference", "platform-prompts.json")) as { common_app: { limit: unknown } };
  assert.equal(file.common_app.limit, null);
  assert.doesNotMatch(read("components", "school", "EssayPrompts.tsx"), /650/);
  assert.doesNotMatch(read("lib", "essays", "summary.ts"), /650/);
});

test("essayCardLine: 'choose 4 of 8' reads as a choice, each distinct limit once; the plan counts four", () => {
  const eight = Array.from({ length: 8 }, (_, i) => prompt({ id: `123456:2026-27:${i + 1}`, text: `Question ${i + 1}?`, limit: { kind: "words", max: 350 }, required: false }));
  const uc = essays({ choose: { n: 4, of: 8, quote: "You must respond to only 4 of the 8 questions." }, prompts: eight });
  assert.equal(essayCardLine(uc), "Choose 4 of 8 essays (350 words)");
  assert.equal(planEssayCount([uc, essays()]), "5 essays and short answers");
  assert.equal(essayCardLine(essays({ prompts: [prompt(), prompt({ id: "123456:2026-27:2", text: "Second?", limit: { kind: "words", max: 400 } })] })), "2 essays (400 words)", "the same limit twice is said once");
  // Duke's shape: one essay required of everyone beside a pick-some set of five.
  const five = Array.from({ length: 5 }, (_, i) => prompt({ id: `123456:2026-27:${i + 2}`, text: `Option ${i + 1}.`, limit: { kind: "words", max: 250 }, required: false }));
  const duke = essays({ choose: { n: 2, of: 5, quote: "Please respond to up to 2 of the following 5 prompts." }, prompts: [prompt({ kind: "why_us", limit: { kind: "words", max: 250 } }), ...five] });
  assert.equal(essayCardLine(duke), "1 essay (250 words); choose 2 of 5 more (250 words)");
  assert.equal(planEssayCount([duke]), "3 essays and short answers, 1 of them \"why us\"");
});
