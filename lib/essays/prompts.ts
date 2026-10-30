/**
 * Prompt references (the Essays build brief "Shared contracts"): what a draft is written for, as a `prompt_ref` string.
 * - `platform:common_app:main`: the Common App's personal essay (650 words, at least 250), one draft for every
 *   Common App college on the plan;
 * - `platform:coalition:<n>`: one of the Coalition's prompts (data/reference/platform-prompts.json);
 * - `college:<unit_id>:<cycle>:<n>`: one of a college's published prompts (`school.essays.prompts[].id` with the
 *   `college:` prefix);
 * - `college:<unit_id>:<cycle>:own-<n>`: a prompt the student typed in for a college whose prompts aren't on file
 *   ("Add what {College} asks", specs/product/essays/tab.md; essays-next brief "Shared contracts"): it ties the draft
 *   to the college with no prompt on file, `own-1`, `own-2`, … per college and cycle (`ownRef`/`nextOwnRef` in
 *   lib/essays/progress.ts). Parsed as a `college` ref with `own: true`, so the grouping and the package see the college;
 * - `free`: a draft with no prompt yet.
 *
 * `resolvePrompt` turns a ref into what the workspace shows: a title, the prompt's text, its limit, its college, its
 * kind, and the page it was read from. A ref whose prompt isn't on file resolves to a "Prompt not on file" entry, never
 * a crash (a college's page changes between cycles; the reference file may be missing on an older deploy).
 *
 * The `SchoolEssays`/`EssayPrompt` shapes are U1's (lib/types.ts); this module declares them locally, matching the
 * contract exactly, and reads `school.essays` through an `unknown` accessor so it compiles without U1's types.
 * Pure; safe in server code, client components, and tests.
 */
import type { EssayLimit } from "./count.ts";

/* The contract's shapes (U1 adds the same to lib/types.ts). */
export type EssayPromptKind = "essay" | "short_answer" | "why_us" | "program" | "activity" | "optional" | "other";
export interface EssayPromptLocal {
  id: string;
  text: string;
  kind: EssayPromptKind;
  limit: { kind: "words" | "characters"; max: number; min?: number } | null;
  required: boolean;
  applies_to: "all" | "transfer" | "international" | { program: string };
  quote: string;
}
export interface SchoolEssaysLocal {
  cycle: string;
  status: "published" | "none" | "refers_to_form";
  source_url: string;
  retrieved: string;
  prompts: EssayPromptLocal[];
}
/** One platform's block in data/reference/platform-prompts.json. */
export interface PlatformBlock {
  cycle: string;
  source_url: string;
  retrieved: string;
  prompts: EssayPromptLocal[];
}
export interface PlatformPrompts {
  common_app?: PlatformBlock | null;
  coalition?: PlatformBlock | null;
}

/** A draft's kind: a college prompt's kind, the personal essay, or free. Stored as `essays.kind`; the telemetry's `prompt_kind`. */
export type EssayKind = "personal" | EssayPromptKind | "free";
export const ESSAY_KINDS: readonly EssayKind[] = ["personal", "essay", "short_answer", "why_us", "program", "activity", "optional", "other", "free"];

export const MAIN_REF = "platform:common_app:main";
export const FREE_REF = "free";
/** The Common App's personal essay limit (the form enforces both ends). */
export const MAIN_LIMIT: EssayLimit = { kind: "words", max: 650, min: 250 };

/** The words a kind goes by in a heading and a list row. */
export const KIND_LABEL: Record<EssayKind, string> = {
  personal: "Personal essay",
  essay: "Essay",
  short_answer: "Short answer",
  why_us: "Why us",
  program: "Program essay",
  activity: "Activity essay",
  optional: "Optional essay",
  other: "Essay",
  free: "Your own essay",
};

export type ParsedRef =
  | { kind: "main" }
  | { kind: "coalition"; n: number }
  | { kind: "college"; unitId: string; cycle: string; n: number; promptId: string; own?: true }
  | { kind: "free" };

/** A ref string, checked; null for anything that isn't one of the five shapes (four kinds; a college ref may be an own one). */
export function parsePromptRef(ref: unknown): ParsedRef | null {
  if (typeof ref !== "string" || ref.length > 200) return null;
  if (ref === MAIN_REF) return { kind: "main" };
  if (ref === FREE_REF) return { kind: "free" };
  let m = /^platform:coalition:([1-9]\d{0,2})$/.exec(ref);
  if (m) return { kind: "coalition", n: Number(m[1]) };
  m = /^college:(\d{1,12}):(\d{4}-\d{2,4}):([1-9]\d{0,2})$/.exec(ref);
  if (m) return { kind: "college", unitId: m[1], cycle: m[2], n: Number(m[3]), promptId: `${m[1]}:${m[2]}:${m[3]}` };
  m = /^college:(\d{1,12}):(\d{4}-\d{2,4}):own-([1-9]\d{0,2})$/.exec(ref);
  if (m) return { kind: "college", unitId: m[1], cycle: m[2], n: Number(m[3]), promptId: `${m[1]}:${m[2]}:own-${m[3]}`, own: true };
  return null;
}

