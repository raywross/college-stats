/**
 * The ED sheet dialog (QA fix 2026-10-16, finding 1): `EdSheetDialog` wraps `EdSheet` in `SheetDialog`, which
 * already renders a title row and a close button, so `EdSheet` must render neither of its own when it's opened as
 * a dialog — one title, one ✕, at both widths (`components/planner/EdSheet.tsx`). This repo has no React test
 * renderer wired up for client components, so the check reads the component's own source (a "source-level test",
 * the same kind `tests/*-ui.test.mts` and the copy guards already use elsewhere in this repo). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const src = readFileSync(join(ROOT, "components/planner/EdSheet.tsx"), "utf8");

function section(name: "EdSheetDialog" | "EdSheet"): string {
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start !== -1, `export function ${name}( not found`);
  const nextExport = src.indexOf("\nexport function ", start + 1);
  return src.slice(start, nextExport === -1 ? src.length : nextExport);
}

test("EdSheetDialog passes chrome=\"dialog\" to EdSheet", () => {
  assert.match(section("EdSheetDialog"), /<EdSheet\b[^>]*\bchrome="dialog"/);
});

test("EdSheetDialog gives SheetDialog the pill text + college name as the title, and the level line as the description", () => {
  const dialog = section("EdSheetDialog");
  assert.match(dialog, /<SheetDialog\b[^>]*\btitle=\{title\}/);
  assert.match(dialog, /<SheetDialog\b[^>]*\bdescription=\{description\}/);
  assert.match(dialog, /const title = facts \? `\$\{pillText\}: \$\{facts\.name\}` : pillText;/, "the title is the pill text plus the college's name (edPillText(...).full + ': ' + name)");
});

test("EdSheet's own title row and close button render only in inline chrome, never in dialog chrome (no two headers, no two close buttons)", () => {
  const sheet = section("EdSheet");
  assert.match(sheet, /chrome\?\s*:\s*"inline"\s*\|\s*"dialog"/, "the chrome prop exists with both modes");
  const start = sheet.indexOf('chrome === "inline" && (');
  assert.ok(start !== -1, 'no chrome === "inline" gate found around the title row');
  const end = sheet.indexOf("{facts.onPlan &&", start);
  const headerBlock = sheet.slice(start, end === -1 ? sheet.length : end);
  assert.match(headerBlock, /font-semibold/, "the title line is inside the inline-only block");
  assert.match(headerBlock, /aria-label="Close the ED facts"/, "the close button is inside the inline-only block");
  // Nothing outside that gated block (the rest of the component body) repeats either piece of chrome.
  const rest = sheet.slice(0, start) + sheet.slice(end === -1 ? sheet.length : end);
  assert.doesNotMatch(rest, /aria-label="Close the ED facts"/, "a second close button would reach a dialog's two X's (QA finding 1)");
});

test("planted bad case: a title row/close button with no chrome gate would fail the guard above", () => {
  const planted = `
export function EdSheet({ onClose }: { onClose?: () => void }) {
  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">ED opportunity: Lafayette College</p>
        <button type="button" onClick={onClose} aria-label="Close the ED facts">x</button>
      </div>
    </section>
  );
}
`;
  assert.doesNotMatch(planted, /chrome === "inline"/, "sanity: the planted snippet really has no gate");
  // The same assertion the real guard makes, now against the planted (broken) snippet: it should fail to find a
  // gated header block, proving the guard isn't vacuously true.
  const start = planted.indexOf('chrome === "inline" && (');
  assert.equal(start, -1);
});
