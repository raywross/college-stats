/**
 * What the notes list needs in the browser (components/essays/Notes.tsx), kept apart from the rubric and the guard so
 * neither's text ships to a client bundle: the categories' labels and a stored span as offsets into the field's text.
 * Pure.
 */
import type { NoteCategory } from "./rubric.ts";

/** Where a note points: a paragraph (0-based, as paragraphsOf numbers them) and a character range in it. Null = the whole draft. */
export interface NoteSpan {
  paragraph: number;
  start: number;
  end: number;
}

/** What the notes list calls each kind of note. Never a grade word. */
export const CATEGORY_LABEL: Record<NoteCategory, string> = {
  mechanics: "Mechanics",
  prompt: "The prompt",
  specific: "Specifics",
  structure: "Structure",
  voice: "Voice",
  care: "Care",
  showcase: "What it shows",
  interest: "This college",
};

/**
 * A stored span as offsets into the field's text (what the notes list selects when a note opens to its spot): the
 * paragraph found the way paragraphsOf numbers them, the range inside it. Null when the draft has changed so the span
 * no longer fits (the paragraph is gone or shorter than the span).
 */
export function spanOffsets(text: string, span: NoteSpan): { start: number; end: number } | null {
  let pos = 0;
  let paragraph = -1;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const lineStart = pos;
    pos += line.length + 1;
    const body = line.trim();
    if (!body) continue;
    paragraph++;
    if (paragraph !== span.paragraph) continue;
    if (span.end > body.length || span.start < 0 || span.end <= span.start) return null;
    const lead = line.length - line.trimStart().length;
    return { start: lineStart + lead + span.start, end: lineStart + lead + span.end };
  }
  return null;
}
