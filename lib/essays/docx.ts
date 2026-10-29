/**
 * The round trip's files (specs/product/essays/workspace.md "The round trip", phase 1): a `.docx` or `.txt` from a
 * draft or a college's package, and reading a `.docx`/`.txt` upload back to text. Pure functions over buffers and
 * strings; the Server Action and the export route (lib/essays/store.ts, app/advisor/essays/[id]/export/route.ts) are
 * the only callers, so `docx`'s and `mammoth`'s own Node dependencies never reach a client bundle.
 *
 * The `.docx` round trip is byte-for-byte on the text (tests/essays-docx.test.mts): every line of the stored text
 * becomes its own paragraph, blank lines included, so `textFromDocx` can invert it exactly — mammoth's
 * `extractRawText` joins paragraphs with "\n\n" and adds one trailing pair, which `textFromDocx` strips and reverses.
 * A plain Word document someone else wrote round-trips just as well: Word's own Enter key is a new paragraph too.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import mammoth from "mammoth";
import type { ActivityEntry } from "../chances/types.ts";
import { yearTitle } from "../planner/activity-steps.ts";
import { countLabel, type EssayLimit } from "./count.ts";
import { normalizeText } from "./normalize.ts";
import { collegeRef, MAIN_REF, type EssayPromptLocal, type SchoolEssaysLocal } from "./prompts.ts";

const GRAY = "595959";
const SMALL = 18; // half-points: 9pt

/** One line of the stored text per `Paragraph`, so `textFromDocx` can reverse it exactly. */
function linesToParagraphs(text: string): Paragraph[] {
  return normalizeText(text)
    .split("\n")
    .map((line) => new Paragraph({ children: line ? [new TextRun(line)] : [] }));
}

/** "Up to 650 words, at least 250, optional" — the editor's own limit line, for the page under the prompt. */
export function limitLine(limit: EssayLimit | null, required: boolean | null): string | null {
  const parts = [
    limit ? `Up to ${countLabel(limit.max, null, limit.kind)}` : null,
    limit?.min ? `at least ${limit.min.toLocaleString("en-US")}` : null,
    required === false ? "optional" : null,
  ].filter((v): v is string => v !== null);
  return parts.length ? parts.join(", ") : null;
}

function promptParagraphs(title: string, promptText: string | null, limit: EssayLimit | null, required: boolean | null): Paragraph[] {
  const out: Paragraph[] = [new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 })];
  if (promptText) out.push(new Paragraph({ children: [new TextRun({ text: promptText, color: GRAY, italics: true })] }));
  const ll = limitLine(limit, required);
  if (ll) out.push(new Paragraph({ children: [new TextRun({ text: ll, color: GRAY, size: SMALL })] }));
  return out;
}

export interface DraftFields {
  title: string;
  promptText: string | null;
  limit: EssayLimit | null;
  required?: boolean | null;
  body: string;
}

/** One draft, downloaded (workspace.md "Download a draft as .docx: one heading, the prompt in gray, the text"). */
export async function draftDocxBuffer(d: DraftFields): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: [...promptParagraphs(d.title, d.promptText, d.limit, d.required ?? null), new Paragraph({ text: "" }), ...linesToParagraphs(d.body)] }],
  });
  return Packer.toBuffer(doc);
}

/** One draft as plain text: the title, the prompt, a blank line, the body. */
export function draftTxt(d: Pick<DraftFields, "title" | "promptText" | "body">): string {
  const lines = [d.title];
  if (d.promptText) lines.push("", d.promptText);
  lines.push("", normalizeText(d.body));
  return lines.join("\n");
}

export interface PackageActivity {
  name: string;
  /** "Sport", "Club", "Work", … */
  kindLabel: string;
  roleTitle: string | null;
  /** "9th", "10th", … in order. */
  years: string[];
  hoursPerWeek: number | null;
}

export interface PackageEssay extends DraftFields {
  /** Whether the student has started this prompt's draft yet (package.md: a checklist either way). */
  started: boolean;
}

/**
 * A college's package (workspace.md "Download the package for a college: every essay and short answer in prompt
 * order, each under its prompt and limit, … with the activities list in the Common App's shape … at the end"). An
 * unstarted prompt still gets its heading and limit, so the package doubles as the checklist of what's left.
 */
