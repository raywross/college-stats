/**
 * A tip (InfoTip, Term, SourceTip, SourcesTip) renders a button, so it can't sit inside another button: a button inside
 * a button is invalid HTML, and React reports a hydration error on every page that renders it. Explore's LGBTQ+ filter
 * chips did (2026-10-04); the fix puts a chip's tip beside it (`Chip`'s `term`). This scans every component and page for
 * a tip written inside a <button> or a filter Chip (which renders a button) in the same JSX block. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TIP = /<(InfoTip|Term|SourceTip|SourcesTip)\b/;
const BUTTONS = ["button", "Chip"] as const;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Where the opening tag that starts at `at` ends (index of its `>`), skipping `{…}` expressions such as `() => …`. */
function openingTagEnd(src: string, at: number): number {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/** Each `<button>`/`<Chip>` element's children in a file that hold a tip, as "line: tag". */
export function tipsInsideButtons(src: string): string[] {
  const found: string[] = [];
  for (const tag of BUTTONS) {
    const open = new RegExp(`<${tag}\\b`, "g");
    for (const m of src.matchAll(open)) {
      const end = openingTagEnd(src, m.index!);
      if (end < 0 || src[end - 1] === "/") continue; // self-closing: no children
      const close = src.indexOf(`</${tag}>`, end);
      if (close < 0) continue;
      const children = src.slice(end + 1, close);
      if (TIP.test(children)) found.push(`${src.slice(0, m.index).split("\n").length}: <${tag}>`);
    }
  }
  return found;
}

test("the scan finds a tip inside a button or a Chip, and not one beside it", () => {
  assert.deepEqual(tipsInsideButtons(`<Chip active onClick={() => go()}>Label <InfoTip term="x" /></Chip>`), ["1: <Chip>"]);
  assert.deepEqual(tipsInsideButtons(`<button type="button">More <Term term="x">y</Term></button>`), ["1: <button>"]);
  assert.deepEqual(tipsInsideButtons(`<span><Chip active onClick={() => go()}>Label</Chip><InfoTip term="x" /></span>`), []);
  assert.deepEqual(tipsInsideButtons(`<Chip active onClick={() => go()} term="x" />`), []);
});

test("no component puts a tip (a button) inside a button", () => {
  const problems = [...tsxFiles(join(ROOT, "app")), ...tsxFiles(join(ROOT, "components"))].flatMap((file) =>
    tipsInsideButtons(readFileSync(file, "utf8")).map((where) => `${relative(ROOT, file)}:${where}`),
  );
  assert.deepEqual(problems, [], "put the tip beside the button (a Chip takes `term`)");
});
