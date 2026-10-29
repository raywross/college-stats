/**
 * Reuse (specs/product/essays/workspace.md "Reuse"): one draft serving several prompts. From a draft, "Use for another
 * college" picks a prompt of the same kind and either links the draft (the same text, as for the main essay) or makes
 * a variant (a copy that remembers its base, for a prompt with another limit or wording). Two checks ride on it:
 * - the college-name check: a variant for college X whose text names another college on the plan gets a warning
 *   ("a 'why us' that names Duke on the Wake Forest draft gets a red line before anything else does");
 * - the base check: a variant whose base changed after the variant was made says so.
 * Pure; safe in server code, client components, and tests.
 */
import type { EssayLimit } from "./count.ts";
import type { EssayKind, PickerGroup, PickerPrompt } from "./prompts.ts";

export type ReuseMode = "link" | "variant";

const sameLimit = (a: EssayLimit | null, b: EssayLimit | null) => (a === null && b === null) || (!!a && !!b && a.kind === b.kind && a.max === b.max && (a.min ?? null) === (b.min ?? null));

/** Link when the other prompt counts the same way to the same limit (identical text expected); else a variant. */
export function suggestedMode(from: EssayLimit | null, to: EssayLimit | null): ReuseMode {
  return sameLimit(from, to) ? "link" : "variant";
}

/** Kinds that read as the same assignment ("why us" and "program" both ask why this place). */
function kindFamily(kind: EssayKind): string {
  if (kind === "why_us" || kind === "program") return "why";
  if (kind === "essay" || kind === "optional" || kind === "other") return "essay";
  return kind;
}

/**
 * The prompts a draft may be reused for: the same family of kind, not the prompt the draft already serves nor one it's
 * already linked to. Each with the suggested mode. A free draft may go to any prompt.
 */
export function reuseChoices(
  draft: { kind: EssayKind; limit: EssayLimit | null; refs: readonly string[] },
  groups: readonly PickerGroup[],
): { group: PickerGroup; prompt: PickerPrompt; mode: ReuseMode }[] {
  const out: { group: PickerGroup; prompt: PickerPrompt; mode: ReuseMode }[] = [];
  for (const group of groups) {
    for (const prompt of group.prompts) {
      if (prompt.kind === "free" || draft.refs.includes(prompt.ref)) continue;
      if (draft.kind !== "free" && kindFamily(prompt.kind) !== kindFamily(draft.kind)) continue;
      out.push({ group, prompt, mode: suggestedMode(draft.limit, prompt.limit) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The college-name check                                              */
/* ------------------------------------------------------------------ */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Short names too common to flag on their own ("State", "Tech", a city that is also a word). */
const TOO_COMMON = new Set(["state", "tech", "college", "university", "institute", "christian", "union", "central", "national", "american", "liberty", "trinity", "grace", "faith", "hope", "unity", "providence"]);

/**
 * The ways an essay may name a college: its full name, the name without a campus suffix ("-Main Campus", "-Ann
 * Arbor"), without "The", without a trailing "University" or "College" ("Duke", "Wake Forest"), and "X University"
 * as "X" for "University of X" ("Michigan"). Forms under four letters, or a lone common word, are left out.
 */
export function nameForms(name: string): string[] {
  const forms = new Set<string>();
  const add = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (t.length < 4) return;
    if (!t.includes(" ") && TOO_COMMON.has(t.toLowerCase())) return;
    forms.add(t);
  };
  const full = name.trim();
  add(full);
  // A campus suffix ("-Main Campus", "-Ann Arbor") only after a name that is whole without it ("Winston-Salem State
  // University" keeps its hyphen).
  const stripped = full.replace(/\s*-\s*(Main Campus|[A-Z][\w .']*)$/u, "");
  const noCampus = stripped !== full && /\b(University|College|Institute)\b/u.test(stripped) ? stripped : full;
  add(noCampus);
  const noThe = noCampus.replace(/^The\s+/u, "");
  add(noThe);
  add(noThe.replace(/\s+(University|College)$/u, ""));
  add(noThe.replace(/^(University|College) of\s+(the\s+)?/u, ""));
  return [...forms].sort((a, b) => b.length - a.length);
}

/** Whether `text` names `form` as a whole phrase (case-insensitive, word boundaries, possessive allowed). */
function names(text: string, form: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(form)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * Other plan colleges a draft for `forCollege` names. A name form that is also a form of `forCollege`'s own name is
 * skipped ("Michigan" on a Michigan State draft is that college's own word).
 */
export function otherCollegesNamed(
  text: string,
  forCollege: { unit_id: string; name: string } | null,
  planColleges: readonly { unit_id: string; name: string }[],
): { unit_id: string; name: string; form: string }[] {
  const own = forCollege ? nameForms(forCollege.name).map((f) => f.toLowerCase()) : [];
  const ownText = forCollege ? forCollege.name.toLowerCase() : "";
  const hits: { unit_id: string; name: string; form: string }[] = [];
  for (const c of planColleges) {
    if (forCollege && c.unit_id === forCollege.unit_id) continue;
    const form = nameForms(c.name).find((f) => {
      const lower = f.toLowerCase();
      if (own.includes(lower) || ownText.includes(lower)) return false;
      return names(text, f);
    });
    if (form) hits.push({ unit_id: c.unit_id, name: c.name, form });
  }
  return hits;
}

/** The warning line for the hits ("This draft names Duke. It's for Wake Forest."), or null. */
export function nameWarning(hits: readonly { form: string }[], forCollege: { name: string } | null): string | null {
  if (hits.length === 0 || !forCollege) return null;
  const list = hits.map((h) => h.form);
  const named = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `This draft names ${named}. It's for ${forCollege.name}.`;
}

/** A variant whose base was edited after the variant was made (ISO timestamps). */
export function baseChangedSince(variantCreated: string, baseUpdated: string): boolean {
  return Date.parse(baseUpdated) > Date.parse(variantCreated);
}