export async function packageDocxBuffer(opts: { collegeName: string; essays: readonly PackageEssay[]; activities: readonly PackageActivity[] }): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: `${opts.collegeName}: essay package`, heading: HeadingLevel.HEADING_1 })];
  for (const e of opts.essays) {
    children.push(...promptParagraphs(e.title, e.promptText, e.limit, e.required ?? null));
    if (e.started) children.push(new Paragraph({ text: "" }), ...linesToParagraphs(e.body));
    else children.push(new Paragraph({ children: [new TextRun({ text: "Not started yet.", italics: true, color: GRAY })] }));
    children.push(new Paragraph({ text: "" }));
  }
  if (opts.activities.length > 0) {
    children.push(new Paragraph({ text: "Activities", heading: HeadingLevel.HEADING_1 }));
    for (const a of opts.activities) {
      const bits = [a.kindLabel, a.roleTitle, a.years.length ? `Grades ${a.years.join(", ")}` : null, a.hoursPerWeek ? `${a.hoursPerWeek} hrs/wk` : null].filter((v): v is string => !!v);
      children.push(new Paragraph({ children: [new TextRun({ text: a.name, bold: true }), new TextRun({ text: bits.length ? ` — ${bits.join(" · ")}` : "" })] }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

/** The college's package, in plain text, same order as the `.docx`. */
export function packageTxt(opts: { collegeName: string; essays: readonly PackageEssay[]; activities: readonly PackageActivity[] }): string {
  const lines = [`${opts.collegeName}: essay package`, ""];
  for (const e of opts.essays) {
    lines.push(e.title);
    if (e.promptText) lines.push(e.promptText);
    const ll = limitLine(e.limit, e.required ?? null);
    if (ll) lines.push(ll);
    lines.push("", e.started ? normalizeText(e.body) : "Not started yet.", "");
  }
  if (opts.activities.length > 0) {
    lines.push("Activities", "");
    for (const a of opts.activities) {
      const bits = [a.kindLabel, a.roleTitle, a.years.length ? `Grades ${a.years.join(", ")}` : null, a.hoursPerWeek ? `${a.hoursPerWeek} hrs/wk` : null].filter((v): v is string => !!v);
      lines.push(bits.length ? `${a.name} — ${bits.join(" · ")}` : a.name);
    }
  }
  return lines.join("\n");
}

/**
 * Reads a `.docx`'s text back (mammoth, text only: images, comments, and tracked changes are never read, which is
 * the "dropped with a notice" rule — the notice is the import screen's fixed copy, not anything this function
 * computes). Inverts `linesToParagraphs` exactly for a file this module built; a good-enough reading of anyone else's
 * Word document, where Enter is a paragraph break too.
 */
export async function textFromDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  const withoutTrailingPair = value.endsWith("\n\n") ? value.slice(0, -2) : value;
  return normalizeText(withoutTrailingPair.split("\n\n").join("\n"));
}

/** A `.txt` upload's text, decoded as UTF-8 with a leading byte-order mark dropped. */
export function textFromTxt(buffer: Buffer): string {
  return normalizeText(buffer.toString("utf8").replace(/^﻿/, ""));
}

export type UploadKind = "docx" | "txt" | "unsupported";

/** What kind of file a picker or a share-sheet handed over, by extension first, then the browser's MIME guess. */
export function uploadKindOf(filename: string, mime: string): UploadKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (ext === "txt" || mime === "text/plain" || mime === "") return "txt";
  return "unsupported";
}

/** The upload's text, by its kind; throws for `unsupported` (the caller turns that into a message before this). */
export async function textFromUpload(buffer: Buffer, kind: UploadKind): Promise<string> {
  if (kind === "docx") return textFromDocx(buffer);
  if (kind === "txt") return textFromTxt(buffer);
  throw new Error("That file type isn't one we can read here. Upload a .docx or a .txt, or paste the text instead.");
}

const ACTIVITY_KIND_LABEL: Record<ActivityEntry["kind"], string> = {
  sport: "Sport",
  club: "Club",
  arts: "Arts",
  service: "Community service",
  work: "Work",
  research: "Research",
  family: "Family responsibility",
  other: "Activity",
};
const YEAR_SHORT: Record<number, string> = { 9: "9th", 10: "10th", 11: "11th", 12: "12th" };

/**
 * The record's activities, in the Common App's shape (workspace.md "The round trip": "the activities list in the
 * Common App's shape … at the end"): the student's own entries (lib/planner/activity-steps.ts), each with the
 * latest year's title ("Captain", "President") when it says more than "Member", the grades participated, and the
 * weekly hours. There is no free-text description on file (the profile asks for years, a title, and hours, not a
 * paragraph), so the package names the activity, its kind, its title, its years, and its hours — the Common App's
 * columns the record actually has.
 */
export function activitiesForPackage(activities: readonly ActivityEntry[]): PackageActivity[] {
  return activities
    .filter((a) => a.years.length > 0)
    .map((a) => {
      const years = [...a.years].sort((x, y) => x - y);
      const title = yearTitle(a, years[years.length - 1]);
      return {
        name: a.name,
        kindLabel: ACTIVITY_KIND_LABEL[a.kind] ?? "Activity",
        roleTitle: title && title !== "Member" && title !== "Employee" ? title : null,
        years: years.map((y) => YEAR_SHORT[y] ?? String(y)),
        hoursPerWeek: a.hoursPerWeek,
      };
    });
}

/**
 * The package's prompt order (workspace.md: "every essay and short answer in prompt order"): the Common App's main
 * essay first when the college takes it, then the Coalition's prompts in their own order when the college takes
 * that, then the college's own published prompts in page order. Pure; the package page zips this with the
 * student's drafts.
 */
export function packagePromptRefs(essays: SchoolEssaysLocal | null, opts: { commonApp: boolean; coalitionPrompts: readonly EssayPromptLocal[] }): string[] {
  const refs: string[] = [];
  if (opts.commonApp) refs.push(MAIN_REF);
  for (const p of opts.coalitionPrompts) refs.push(p.id);
  if (essays?.status === "published") for (const p of essays.prompts) refs.push(collegeRef(p.id));
  return refs;
}
