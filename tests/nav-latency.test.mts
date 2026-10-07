/**
 * Navigation latency (specs/serving-architecture.md follow-up): the instant loading states for a household person's
 * page and Explore, the per-request memoization of the household reads, and the audit write moved off the response's
 * critical path. `npm test`. Most guards read source as text (like the public-pages guard in accounts.test.mts), and
 * each has a "guard:" test that feeds it a broken source to show it flags it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ */
/* Loading boundaries                                                   */
/* ------------------------------------------------------------------ */

const LOADING_FILES = ["app/household/[person]/loading.tsx", "app/explore/loading.tsx"] as const;

/** What a loading file must not use: anything that reads the request or the session, and anything that fetches. */
const REQUEST_READS = /\b(cookies|headers)\s*\(|\bgetUser\b|@\/lib\/(auth|supabase-server|households|lists|home-store)|["']next\/headers["']|\bawait\b/;

function loadingProblems(entries: { file: string; src: string }[]): string[] {
  return entries.filter(({ src }) => REQUEST_READS.test(src)).map(({ file }) => file);
}

/** Widths in px that no phone fits (390px screen, 16px gutters) unless a breakpoint prefix applies them. */
function fixedWideClasses(html: string): string[] {
  const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
  return classes.filter((c) => /^(min-)?w-\[(\d+)px\]$/.test(c) && Number(c.match(/\[(\d+)px\]/)![1]) > 358);
}

/** Renders a `.tsx` component with no props: TypeScript's JSX transform, then a plain import (no build step in tests). */
async function renderLoading(rel: string): Promise<string> {
  const { outputText } = ts.transpileModule(read(rel), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
  const dir = mkdtempSync(join(tmpdir(), "nav-latency-"));
  const file = join(dir, "loading.mjs");
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${outputText}`);
  const mod = (await import(pathToFileURL(file).href)) as { default: () => React.ReactElement };
  return renderToStaticMarkup(mod.default());
}

for (const rel of LOADING_FILES) {
  test(`${rel} exists and renders a skeleton with no props`, async () => {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} is missing`);
    const html = await renderLoading(rel);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /animate-pulse/);
    assert.match(html, /bg-muted/);
    assert.deepEqual(fixedWideClasses(html), [], "a fixed pixel width wider than a phone would scroll sideways");
  });
}

test("the person skeleton has the name line, List | Numbers pills, and four list rows", async () => {
  const html = await renderLoading("app/household/[person]/loading.tsx");
  assert.equal((html.match(/<li /g) ?? []).length, 4);
  assert.match(html, /h-\[50px\][^"]*w-full/); // the pills: full width, 44px pills + padding + border on phones
  assert.match(html, /sm:h-\[42px\]/);
});

test("the Explore skeleton has the toolbar, the filter rail, and six cards (rows on phones)", async () => {
  const html = await renderLoading("app/explore/loading.tsx");
  assert.match(html, /<aside class="hidden w-72 shrink-0 lg:block">/);
  assert.match(html, /grid-cols-\[minmax\(0,1fr\)_auto\]/); // the toolbar row's phone layout, as in app/explore/page.tsx
  assert.equal((html.match(/h-\[26rem\]/g) ?? []).length, 6);
  assert.equal((html.match(/h-\[74px\]/g) ?? []).length, 6);
  assert.match(html, /<ul class="space-y-2 sm:hidden">/);
  assert.match(html, /hidden gap-4 sm:grid sm:grid-cols-2 2xl:grid-cols-3/);
});

test("loading files read no cookies, headers, session, or data", () => {
  assert.deepEqual(loadingProblems(LOADING_FILES.map((file) => ({ file, src: read(file) }))), []);
});

test("guard: a loading file that reads the session or request is flagged", () => {
  const fake = [
    { file: "a/loading.tsx", src: 'import { cookies } from "next/headers";\nexport default function L() { cookies(); return null; }' },
    { file: "b/loading.tsx", src: 'import { getUser } from "@/lib/auth";' },
    { file: "c/loading.tsx", src: "export default async function L() { await fetch('/x'); return null; }" },
    { file: "d/loading.tsx", src: "export default function L() { return <div className='animate-pulse bg-muted' />; }" },
  ];
  assert.deepEqual(loadingProblems(fake), ["a/loading.tsx", "b/loading.tsx", "c/loading.tsx"]);
});

test("guard: a skeleton with a fixed pixel width wider than a phone is flagged", () => {
  assert.deepEqual(fixedWideClasses('<div class="w-[420px] h-4 sm:w-[600px] w-[300px]"></div>'), ["w-[420px]"]);
});

/* ------------------------------------------------------------------ */
/* Per-request memoization                                              */
/* ------------------------------------------------------------------ */

/** The source of `export async function name` or `export const name = cache(...)`, up to the declaration's end. */
function declaration(src: string, name: string): string | null {
  const start = src.search(new RegExp(`^(export )?(async function|const) ${name}\\b`, "m"));
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.search(/\n(\}\)?;?)\n/);
  return end < 0 ? rest : rest.slice(0, end + 3);
}

