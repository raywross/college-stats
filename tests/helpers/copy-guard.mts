/**
 * The words guard the plan's copy shares (lib/planner/moves-catalog.ts, lib/planner/guides.ts; seasons.md "Rules"):
 * a line fails on a percentage, "×", "odds", "chance", a probability "likely" (the level name "Likely" is fine), a
 * bare number, or "you should". Dates ("Oct 1", "May 1"), the list-size ranges ("15–20", "12–15"), and names with
 * digits ("PSAT/NMSQT", "ED II") are allowed by an explicit list; placeholders (`{target}`, `{college}`) carry no
 * digit and pass. Not a test file (no `.test.mts`).
 */
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";
/** What may carry a digit: a month and day ("Oct 1", "May 1", "Oct 1–31"), the list-size ranges, and names with digits. */
const ALLOWED = [new RegExp(`\\b${MONTH} \\d{1,2}(?:–\\d{1,2})?\\b`, "g"), /\b15–20\b/g, /\b12–15\b/g, /\bPSAT\/NMSQT\b/g, /\bED II\b/g];

/** Every problem with one line of copy (empty when it's fine). */
export function numberProblems(text: string): string[] {
  const problems: string[] = [];
  if (/%|percent/i.test(text)) problems.push("a percentage");
  if (/×|\b\d+x\b/i.test(text)) problems.push("a multiple");
  if (/\bodds\b/i.test(text)) problems.push("odds");
  if (/\bchances?\b/i.test(text)) problems.push("chance");
  if (/\blikely\b/.test(text)) problems.push("a probability 'likely'");
  let rest = text;
  for (const re of ALLOWED) rest = rest.replace(re, "");
  if (/\d/.test(rest)) problems.push("a bare number");
  if (/\byou should\b/i.test(text)) problems.push("'you should'");
  return problems;
}
