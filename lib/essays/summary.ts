/**
 * The prompts, summarized (specs/product/essays/prompts.md "Display"; the build brief's "U2 Prompts display"): the
 * card line on "What it takes to apply" and the plan's count across a list of colleges. Pure module (type-only
 * imports), so tests load it directly and components can call it from server or client code.
 */
import type { EssayPrompt, SchoolEssays } from "../types";

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "250 and 400 words" / "250 words" / "500 words and 1,500 characters" (mixed units, rare). */
function limitsParen(prompts: readonly EssayPrompt[]): string {
  const limited = prompts.filter((p): p is EssayPrompt & { limit: NonNullable<EssayPrompt["limit"]> } => p.limit !== null);
  if (!limited.length) return "";
  const sameUnit = limited.every((p) => p.limit.kind === limited[0]!.limit.kind);
  // Each distinct limit once: eight prompts at 350 words read "(350 words)", not "(350, 350, … words)".
  const parts = [...new Set(sameUnit ? limited.map((p) => String(p.limit.max)) : limited.map((p) => `${p.limit.max} ${p.limit.kind}`))];
  const joined = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(parts);
  return sameUnit ? ` (${joined} ${limited[0]!.limit.kind})` : ` (${joined})`;
}

/**
 * The "What it takes to apply" card line (prompts.md "Display"): "2 essays (250 and 400 words) and 3 short
 * answers; 1 optional" for a published page; "No essays beyond the Common App's" for `status: "none"`; null for
 * `refers_to_form` (shows nothing, counted as unknown) and for a college with no `essays` block at all.
 */
export function essayCardLine(essays: SchoolEssays | null | undefined): string | null {
  if (!essays) return null;
  if (essays.status === "refers_to_form") return null;
  if (essays.status === "none") return "No essays beyond the Common App's";
  const { prompts } = essays;
  const shortAnswers = prompts.filter((p) => p.kind === "short_answer");
  const essayPrompts = prompts.filter((p) => p.kind !== "short_answer");
  if (essays.choose) {
    // The optional prompts are the set to pick from; required ones stand on their own. "Choose 4 of 8 essays (350
    // words)" for the UC; "1 essay (250 words); choose 1 of 5 more" for Duke's shape.
    const set = prompts.filter((p) => !p.required);
    const own = prompts.filter((p) => p.required);
    const noun = set.filter((p) => p.kind !== "short_answer").length >= set.filter((p) => p.kind === "short_answer").length ? "essay" : "short answer";
    if (!own.length) return `Choose ${essays.choose.n} of ${essays.choose.of} ${noun}s${limitsParen(set)}`;
    return `${requiredLine(own)}; choose ${essays.choose.n} of ${essays.choose.of} more${limitsParen(set)}`;
  }
  const optionalCount = prompts.filter((p) => !p.required).length;
  let line = requiredLine(prompts);
  if (optionalCount > 0) line += `; ${optionalCount} optional`;
  return line;
}

/** "2 essays (250 and 400 words) and 3 short answers", or "No prompts listed". */
function requiredLine(prompts: readonly EssayPrompt[]): string {
  const shortAnswers = prompts.filter((p) => p.kind === "short_answer");
  const essayPrompts = prompts.filter((p) => p.kind !== "short_answer");
  const segments: string[] = [];
  if (essayPrompts.length) segments.push(`${pluralize(essayPrompts.length, "essay")}${limitsParen(essayPrompts)}`);
  if (shortAnswers.length) segments.push(pluralize(shortAnswers.length, "short answer"));
  return segments.length ? segments.join(" and ") : "No prompts listed";
}

/**
 * The plan's count across a list of colleges (prompts.md "Display"): "14 essays and short answers, 9 of them 'why
 * us'; 3 colleges not on file". A college with no `essays` block at all is "not on file" (unknown); `status: "none"`
 * and `"refers_to_form"` are known facts that add zero prompts. Null when there's nothing to say (every college
 * accounted for with zero prompts, or an empty list).
 */
export function planEssayCount(schoolsEssays: readonly (SchoolEssays | null | undefined)[]): string | null {
  let total = 0;
  let whyUs = 0;
  let notOnFile = 0;
  for (const essays of schoolsEssays) {
    if (!essays) {
      notOnFile++;
      continue;
    }
    if (essays.status === "published") {
      // A college that says "choose 4 of 8" adds four to the list's count, not eight, plus any prompt it requires on its own.
      total += essays.choose ? essays.choose.n + essays.prompts.filter((p) => p.required).length : essays.prompts.length;
      whyUs += essays.prompts.filter((p) => p.kind === "why_us").length;
    }
  }
  const segments: string[] = [];
  if (total > 0) {
    let s = `${total} essay${total === 1 ? "" : "s"} and short answer${total === 1 ? "" : "s"}`;
    if (whyUs > 0) s += `, ${whyUs} of them "why us"`;
    segments.push(s);
  }
  if (notOnFile > 0) segments.push(pluralize(notOnFile, "college") + " not on file");
  return segments.length ? segments.join("; ") : null;
}
