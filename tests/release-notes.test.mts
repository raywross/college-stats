/**
 * Release notes (specs/release-notes.md): every note parses, PR numbers are unique, links between notes and to the
 * site resolve, and the pull-request check fails without this PR's note. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RELEASE_NOTES_DIR,
  linkReleaseNotes,
  parseReleaseNote,
  releaseNoteProblem,
  sortReleaseNotes,
} from "../lib/release-notes.ts";
import { renderSpec } from "../lib/roadmap-render.ts";
import { roadmapPages } from "../lib/roadmap.ts";

const ROOT = join(import.meta.dirname, "..");
const files = readdirSync(join(ROOT, RELEASE_NOTES_DIR)).filter((n) => n.endsWith(".md") && n !== "README.md");
const read = (name: string) => readFileSync(join(ROOT, RELEASE_NOTES_DIR, name), "utf8");
const notes = files.map((name) => parseReleaseNote(`${RELEASE_NOTES_DIR}/${name}`, read(name)));

const note = (front: string, body = "## What's new\n\nA thing.\n") => `---\n${front}\n---\n\n${body}`;
const GOOD = 'title: "A: thing"\npr: 7\ndate: 2026-09-29\nkind: fix\nsummary: It works now.';

test("every release note parses, and PR numbers are unique", () => {
  assert.ok(notes.length > 0);
  const prs = notes.map((n) => n.pr);
  assert.equal(new Set(prs).size, prs.length, "one note per PR");
});

test("the parser rejects notes that would render badly", () => {
  assert.equal(parseReleaseNote("release-notes/ok.md", note(GOOD)).title, "A: thing");
  const bad: [string, string, RegExp][] = [
    ["no frontmatter", "## Hi\n", /frontmatter/],
    ["missing summary", note(GOOD.replace(/\nsummary.*/, "")), /missing "summary"/],
    ["bad kind", note(GOOD.replace("kind: fix", "kind: misc")), /"kind" must be one of/],
    ["bad date", note(GOOD.replace("2026-09-29", "Sept 29")), /"date"/],
    ["bad pr", note(GOOD.replace("pr: 7", "pr: seven")), /"pr"/],
    ["unknown key", note(`${GOOD}\nauthor: me`), /unknown frontmatter key/],
    ["H1 in body", note(GOOD, "# Title\n\nText\n"), /no # heading/],
    ["empty body", note(GOOD, "\n"), /body is empty/],
  ];
  for (const [label, text, error] of bad) {
    assert.throws(() => parseReleaseNote("release-notes/x.md", text), error, label);
  }
  assert.throws(() => parseReleaseNote("release-notes/Bad_Name.md", note(GOOD)), /file name/);
});

test("notes sort newest first, then by PR number", () => {
  const sorted = sortReleaseNotes(notes);
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = [sorted[i - 1], sorted[i]];
    assert.ok(a.date > b.date || (a.date === b.date && a.pr > b.pr), `${a.slug} before ${b.slug}`);
  }
});

test("links between notes stay on the site and point at real notes; site links exist", () => {
  const slugs = new Set(notes.map((n) => n.slug));
  const routes = new Set(["/roadmap", "/release-notes", "/explore", "/compare", "/glossary", "/data", "/"]);
  for (const n of notes) {
    const { html } = renderSpec(linkReleaseNotes(n.body), n.file);
    for (const [, path] of html.matchAll(/href="(\/[^"#]*)/g)) {
      const target = path.match(/^\/release-notes\/(.+)$/)?.[1];
      const roadmap = path.match(/^\/roadmap\/(.+)$/)?.[1];
      if (target) assert.ok(slugs.has(target), `${n.slug}: links to missing note ${target}`);
      else if (roadmap) assert.ok(roadmapPages().some((p) => p.slug === roadmap), `${n.slug}: /roadmap/${roadmap}`);
      else assert.ok(routes.has(path), `${n.slug}: links to ${path}`);
    }
    assert.ok(!html.includes('href="https://github.com/raywross/college-stats/blob/main/release-notes/'), n.slug);
  }
  assert.equal(linkReleaseNotes("[a](loans.md#x) [b](../specs/x.md)"), "[a](/release-notes/loans#x) [b](../specs/x.md)");
});

test("the pull-request check needs a note naming this PR", () => {
  const ok = { file: "release-notes/ok.md", text: note(GOOD) };
  assert.equal(releaseNoteProblem(7, [ok]), null);
  assert.match(releaseNoteProblem(7, []) ?? "", /PR #7 has no release note/);
  assert.match(releaseNoteProblem(8, [ok]) ?? "", /Changed notes: release-notes\/ok\.md \(pr: 7\)/);
  assert.match(releaseNoteProblem(7, [ok, { file: "release-notes/b.md", text: "oops" }]) ?? "", /b\.md: must start/);
});
