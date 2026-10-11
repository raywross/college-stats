/**
 * Static guards for the phone layout (specs/mobile.md): the rules that keep pages from scrolling sideways, and
 * sticky bars in step with the header height. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CSS = readFileSync(join(ROOT, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}
const UI = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))];

/** Declarations of the first rule whose selector is exactly `selector` (whitespace-insensitive). */
function rule(selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const m = CSS.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, "m"));
  return m ? m[1].replace(/\s+/g, " ") : null;
}

test("grids default to one shrinkable column (an `auto` track grows to its widest content)", () => {
  assert.match(rule(".grid") ?? "", /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("horizontal scrollers contain absolutely positioned descendants", () => {
  assert.match(rule('[class*="overflow-x-auto"]') ?? "", /position:\s*relative/);
  const rail = CSS.match(/@utility rail\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(rail, /position:\s*relative/, "the rail utility must be a containing block");
});

test("the page can't scroll sideways", () => {
  assert.match(rule("html, body") ?? "", /overflow-x:\s*clip/);
});

test("form fields are at least 16px on phones, so iOS Safari doesn't zoom in on focus and stay zoomed", () => {
  // Unlayered (outside every @layer) so it outranks Tailwind's text-xs/text-sm utilities.
  const at = CSS.lastIndexOf("@media (max-width: 767px)");
  assert.ok(at >= 0, "the phone form-field rule is missing from app/globals.css");
  const block = CSS.slice(at, at + 800);
  assert.match(block, /select,\s*textarea/);
  assert.match(block, /font-size:\s*max\(16px,\s*1em\)/);
  const layered = [...CSS.matchAll(/@layer [a-z]+ \{/g)].map((m) => m.index ?? 0);
  for (const start of layered) {
    let depth = 0;
    let end = start;
    for (let i = CSS.indexOf("{", start); i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    assert.ok(at < start || at > end, "the form-field rule must sit outside every @layer");
  }
});

test("sticky bars sit below the header via --header-h, not a hard-coded height", () => {
  // `top: "calc(env(safe-area-inset-top, 0px) + 4rem)"` or `top-[calc(env(safe-area-inset-top,0px)+4rem)]`
  const hardCoded = /\btop(?::\s*["'`]|-\[)calc\(env\(safe-area-inset-top[^)]*\)\s*\+\s*\d/;
  const offenders = UI.filter((f) => hardCoded.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, [], "use calc(env(safe-area-inset-top, 0px) + var(--header-h))");
});