/** `name` is a `cache(` wrapper itself, or an async function that returns/awaits a `cache(` wrapper declared in the file. */
function memoizedProblems(src: string, names: string[]): string[] {
  const problems: string[] = [];
  for (const name of names) {
    const decl = declaration(src, name);
    if (!decl) {
      problems.push(`${name}: not found`);
      continue;
    }
    if (new RegExp(`^(export )?const ${name} = cache\\(`, "m").test(decl)) continue;
    const call = decl.match(/\breturn (\w+)\(/)?.[1];
    if (!call || !declaration(src, call) || !new RegExp(`^const ${call} = cache\\(`, "m").test(declaration(src, call)!)) problems.push(`${name}: not wrapped in cache(`);
  }
  return problems;
}

test("the household reads are memoized per request with React cache", () => {
  assert.deepEqual(memoizedProblems(read("lib/households.ts"), ["myHouseholds", "personPage"]), []);
  assert.deepEqual(memoizedProblems(read("lib/lists.ts"), ["myLists", "getListWithItems"]), []);
  assert.deepEqual(memoizedProblems(read("lib/home-store.ts"), ["myHome"]), []);
  assert.match(read("lib/lists.ts"), /import \{ cache \} from "react";/);
});

test("myLists is keyed by primitives, not by the owner object", () => {
  const src = read("lib/lists.ts");
  assert.match(src, /const listsOfOwner = cache\(async \(kind: [^,]+, ownerId: string\)/);
  assert.match(declaration(src, "myLists")!, /listsOfOwner\(owner\.kind, owner\.id\)/);
});

test("the writes are not cached", () => {
  assert.doesNotMatch(declaration(read("lib/lists.ts"), "getOrCreateDefaultList") ?? "cache(", /cache\(/);
  assert.notEqual(declaration(read("lib/lists.ts"), "getOrCreateDefaultList"), null);
  assert.doesNotMatch(read("lib/home-store.ts"), /(saveHomeAddress|clearHome) = cache\(/);
});

test('"use server" files export only async functions (so cache wrappers stay private)', () => {
  for (const rel of ["lib/lists.ts", "lib/home-store.ts"]) {
    const src = read(rel);
    assert.match(src, /^"use server";/);
    assert.doesNotMatch(src, /^export (const|let|var) /m, `${rel} exports a non-function from a "use server" file`);
  }
});

test("guard: an unwrapped read, or one wrapped in a cache() that isn't declared, is flagged", () => {
  const plain = "export async function myLists(owner) {\n  return 1;\n}\n";
  assert.deepEqual(memoizedProblems(plain, ["myLists"]), ["myLists: not wrapped in cache("]);
  const delegating = "const inner = async (k) => {\n  return 1;\n};\nexport async function myLists(owner) {\n  return inner(owner.id);\n}\n";
  assert.deepEqual(memoizedProblems(delegating, ["myLists"]), ["myLists: not wrapped in cache("]);
  const ok = "const inner = cache(async (k) => {\n  return 1;\n});\nexport async function myLists(owner) {\n  return inner(owner.id);\n}\n";
  assert.deepEqual(memoizedProblems(ok, ["myLists"]), []);
  assert.deepEqual(memoizedProblems("export const personPage = cache(async (id) => {\n  return 1;\n});\n", ["personPage"]), []);
  assert.deepEqual(memoizedProblems(ok, ["gone"]), ["gone: not found"]);
});

/* ------------------------------------------------------------------ */
/* The audit write is off the critical path                             */
/* ------------------------------------------------------------------ */

/** openStudentAs must schedule the log with after() and never await the write itself. */
function auditProblems(src: string): string[] {
  const open = declaration(src, "openStudentAs");
  const schedule = declaration(src, "scheduleStudentReadLog");
  const problems: string[] = [];
  if (!open) return ["openStudentAs: not found"];
  if (/\bawait\s+(logStudentRead|writeAccessLog)\s*\(/.test(open)) problems.push("openStudentAs awaits the log write");
  if (!/\bscheduleStudentReadLog\(/.test(open)) problems.push("openStudentAs does not schedule the log");
  if (!schedule) return [...problems, "scheduleStudentReadLog: not found"];
  if (!/\bafter\(/.test(schedule)) problems.push("scheduleStudentReadLog does not call after(");
  if (!/import \{ after \} from "next\/server";/.test(src)) problems.push("after is not imported from next/server");
  if (!/console\.error/.test(declaration(src, "writeAccessLog") ?? "")) problems.push("writeAccessLog no longer logs errors");
  return problems;
}

test("openStudentAs schedules the guardian's access-log write with after() and does not await it", () => {
  assert.deepEqual(auditProblems(read("lib/households.ts")), []);
});

test("guard: awaiting the log write inside openStudentAs, or dropping after(), is flagged", () => {
  const good = read("lib/households.ts");
  const awaited = good.replace("await scheduleStudentReadLog(studentId, table);", "await logStudentRead(studentId, table);");
  assert.notEqual(awaited, good);
  assert.deepEqual(auditProblems(awaited), ["openStudentAs awaits the log write", "openStudentAs does not schedule the log"]);
  const noAfter = good.replace("after(() => writeAccessLog(supabase, studentId, table));", "void writeAccessLog(supabase, studentId, table);");
  assert.notEqual(noAfter, good);
  assert.deepEqual(auditProblems(noAfter), ["scheduleStudentReadLog does not call after("]);
});

/* ------------------------------------------------------------------ */
/* ListPage's reads                                                     */
/* ------------------------------------------------------------------ */

test("ListPage reads the list, dataset, home, and viewer together, then access, lists, and notes together", () => {
  const src = read("components/lists/ListPage.tsx");
  assert.match(src, /Promise\.all\(\[getUser\(\), getListWithItems\(listId\), getData\(\), myHome\(\)\]\)/);
  assert.match(src, /Promise\.all\(\[\s*resolveAccess\(list, viewer\.id\),\s*myLists\(listOwner\(list\)\),\s*notesForItems\(/);
  assert.doesNotMatch(src, /const access = await resolveAccess/);
});
