/**
 * The console on a phone (specs/product/admin-redesign.md "Phones"; components/admin/ResponsiveTable.tsx,
 * RecordActions.tsx, Collapsible.tsx): every table goes through ResponsiveTable, no minimum widths, records put their
 * actions at the top, forms are one column below `md`. Pages and components can't render under node:test, so these
 * read source; each rule is shown failing on a sample that breaks it. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
