/**
 * Roadmap (specs/roadmap.md): every planned spec is on /roadmap, every entry points at a real spec, and spec links and
 * anchors survive rendering. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { COMPLEXITY, ROADMAP, ROADMAP_GROUPS, ROADMAP_OVERVIEWS, roadmapPages } from "../lib/roadmap.ts";
import { renderSpec, resolveHref, slugify } from "../lib/roadmap-render.ts";

const ROOT = join(import.meta.dirname, "..");

function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return specFiles(path);
    return name.endsWith(".md") ? [relative(ROOT, path)] : [];
  });
}

/** A spec is planned when its status line says so (not built, not a backlog or index file); deferred ones count. */
const isPlanned = (file: string) =>
  !file.endsWith("README.md") && /^> Status: \*\*(planned|skeleton|deferred)\*\*/m.test(readFileSync(join(ROOT, file), "utf8"));

test("every planned spec is on the roadmap, and every roadmap entry is a planned spec", () => {
  const planned = specFiles(join(ROOT, "specs")).filter(isPlanned).sort();
  const listed = ROADMAP.map((s) => s.file).sort();
  assert.deepEqual(listed, planned, "add new planned specs to lib/roadmap.ts; remove built ones");
});

test("roadmap entries are well formed", () => {
  const slugs = roadmapPages().map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs are unique");
  for (const page of roadmapPages()) {
    assert.ok(existsSync(join(ROOT, page.file)), `${page.file} exists`);
    assert.match(page.slug, /^[a-z0-9-]+$/);
  }
  const groups = new Set(ROADMAP_GROUPS.map((g) => g.key));
  for (const spec of ROADMAP) {
    assert.ok(groups.has(spec.group), `${spec.slug}: known group`);
    assert.ok(spec.complexity in COMPLEXITY, `${spec.slug}: complexity 1–4`);
    assert.ok(spec.summary && spec.complexityNote, `${spec.slug}: summary and complexity note`);
    for (const dep of spec.after ?? []) assert.ok(ROADMAP.some((s) => s.slug === dep), `${spec.slug}: after ${dep}`);
  }
  for (const group of ROADMAP_GROUPS) assert.ok(ROADMAP.some((s) => s.group === group.key), `${group.key} has specs`);
});

test("links between roadmap specs stay on the site; other repo links go to GitHub", () => {
  const from = "specs/data-expansion/residence.md";
  assert.equal(resolveHref("metro-area.md#store", from), "/roadmap/metro-area#store");
  // Built specs leave the roadmap, so links to them go to GitHub.
  assert.equal(resolveHref("majors.md", from), "https://github.com/raywross/college-stats/blob/main/specs/data-expansion/majors.md");
  assert.equal(resolveHref("README.md", from), "/roadmap/data-expansion");
  assert.equal(resolveHref("../religious-life.md", from), "/roadmap/religious-life");
  assert.equal(
    resolveHref("../trends-data.md#storage", from),
    "https://github.com/raywross/college-stats/blob/main/specs/trends-data.md#storage",
  );
  assert.equal(resolveHref("https://nces.ed.gov/ipeds/", from), "https://nces.ed.gov/ipeds/");
  assert.equal(resolveHref("#source", from), "#source");
  assert.equal(resolveHref("data-expansion/", "specs/backlog.md"), "/roadmap/data-expansion");
});

test("heading ids match GitHub's, so the specs' own #anchors work", () => {
  assert.equal(slugify("Store (and the detail file)"), "store-and-the-detail-file");
  assert.equal(slugify("Build notes (phases 2–3)"), "build-notes-phases-23");
  assert.equal(slugify("Keep history?"), "keep-history");
});

test("a link whose text is a file name shows the spec's title instead", () => {
  const titles = new Map([["specs/data-expansion/majors.md", "Majors: Degrees Awarded by Field (IPEDS Completions)"]]);
  const from = "specs/data-expansion/residence.md";
  const { html } = renderSpec("See [majors.md](majors.md) and [the detail file](majors.md#x).", from, titles);
  assert.match(html, />Majors: Degrees Awarded by Field \(IPEDS Completions\)<\/a>/);
  assert.match(html, />the detail file<\/a>/);
});

test("every roadmap page renders with a title, and its in-site anchors exist on the target page", () => {
  const rendered = new Map(
    roadmapPages().map((p) => [p.slug, renderSpec(readFileSync(join(ROOT, p.file), "utf8"), p.file)]),
  );
  for (const [slug, doc] of rendered) {
    assert.ok(doc.title, `${slug}: has an H1`);
    assert.ok(!doc.html.includes("<h1"), `${slug}: H1 is rendered by the page, not the markdown`);
    for (const [, target, hash] of doc.html.matchAll(/href="\/roadmap\/([a-z0-9-]+)(?:#([^"]+))?"/g)) {
      const page = rendered.get(target);
      assert.ok(page, `${slug}: links to /roadmap/${target}, which exists`);
      if (hash) assert.ok(page.html.includes(`id="${hash}"`), `${slug}: /roadmap/${target}#${hash} exists`);
    }
  }
  assert.ok(ROADMAP_OVERVIEWS.every((o) => rendered.has(o.slug)));
});
