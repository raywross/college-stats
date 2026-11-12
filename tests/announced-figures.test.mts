/**
 * "Announced so far" (specs/college-reported-fall-figures.md Decisions 2 and 3; components/school/AnnouncedFigures.tsx):
 * the figures a college announced that the exact funnel can't hold. The real component is rendered, transpiled, with
 * Block and MetricLabel stood in for (they need Next and base-ui; neither changes what this checks) and the real
 * lineageFor as the citation. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { School } from "../lib/types";
import type { FieldPath } from "../lib/fields.ts";
import { lineageFor } from "../lib/lineage.ts";
import { GLOSSARY } from "../lib/glossary.ts";
import { miniMeta, miniSchools } from "./helpers/snapshot.mts";

const ROOT = join(import.meta.dirname, "..");
const meta = miniMeta();

async function load() {
  const tmp = mkdtempSync(join(tmpdir(), "announced-"));
  const url = (rel: string) => JSON.stringify(pathToFileURL(join(ROOT, rel)).href);
  const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
  writeFileSync(
    join(tmp, "panel.mjs"),
    `import React from ${JSON.stringify(reactUrl)};
export function Block({ id, title, children }) { return React.createElement("div", { id, "data-block": "" }, React.createElement("h3", null, title), children); }`,
  );
  writeFileSync(
    join(tmp, "tip.mjs"),
    `import React from ${JSON.stringify(reactUrl)};
export function MetricLabel({ term, cited, children }) { return React.createElement("span", { "data-term": term, "data-path": cited.path, "data-quote": cited.quote ?? "" }, children); }`,
  );
  const { outputText } = ts.transpileModule(readFileSync(join(ROOT, "components/school/AnnouncedFigures.tsx"), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const code = outputText
    .replace(/from "@\/lib\/format"/, `from ${url("lib/format.ts")}`)
    .replace(/from "@\/components\/profile\/Panel"/, `from ${JSON.stringify(pathToFileURL(join(tmp, "panel.mjs")).href)}`)
    .replace(/from "@\/components\/ui\/info-tip"/, `from ${JSON.stringify(pathToFileURL(join(tmp, "tip.mjs")).href)}`);
  writeFileSync(join(tmp, "AnnouncedFigures.mjs"), `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(join(tmp, "AnnouncedFigures.mjs")).href)) as typeof import("../components/school/AnnouncedFigures.tsx");
}

type Admissions = NonNullable<NonNullable<School["reported"]>["admissions"]>;
const TERM = "Fall 2031";

/** A fixture college whose federal funnel is older than `TERM`, with a college-reported class merged in. */
function school(r: Partial<Admissions>): School {
  const s = structuredClone(miniSchools()[0]);
  s.reported = {
    admissions: {
      entering_term: TERM,
      year: 2031,
      applicants: null,
      admitted: null,
      enrolled: null,
      acceptance_rate: null,
      source_kind: "notice",
      ...r,
    },
  };
  s.lineage = {};
  for (const [k, v] of Object.entries(s.reported.admissions!)) {
    if (v == null || typeof v === "object") continue;
    s.lineage[`reported.admissions.${k}` as FieldPath] = {
      source: "college-site",
      method: "extracted",
      year: TERM,
      url: "https://example.edu/news/class",
      retrieved: "2031-03-20",
      quote: `quote for ${k}`,
    };
  }
  return s;
}

async function render(s: School): Promise<string> {
  const { AnnouncedFigures } = await load();
  const cite = (path: FieldPath, sc?: School) => lineageFor(path, sc, meta);
  return renderToStaticMarkup(createElement(AnnouncedFigures, { school: s, cite }));
}

test("a newer exact-only reported funnel renders nothing: the exact funnel already shows it", async () => {
  assert.equal(await render(school({ applicants: 82000, admitted: 8200, enrolled: 3700 })), "");
});

test("no reported admissions renders nothing", async () => {
  const s = structuredClone(miniSchools()[0]);
  delete s.reported;
  assert.equal(await render(s), "");
});

test("approx applicants + exact enrolled: one 'about … applied' row cited to the reported path, no enrolled row", async () => {
  const html = await render(school({ applicants: 82000, approx: { applicants: true }, enrolled: 3700 }));
  assert.match(html, /about 82,000 applied/);
  assert.doesNotMatch(html, /enrolled</);
  assert.equal((html.match(/data-path=/g) ?? []).length, 1);
  assert.match(html, /data-term="approximate-figure" data-path="reported\.admissions\.applicants" data-quote="quote for applicants"/);
  assert.match(html, /don&#x27;t change the funnel above/);
});

test("class goal and deposits rows carry their labels, glossary terms and paths", async () => {
  const html = await render(school({ enrollment_target: 3988, deposits: 6682 }));
  assert.match(html, /Class goal: 3,988/);
  assert.match(html, /Deposits: 6,682/);
  assert.match(html, /data-term="enrollment-target" data-path="reported\.admissions\.enrollment_target"/);
  assert.match(html, /data-term="deposits" data-path="reported\.admissions\.deposits"/);
  assert.doesNotMatch(html, /about/);
});

test("an approximate rate reads 'about 10% admitted'; approx admitted and enrolled use their own verbs", async () => {
  const html = await render(school({ acceptance_rate: 0.1, admitted: 10000, enrolled: 3700, approx: { acceptance_rate: true, admitted: true, enrolled: true } }));
  assert.match(html, /about 10% admitted/);
  assert.match(html, /about 10,000 admitted/);
  assert.match(html, /about 3,700 enrolled/);
  assert.match(html, /data-path="reported\.admissions\.acceptance_rate"/);
});

test("the title and the page carry the term from the data and no other four-digit year", async () => {
  const html = await render(school({ applicants: 82000, approx: { applicants: true }, enrollment_target: 3988, deposits: 6682 }));
  assert.match(html, new RegExp(`Announced so far, ${TERM}`));
  const years = (html.replace(TERM, "").match(/\b(19|20)\d{2}\b/g) ?? []).filter((y) => y !== "");
  assert.deepEqual(years, []);
  const src = readFileSync(join(ROOT, "components/school/AnnouncedFigures.tsx"), "utf8");
  assert.doesNotMatch(src, /\b(Fall|Spring) (19|20)\d{2}\b/);
});

test("the glossary has the three terms the rows use", () => {
  for (const t of ["approximate-figure", "enrollment-target", "deposits"]) assert.ok(t in GLOSSARY, t);
});

test("the admissions page mounts the block under the funnel and lists the section only when it renders", () => {
  const page = readFileSync(join(ROOT, "app/schools/[id]/admissions/page.tsx"), "utf8");
  assert.match(page, /hasAnnouncedFigures\(school\) \? \[\{ id: "announced"/);
  assert.match(page, /<AnnouncedFigures school=\{school\} cite=\{citeField\} id="announced" \/>/);
  assert.ok(page.indexOf('<Block id="funnel"') < page.indexOf("<AnnouncedFigures"));
});
