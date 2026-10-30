/**
 * The essays move's fixtures (specs/product/essays/moves.md "Worked example"): the class of 2027's list (Duke ED,
 * Michigan EA, Georgia Tech EA, Yale RD refers to the form, Elon rolling with no supplement; Common App at all five),
 * drafts with no text, and the plan pieces the progress reading and the generator take. Not a test file.
 */
import type { EssayLinkRow, EssayRow, EssayStatus } from "../../lib/essays/rows.ts";
import type { EssayKind } from "../../lib/essays/prompts.ts";
import type { PlanEssays, PlanItem, PlanSchool } from "../../lib/planner/types.ts";
import type { EssayPrompt, SchoolEssays } from "../../lib/types.ts";

export const GRAD = 2027;
export const CYCLE = "2026-27";
export const LIST_ID = "11111111-1111-4111-8111-111111111111";
export const STUDENT_ID = "22222222-2222-4222-8222-222222222222";

export const DUKE = "198419";
export const MICH = "170976";
export const GT = "139755";
export const YALE = "130794";
export const ELON = "198516";

/** Duke's choose set: "choose 1 of 5", each `required: false` (lib/types.ts SchoolEssays.choose). */
export const DUKE_CHOOSE = [3, 4, 5, 6, 7].map((n) => `college:${DUKE}:${CYCLE}:${n}`);

export const prompt = (unit: string, n: number, kind: EssayPrompt["kind"], required = true, applies_to: EssayPrompt["applies_to"] = "all"): EssayPrompt => ({
  id: `${unit}:${CYCLE}:${n}`,
  text: "A prompt.",
  kind,
  limit: { kind: "words", max: 250 },
  required,
  applies_to,
  quote: "",
});

export const published = (prompts: EssayPrompt[], choose?: { n: number; of: number }): SchoolEssays => ({
  cycle: CYCLE,
  status: "published",
  source_url: "https://example.edu/essays",
  retrieved: "2026-08-01",
  ...(choose ? { choose: { ...choose, quote: "" } } : {}),
  prompts,
});

type Deadlines = { ed?: string | null; ea?: string | null; regular?: string | null };

/** A Common App member (an `apply` grid row with its deadlines) unless `member` is false. */
export function school(unit: string, name: string, essays: SchoolEssays | null, deadlines: Deadlines = {}, member = true): PlanSchool {
  return {
    unit_id: unit,
    name,
    cycleStartYear: GRAD - 1,
    editionIsLastCycle: false,
    cites: {},
    profile: null,
    logistics: null,
    apply: member
      ? { deadlines: { ed: deadlines.ed ?? null, ed2: null, ea: deadlines.ea ?? null, ea2: null, rea: null, regular: deadlines.regular ?? null }, common_app: { cycle: CYCLE } }
      : null,
    essays,
  } as unknown as PlanSchool;
}

export function item(unit: string, position: number, round: PlanItem["round"], over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: `item-${unit}`,
    list_id: LIST_ID,
    unit_id: unit,
    category: "target",
    status: "applying",
    outcome: null,
    round,
    position,
    added_by: null,
    added_at: "2026-06-01",
    decision_date: null,
    deadline_text: null,
    deadline_date: null,
    enrolling: false,
    updates: true,
    visited_on: null,
    follows_social: false,
    application_platform: null,
    withdrawn_on: null,
    supplements_count: null,
    ...over,
  } as PlanItem;
}

/** The worked example's five colleges, in the list's order. */
export function workedSchools(): Record<string, PlanSchool> {
  return {
    [DUKE]: school(DUKE, "Duke", published([prompt(DUKE, 1, "why_us"), prompt(DUKE, 2, "essay"), ...[3, 4, 5, 6, 7].map((n) => prompt(DUKE, n, "optional", false))], { n: 1, of: 5 }), { ed: "2026-11-01", regular: "2027-01-02" }),
    [MICH]: school(MICH, "Michigan", published([prompt(MICH, 1, "why_us"), prompt(MICH, 2, "essay")]), { ea: "2026-11-01", regular: "2027-02-01" }),
    [GT]: school(GT, "Georgia Tech", published([prompt(GT, 1, "short_answer"), prompt(GT, 2, "short_answer")]), { ea: "2026-10-15", regular: "2027-01-04" }),
    [YALE]: school(YALE, "Yale", { cycle: CYCLE, status: "refers_to_form", source_url: "https://example.edu", retrieved: "2026-08-01", prompts: [] }, { regular: "2027-01-02" }),
    [ELON]: school(ELON, "Elon", { cycle: CYCLE, status: "none", source_url: "https://example.edu", retrieved: "2026-08-01", prompts: [] }),
  };
}

export function workedItems(): PlanItem[] {
  return [item(DUKE, 0, "ed"), item(MICH, 1, "ea"), item(GT, 2, "ea"), item(YALE, 3, "rd"), item(ELON, 4, "rolling")];
}

let seq = 0;
/** A draft with no text: an id, its ref, a status, and a count. */
export function draft(ref: string, status: EssayStatus = "draft", count = 100, kind: EssayKind = "other", title = "A draft"): EssayRow {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    student_id: STUDENT_ID,
    prompt_ref: ref,
    title,
    count_kind: "words",
    count,
    limit_max: 250,
    limit_min: null,
    status,
    kind,
    base_id: null,
    created: "2026-07-01T00:00:00Z",
    updated: `2026-07-01T00:00:${String(seq % 60).padStart(2, "0")}Z`,
  };
}

export const link = (essay: EssayRow, ref: string): EssayLinkRow => ({ essay_id: essay.id, prompt_ref: ref, created: "2026-07-01T00:00:00Z" });

export const essays = (rows: EssayRow[], links: EssayLinkRow[] = []): PlanEssays => ({ rows, links });

export const ref = (unit: string, n: number) => `college:${unit}:${CYCLE}:${n}`;
export const MAIN = "platform:common_app:main";

/** The drafts on each date of the worked example (moves.md "Worked example"), cumulative. */
export function workedDrafts(on: "jul10" | "jul28" | "aug20" | "oct3" | "oct25" | "nov3" | "nov20"): PlanEssays {
  const rows: EssayRow[] = [];
  if (on === "jul10") return essays(rows);
  rows.push(draft(MAIN, on === "jul28" ? "draft" : "ready", on === "jul28" ? 410 : 640, "personal"));
  if (on === "jul28" || on === "aug20") return essays(rows);
  rows.push(draft(ref(GT, 1), "ready"), draft(ref(GT, 2), "submitted"));
  rows.push(draft(ref(DUKE, 1), "ready"), draft(ref(DUKE, 2), "ready"));
  if (on === "oct3") return essays(rows);
  rows.push(draft(DUKE_CHOOSE[2], "ready"), draft(ref(MICH, 1), "ready"), draft(ref(MICH, 2), on === "oct25" ? "draft" : "ready"));
  if (on === "oct25" || on === "nov3") return essays(rows);
  rows.push(draft(`college:${YALE}:${CYCLE}:own-1`, "ready", 200, "free"), draft(`college:${YALE}:${CYCLE}:own-2`, "ready", 200, "free"));
  return essays(rows);
}
