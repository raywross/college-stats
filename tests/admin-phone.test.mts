/**
 * The console on a phone (specs/product/admin-redesign.md "Phones"; components/admin/ResponsiveTable.tsx,
 * RecordActions.tsx, Collapsible.tsx): every table goes through ResponsiveTable, no minimum widths, records put their
 * actions at the top, forms are one column below `md`. Most rules read source (a page needs Next to render), each shown
 * failing on a sample that breaks it; ResponsiveTable itself is rendered to check how a long phone list folds. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}
const consoleFiles = () => [...walk("app/admin"), ...walk("components/admin")].filter((f) => f.endsWith(".tsx"));

/** A `min-w-` utility other than `min-w-0` (which lets a flex child shrink; it sets no width). */
const minWidths = (src: string) => src.match(/\bmin-w-(?!0\b)[^\s"'`]+/g) ?? [];
/** A `<table` opening that is not the screen-reader copy of a chart (`className="sr-only"`). */
const bareTables = (src: string) => [...src.matchAll(/<table\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/sr-only/.test(t));

test("no min-w- utility anywhere under app/admin or components/admin", () => {
  for (const f of consoleFiles()) assert.deepEqual(minWidths(read(f).replace(/\/\*[\s\S]*?\*\//g, "")), [], f);
  assert.deepEqual(minWidths('<div className="min-w-[36rem] min-w-0 min-w-8">'), ["min-w-[36rem]", "min-w-8"]);
});

test("no <table> outside ResponsiveTable", () => {
  for (const f of consoleFiles()) {
    if (f === "components/admin/ResponsiveTable.tsx") continue;
    assert.deepEqual(bareTables(read(f)), [], f);
  }
  assert.equal(bareTables('<table className="w-full">').length, 1);
  assert.equal(bareTables('<table className="sr-only">').length, 0);
  assert.match(read("components/admin/ResponsiveTable.tsx"), /<table\b/);
});

test("ResponsiveTable is a Server Component: a table from md, one card per row below it, the contract's roles", () => {
  const src = read("components/admin/ResponsiveTable.tsx");
  assert.doesNotMatch(src, /^["']use client["']/m);
  assert.doesNotMatch(src, /useState|useEffect/);
  assert.match(src, /hidden[^"]*md:block/);
  assert.match(src, /md:hidden/);
  for (const role of ["title", "fact", "actions", "detail"]) assert.match(src, new RegExp(`"${role}"`));
  assert.match(src, /<details/);
  assert.match(src, /<li\b/);
});

/**
 * The real ResponsiveTable, rendered: transpiled, with HelpTip and `cn` stood in for (the (i) icon is a client component
 * that needs Next's Link and base-ui; neither changes what this checks).
 */
async function loadResponsiveTable() {
  const tmp = mkdtempSync(join(tmpdir(), "responsive-table-"));
  const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
  writeFileSync(join(tmp, "helptip.mjs"), `export function HelpTip() { return null; }`);
  writeFileSync(join(tmp, "utils.mjs"), `export const cn = (...a) => a.filter(Boolean).join(" ");`);
  const { outputText } = ts.transpileModule(read("components/admin/ResponsiveTable.tsx"), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const code = outputText
    .replace(/from "@\/components\/admin\/HelpTip"/, `from ${JSON.stringify(pathToFileURL(join(tmp, "helptip.mjs")).href)}`)
    .replace(/from "@\/lib\/utils"/, `from ${JSON.stringify(pathToFileURL(join(tmp, "utils.mjs")).href)}`);
  writeFileSync(join(tmp, "ResponsiveTable.mjs"), `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(join(tmp, "ResponsiveTable.mjs")).href)) as typeof import("../components/admin/ResponsiveTable.tsx");
}

test("a long phone list folds: the first foldAfter cards, then one 44 px 'Show the other N'; the table keeps every row", async () => {
  const { ResponsiveTable, FOLD_AFTER } = await loadResponsiveTable();
  assert.equal(FOLD_AFTER, 25);
  type Row = { id: string; name: string };
  const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: `College ${i + 1}` }));
  const columns = [
    { key: "name", header: "College", role: "title" as const, cell: (r: Row) => r.name },
    { key: "id", header: "Id", cell: (r: Row) => r.id },
  ];
  const render = (n: number, foldAfter?: number) =>
    renderToStaticMarkup(createElement(ResponsiveTable<Row>, { rows: rows(n), columns, rowKey: (r: Row) => r.id, empty: "None", foldAfter }));
  const phone = (html: string) => html.slice(html.indexOf('<div class="md:hidden">'));
  const cards = (html: string) => (html.match(/<li /g) ?? []).length;
  const rowsInTable = (html: string) => (html.match(/<tr /g) ?? []).length;

  const long = render(1000);
  assert.equal(rowsInTable(long), 1000, "the table from md shows every row");
  const [shown, folded] = phone(long).split("<details");
  assert.equal(cards(shown), 25, "the first 25 cards show");
  assert.equal(cards(folded), 975, "the rest wait inside the fold");
  assert.match(folded, /^ class="mt-3" data-fold="true"><summary class="[^"]*\bmin-h-11\b[^"]*">Show the other 975<\/summary>/, "one 44 px summary naming how many");
  assert.equal((phone(long).match(/<details/g) ?? []).length, 1, "one fold, not one per page of rows");

  assert.doesNotMatch(phone(render(25)), /Show the other/, "exactly foldAfter rows: nothing folds");
  assert.equal(cards(phone(render(25))), 25);
  assert.match(phone(render(26)), /Show the other 1</);
  assert.match(phone(render(12, 10)), /Show the other 2</, "a page can pass its own foldAfter");
  assert.equal(cards(phone(render(12, 10)).split("<details")[0]), 10);
  assert.match(phone(render(1300)), /Show the other 1,275</);
  assert.equal(cards(phone(render(100, Number.POSITIVE_INFINITY))), 100, "foldAfter Infinity never folds");
  assert.doesNotMatch(phone(render(100, Number.POSITIVE_INFINITY)), /<details/);
  assert.match(read("components/admin/steward/ProposalApprove.tsx"), /<ResponsiveTable rows=\{rows\}[^\n]*foldAfter=\{Number\.POSITIVE_INFINITY\}/, "Approve's rows never fold: every ticked row stays in sight");
  assert.equal(render(0), '<p class="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">None</p>');
});

test("every table-bearing component builds its rows with ResponsiveTable", () => {
  for (const f of [
    "components/admin/ops/HealthTable.tsx",
    "components/admin/ops/SourceFilesTable.tsx",
    "components/admin/ops/EstimateInputsTable.tsx",
    "components/admin/jobs/JobsTable.tsx",
    "components/admin/jobs/JobRunsTable.tsx",
    "components/admin/steward/ReviewTable.tsx",
    "components/admin/steward/TodoTable.tsx",
    "components/admin/steward/ClustersTable.tsx",
    "components/admin/ChangeSets.tsx",
    "components/admin/Snapshots.tsx",
    "components/admin/SelectivityHistory.tsx",
    "app/admin/data/selectivity/page.tsx",
    "app/admin/data/high-schools/[id]/page.tsx",
    "app/admin/data/colleges/[unit]/views/page.tsx",
    "app/admin/people/[user]/views/page.tsx",
  ]) {
    assert.match(read(f), /<ResponsiveTable\b/, f);
  }
});

test("a person, household, student record, organization and college put their actions in RecordActions at the top", () => {
  for (const f of [
    "app/admin/people/[user]/page.tsx",
    "app/admin/households/[id]/page.tsx",
    "app/admin/students/[id]/page.tsx",
    "app/admin/organizations/[id]/page.tsx",
    "app/admin/data/colleges/[unit]/page.tsx",
  ]) {
    const src = read(f);
    assert.match(src, /<RecordActions\b/, f);
    // before the first Panel of the page body
    assert.ok(src.indexOf("<RecordActions") < src.indexOf("<Panel"), `${f}: actions come before the panels`);
    // the college page keeps an information column (health, viewers), never actions
    if (!f.includes("colleges")) assert.doesNotMatch(src, /<aside\b/, `${f}: no side column of actions`);
  }
  const ra = read("components/admin/RecordActions.tsx");
  assert.match(ra, /flex-wrap/);
});

test("Collapsible folds a panel to its first line below md and opens from md by matchMedia; Panel takes it as `collapse`", () => {
  const c = read("components/admin/Collapsible.tsx");
  assert.match(c, /^"use client"/);
  assert.match(c, /matchMedia\("\(max-width: 767px\)"\)|BELOW_MD/);
  assert.match(c, /\(max-width: 767px\)/);
  assert.match(c, /Show/);
  assert.match(read("components/admin/Panel.tsx"), /collapse\?: ReactNode/);
  assert.match(read("components/admin/Panel.tsx"), /<Collapsible firstLine=\{collapse\}>/);
  assert.match(read("app/admin/students/[id]/page.tsx"), /<Panel collapse=/);
});

test("forms are one column below md: no form grid opens at sm", () => {
  for (const f of [
    "components/admin/PersonPicker.tsx",
    "components/admin/EssayPromptsForm.tsx",
    "app/admin/log/page.tsx",
    "app/admin/data/colleges/[unit]/review/page.tsx",
  ]) {
    assert.doesNotMatch(read(f), /\bsm:(grid-cols|flex-row)/, f);
  }
});

/** Links whose class has no 44 px minimum: `<Link ... className=...>` openings in a source without `min-h-11`/`h-11`/`min-h-12`/`min-h-14`. */
function shortLinks(src: string, hrefPart: string): string[] {
  return [...src.matchAll(/<Link\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(hrefPart) && !/\b(?:min-h-1[124]|h-11)\b/.test(tag));
}

test("text links inside list rows are 44 px tall (QA's phone findings: colleges, proposals, members, organizations, admins)", () => {
  const cases: [string, string][] = [
    ["app/admin/steward/findings/page.tsx", "reviewHref(c.unit_id)"],
    ["components/admin/steward/ClustersTable.tsx", "Href("],
    ["components/admin/steward/ProposalParts.tsx", "Href("],
    ["components/admin/steward/TodoTable.tsx", "reviewHref("],
    ["app/admin/households/[id]/page.tsx", "href="],
    ["app/admin/organizations/[id]/page.tsx", "${m.user_id}"],
    ["app/admin/organizations/[id]/page.tsx", "${s.student_id}"],
    ["app/admin/admins/page.tsx", "/admin/people/"],
  ];
  for (const [file, hrefPart] of cases) {
    const src = read(file);
    assert.ok(src.includes(hrefPart), `${file} has its links`);
    assert.deepEqual(shortLinks(src, hrefPart).filter((t) => !/text-muted-foreground underline-offset-4/.test(t)), [], file);
  }
  const college = read("app/admin/data/colleges/[unit]/page.tsx");
  const notes = [...college.matchAll(/<SourceNote\b[^>]*\/>/g)].map((m) => m[0]);
  assert.ok(notes.length >= 3);
  for (const n of notes) assert.match(n, /\[&_a\]:min-h-11/, "the source note's links are 44 px tall on the console only");
});

test("guard: a row link without a 44 px class is caught", () => {
  assert.equal(shortLinks('<Link href={reviewHref(u)} className={linkCls}>', "reviewHref(").length, 1);
  assert.equal(shortLinks('<Link href={reviewHref(u)} className={`inline-flex min-h-11 items-center ${linkCls}`}>', "reviewHref(").length, 0);
});
