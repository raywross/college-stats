/**
 * The round trip's files (lib/essays/docx.ts; the Essays build brief "U4 Round trip and package"): a draft's
 * `.docx` round trip is byte-for-byte on the text, a `.txt` round trip too, uploads are read by kind, and the
 * normalizer runs on whatever comes back. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  draftDocxBuffer,
  draftTxt,
  textFromDocx,
  textFromTxt,
  textFromUpload,
  uploadKindOf,
  limitLine,
} from "../lib/essays/docx.ts";

/* ------------------------------------------------------------------ */
/* .docx round trip                                                    */
/* ------------------------------------------------------------------ */

const CASES = [
  "Hello world.",
  "First paragraph line one.\n\nSecond paragraph here.\nStill second paragraph (single newline).\nThird line.",
  "",
  "Trailing blank line.\n",
  "Line1\n\n\nLine after two blanks",
  "Em dash — a non-breaking space, and smart “quotes”.",
  "A single word",
];

/** What `draftDocxBuffer` writes, as one `\n`-joined block: the header lines, a blank line, then the body's own
 * lines — the same structure `textFromDocx` reverses, so the whole document's text (not the body alone) is what
 * round-trips exactly. */
function expectedDraftText(d: { title: string; promptText: string | null; limit: Parameters<typeof limitLine>[0]; required?: boolean | null; body: string }): string {
  const parts = [d.title];
  if (d.promptText) parts.push(d.promptText);
  const ll = limitLine(d.limit, d.required ?? null);
  if (ll) parts.push(ll);
  parts.push("", d.body.replace(/\r\n?/g, "\n"));
  return parts.join("\n");
}

for (const body of CASES) {
  test(`a .docx round trip is byte-for-byte on the text: ${JSON.stringify(body).slice(0, 40)}`, async () => {
    const d = { title: "My essay", promptText: "A prompt.", limit: { kind: "words" as const, max: 650, min: 250 }, body };
    const buffer = await draftDocxBuffer(d);
    const back = await textFromDocx(buffer);
    assert.equal(back, expectedDraftText(d));
  });
}

test("a draft with no prompt and no limit round-trips just the title and the body", async () => {
  const d = { title: "Personal essay", promptText: null, limit: null, body: "First line.\nSecond line." };
  const buffer = await draftDocxBuffer(d);
  assert.equal(await textFromDocx(buffer), expectedDraftText(d));
});

test("Windows line endings in the source normalize before they're written", async () => {
  const d = { title: "T", promptText: null, limit: null, body: "one\r\ntwo\r\nthree" };
  const buffer = await draftDocxBuffer(d);
  const back = await textFromDocx(buffer);
  assert.equal(back, expectedDraftText(d));
  assert.equal(back, "T\n\none\ntwo\nthree");
});

/* ------------------------------------------------------------------ */
/* .txt round trip                                                     */
/* ------------------------------------------------------------------ */

test("a .txt round trip is byte-for-byte on the text", () => {
  const body = "Paragraph one.\n\nParagraph two, with an em dash — here.";
  const buffer = Buffer.from(body, "utf8");
  assert.equal(textFromTxt(buffer), body);
});

test("a .txt upload with a byte-order mark drops it", () => {
  const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Hello", "utf8")]);
  assert.equal(textFromTxt(buffer), "Hello");
});

test("a .txt upload's Windows line endings normalize", () => {
  const buffer = Buffer.from("one\r\ntwo", "utf8");
  assert.equal(textFromTxt(buffer), "one\ntwo");
});

/* ------------------------------------------------------------------ */
/* draftTxt                                                             */
/* ------------------------------------------------------------------ */

test("draftTxt lays out the title, the prompt, and the body", () => {
  assert.equal(draftTxt({ title: "Why us", promptText: "Why Wake Forest?", body: "Because." }), "Why us\n\nWhy Wake Forest?\n\nBecause.");
  assert.equal(draftTxt({ title: "Personal essay", promptText: null, body: "My story." }), "Personal essay\n\nMy story.");
});

/* ------------------------------------------------------------------ */
/* uploadKindOf / textFromUpload                                       */
/* ------------------------------------------------------------------ */

test("uploadKindOf reads the extension first, then the MIME type", () => {
  assert.equal(uploadKindOf("essay.docx", ""), "docx");
  assert.equal(uploadKindOf("essay.txt", ""), "txt");
  assert.equal(uploadKindOf("essay", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
  assert.equal(uploadKindOf("essay", "text/plain"), "txt");
  assert.equal(uploadKindOf("essay.pdf", "application/pdf"), "unsupported");
  assert.equal(uploadKindOf("essay", ""), "txt");
});

test("textFromUpload reads a .docx and a .txt by kind, and throws for unsupported", async () => {
  const d = { title: "T", promptText: null, limit: null, body: "Some text." };
  const docxBuffer = await draftDocxBuffer(d);
  assert.equal(await textFromUpload(docxBuffer, "docx"), expectedDraftText(d));
  assert.equal(await textFromUpload(Buffer.from("Plain.", "utf8"), "txt"), "Plain.");
  await assert.rejects(() => textFromUpload(Buffer.from("x"), "unsupported"));
});

/* ------------------------------------------------------------------ */
/* limitLine                                                            */
/* ------------------------------------------------------------------ */

test("limitLine joins the max, the minimum, and whether it's optional", () => {
  assert.equal(limitLine({ kind: "words", max: 650, min: 250 }, true), "Up to 650 words, at least 250");
  assert.equal(limitLine({ kind: "words", max: 250 }, false), "Up to 250 words, optional");
  assert.equal(limitLine(null, null), null);
});
