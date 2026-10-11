/**
 * "Saying what it changes" (specs/chances/course-plan.md): one line about the list from the estimate endpoint asked
 * with the suggested course added as planned (`POST /api/estimate` with `counterfactual.addCourse`, the way the Scores
 * tab asks about a retake). The endpoint is built by another unit; this module renders nothing when it is absent,
 * rate-limited, or errors. Never a percentage, at most one college named, never for a "Reach for everyone", and the
 * sentence always ends "if your grades stay strong" (the note says so). Pure given a `fetch`; client-safe: it holds no
 * rule of the method, only the endpoint's answers.
 */
import { noteText } from "./notes.ts";
import { estimateInputFromProfile } from "./snapshot.ts";
import type { CourseEntry, EstimateResult } from "./types.ts";
import type { StudentProfileData } from "../student-profile.ts";

type Group = "reach" | "target" | "likely";
const RANK: Record<Group, number> = { reach: 0, target: 1, likely: 2 };
const LABEL: Record<Group, string> = { reach: "Reach", target: "Target", likely: "Likely" };
/** Most colleges asked about at once: the signed-out limit, which every caller stays inside. */
export const ESTIMATE_MAX_COLLEGES = 20;

export type EstimateFetch = (body: unknown) => Promise<Record<string, EstimateResult> | null>;

/** The endpoint through `fetch`; null for anything but a well-formed answer (absent endpoint, 404, 429, 500, a network error). */
export function endpointFetch(fetchImpl: typeof fetch = fetch): EstimateFetch {
  return async (body) => {
    try {
      const res = await fetchImpl("/api/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) return null;
      const json = (await res.json()) as { results?: Record<string, EstimateResult> };
      return json && typeof json.results === "object" && json.results !== null ? json.results : null;
    } catch {
      return null;
    }
  };
}

/**
 * The first college whose group goes up with the course, as the sentence ("At Elon: Target → Likely, if your grades stay
 * strong."); null when none changes, or either answer lacks a group or reads "Reach for everyone".
 */
export function groupChangeLine(base: Record<string, EstimateResult>, after: Record<string, EstimateResult>, names: Record<string, string>): string | null {
  for (const unitId of Object.keys(names)) {
    const a = base[unitId];
    const b = after[unitId];
    if (!a || !b || a.group === null || b.group === null) continue;
    if (a.label === "reach-for-everyone" || b.label === "reach-for-everyone") continue;
    if (RANK[b.group] <= RANK[a.group]) continue;
    return noteText({ key: "estimate.group_change", values: { college: names[unitId], from: LABEL[a.group], to: LABEL[b.group] } });
  }
  return null;
}

/**
 * Asks the endpoint twice (the plan as it is, and with `course` added) and returns the group-change sentence, or null.
 * `colleges` are the list's unit ids with their names, in list order; at most ESTIMATE_MAX_COLLEGES are asked.
 */
export async function whatItChanges(args: {
  profile: StudentProfileData;
  colleges: readonly { unitId: string; name: string }[];
  course: CourseEntry;
  fetchEstimate: EstimateFetch;
  /** The answer for the plan as it is, shared between suggestions. */
  base?: Record<string, EstimateResult> | null;
}): Promise<string | null> {
  const colleges = args.colleges.slice(0, ESTIMATE_MAX_COLLEGES);
  if (colleges.length === 0) return null;
  const unitIds = colleges.map((c) => c.unitId);
  const student = estimateInputFromProfile(args.profile, unitIds[0], null).student;
  const base = args.base ?? (await args.fetchEstimate({ student, unitIds }));
  if (!base) return null;
  const after = await args.fetchEstimate({ student, unitIds, counterfactual: { addCourse: args.course } });
  if (!after) return null;
  return groupChangeLine(base, after, Object.fromEntries(colleges.map((c) => [c.unitId, c.name])));
}