/** The ref for a college prompt's id (`{unit_id}:{cycle}:{n}`). */
export const collegeRef = (promptId: string): string => `college:${promptId}`;
export const coalitionRef = (n: number): string => `platform:coalition:${n}`;

/** The college a ref belongs to, or null (platform prompts and free drafts belong to none). */
export function refUnitId(ref: string): string | null {
  const p = parsePromptRef(ref);
  return p?.kind === "college" ? p.unitId : null;
}

/** Where a prompt was read from (cited beside it). */
export interface PromptSource {
  url: string;
  retrieved: string;
  cycle: string;
}

export interface ResolvedPrompt {
  ref: string;
  /** False for a ref whose prompt isn't on file (or a malformed ref). */
  found: boolean;
  title: string;
  /** The prompt verbatim; null for the main essay (it has seven, in `options`) and a free draft. */
  text: string | null;
  /** The personal essay's prompts to choose from (the Common App's seven), when on file. */
  options: string[];
  limit: EssayLimit | null;
  college: { unit_id: string; name: string } | null;
  kind: EssayKind;
  required: boolean | null;
  source: PromptSource | null;
  /** The sentence the limit and requirement were read from (the college's own words). */
  quote: string | null;
}

/** What the resolver reads: a school by unit id (the dataset's record, any shape) and the reference file. */
export interface PromptLookup {
  school: (unitId: string) => { unit_id: string; name: string } | null | undefined;
  platform: PlatformPrompts | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function asLimit(v: unknown): EssayLimit | null {
  if (!isObj(v)) return null;
  const kind = v.kind;
  const max = v.max;
  if ((kind !== "words" && kind !== "characters") || typeof max !== "number" || !Number.isFinite(max) || max <= 0) return null;
  const min = typeof v.min === "number" && Number.isFinite(v.min) && v.min >= 0 ? v.min : undefined;
  return min === undefined ? { kind, max } : { kind, max, min };
}

function asPrompt(v: unknown): EssayPromptLocal | null {
  if (!isObj(v) || typeof v.id !== "string" || typeof v.text !== "string") return null;
  const kind = (["essay", "short_answer", "why_us", "program", "activity", "optional", "other"] as const).find((k) => k === v.kind) ?? "other";
  const applies = v.applies_to;
  const applies_to: EssayPromptLocal["applies_to"] =
    applies === "all" || applies === "transfer" || applies === "international" ? applies : isObj(applies) && typeof applies.program === "string" ? { program: applies.program } : "all";
  return { id: v.id, text: v.text, kind, limit: asLimit(v.limit), required: v.required !== false, applies_to, quote: typeof v.quote === "string" ? v.quote : "" };
}

function asBlock(v: unknown): PlatformBlock | null {
  if (!isObj(v) || !Array.isArray(v.prompts)) return null;
  return {
    cycle: typeof v.cycle === "string" ? v.cycle : "",
    source_url: typeof v.source_url === "string" ? v.source_url : "",
    retrieved: typeof v.retrieved === "string" ? v.retrieved : "",
    prompts: v.prompts.map(asPrompt).filter((p): p is EssayPromptLocal => p !== null),
  };
}

/**
 * A college record's `essays` block, read without U1's types: null unless it is the contract's shape. Prompts that
 * don't parse are dropped, never thrown.
 */
export function essaysOf(school: unknown): SchoolEssaysLocal | null {
  if (!isObj(school)) return null;
  const e = school.essays;
  if (!isObj(e)) return null;
  const status = e.status === "published" || e.status === "none" || e.status === "refers_to_form" ? e.status : null;
  if (!status || typeof e.cycle !== "string") return null;
  const block = asBlock({ ...e, prompts: Array.isArray(e.prompts) ? e.prompts : [] });
  return block ? { ...block, status } : null;
}

/** The reference file's contents, checked; null when it's missing or isn't the shape. */
export function asPlatformPrompts(v: unknown): PlatformPrompts | null {
  if (!isObj(v)) return null;
  const common_app = asBlock(v.common_app);
  const coalition = asBlock(v.coalition);
  return common_app || coalition ? { common_app, coalition } : null;
}

const NOT_ON_FILE = "Prompt not on file";

function notOnFile(ref: string, college: ResolvedPrompt["college"]): ResolvedPrompt {
  return { ref, found: false, title: NOT_ON_FILE, text: null, options: [], limit: null, college, kind: "other", required: null, source: null, quote: null };
}

const sourceOf = (b: { source_url: string; retrieved: string; cycle: string }): PromptSource | null =>
  b.source_url ? { url: b.source_url, retrieved: b.retrieved, cycle: b.cycle } : null;

/** A ref as the workspace shows it. Never throws. */
export function resolvePrompt(ref: string, lookup: PromptLookup): ResolvedPrompt {
  const p = parsePromptRef(ref);
  if (!p) return notOnFile(ref, null);
  if (p.kind === "free") {
    return { ref, found: true, title: KIND_LABEL.free, text: null, options: [], limit: null, college: null, kind: "free", required: null, source: null, quote: null };
  }
  if (p.kind === "main") {
    const block = lookup.platform?.common_app ?? null;
    return {
      ref,
      found: true,
      title: "The Common App personal essay",
      text: null,
      options: block?.prompts.map((x) => x.text) ?? [],
      limit: MAIN_LIMIT,
      college: null,
      kind: "personal",
      required: true,
      source: block ? sourceOf(block) : null,
      quote: null,
    };
  }
  if (p.kind === "coalition") {
    const block = lookup.platform?.coalition ?? null;
    const prompt = block?.prompts.find((x) => x.id === coalitionRef(p.n)) ?? null;
    if (!block || !prompt) return notOnFile(ref, null);
    return { ref, found: true, title: `Coalition essay ${p.n}`, text: prompt.text, options: [], limit: prompt.limit, college: null, kind: "personal", required: prompt.required, source: sourceOf(block), quote: prompt.quote || null };
  }
  const school = lookup.school(p.unitId) ?? null;
  const college = school ? { unit_id: school.unit_id, name: school.name } : null;
  // A prompt the student typed in for the college (an own ref): found, the student's own kind, tied to the college.
  if (p.own) return { ref, found: true, title: KIND_LABEL.free, text: null, options: [], limit: null, college, kind: "free", required: null, source: null, quote: null };
  const essays = essaysOf(school);
  const prompt = essays?.status === "published" ? (essays.prompts.find((x) => x.id === p.promptId) ?? null) : null;
  if (!essays || !prompt) return notOnFile(ref, college);
  return {
    ref,
    found: true,
    title: KIND_LABEL[prompt.kind],
    text: prompt.text,
    options: [],
    limit: prompt.limit,
    college,
    kind: prompt.kind,
    required: prompt.required,
    source: sourceOf(essays),
    quote: prompt.quote || null,
  };
}

/** One choice in the prompt picker. */
export interface PickerPrompt {
  ref: string;
  title: string;
  text: string | null;
  limit: EssayLimit | null;
  kind: EssayKind;
  required: boolean | null;
}
export interface PickerGroup {
  /** "common_app", "coalition", "free", or a college's unit id. */
  key: string;
  label: string;
  prompts: PickerPrompt[];
  /** A college whose prompts aren't on file (or that publishes none): said so in the picker. */
  note: string | null;
}

/**
 * The picker's groups (workspace.md "Where it lives": "every prompt from the plan's colleges, the platforms' own, or
 * free"): the personal essay first, then each plan college in the plan's order with its published prompts, then the
 * Coalition's, then free. A college with nothing on file is listed with a note so the student knows why it's empty.
 */
export function pickerGroups(colleges: readonly { unit_id: string; name: string }[], lookup: PromptLookup): PickerGroup[] {
  const groups: PickerGroup[] = [];
  const main = resolvePrompt(MAIN_REF, lookup);
  groups.push({ key: "common_app", label: "Common App", prompts: [{ ref: MAIN_REF, title: main.title, text: null, limit: main.limit, kind: "personal", required: true }], note: null });
  for (const c of colleges) {
    const school = lookup.school(c.unit_id) ?? c;
    const essays = essaysOf(school);
    if (!essays || essays.status === "refers_to_form") {
      groups.push({ key: c.unit_id, label: c.name, prompts: [], note: "Prompts not on file yet" });
      continue;
    }
    if (essays.status === "none" || essays.prompts.length === 0) {
      groups.push({ key: c.unit_id, label: c.name, prompts: [], note: "No essays beyond the Common App's" });
      continue;
    }
    groups.push({
      key: c.unit_id,
      label: c.name,
      prompts: essays.prompts.map((x) => ({ ref: collegeRef(x.id), title: KIND_LABEL[x.kind], text: x.text, limit: x.limit, kind: x.kind, required: x.required })),
      note: null,
    });
  }
  const coalition = lookup.platform?.coalition ?? null;
  if (coalition && coalition.prompts.length > 0) {
    groups.push({
      key: "coalition",
      label: "Coalition",
      prompts: coalition.prompts.map((x, i) => {
        const n = Number(/:(\d+)$/.exec(x.id)?.[1] ?? i + 1);
        return { ref: coalitionRef(n), title: `Coalition essay ${n}`, text: x.text, limit: x.limit, kind: "personal" as const, required: x.required };
      }),
      note: null,
    });
  }
  groups.push({ key: "free", label: "Something else", prompts: [{ ref: FREE_REF, title: KIND_LABEL.free, text: null, limit: null, kind: "free", required: null }], note: null });
  return groups;
}
