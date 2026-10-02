/**
 * Scoring a pilot run against the hand-checked answer key (specs/college-reported-data.md "Pilot"): for each pilot
 * college, did the pipeline find a newer figure where one exists, stay quiet where none exists, and get the numbers
 * right? Pure functions; `scripts/score-college-reported.mts` prints the result.
 */
import type { ReportedEntry, ReviewItem } from "./reported";

export interface PilotCollege {
  unit_id: string;
  name: string;
  tier: string;
  sector: string;
}

export interface AnswerKeyEntry {
  unit_id: string;
  entering_term: string | null;
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
  acceptance_rate: number | null;
  url: string;
  quote: string | null;
  checked: string;
  kind: "class-profile" | "cds";
  none_found?: true;
  notes?: string;
}

export type Outcome =
  /** The key has a figure and the pipeline published the same term with matching numbers. */
  | "correct"
  /** Published the same term, but a number differs beyond tolerance. */
  | "wrong"
  /** Published a different term than the key's (newer or older). */
  | "other-term"
  /** The key has a figure; the pipeline published nothing (queued or silent). */
  | "missed"
  /** The key found nothing newer; the pipeline published something (needs a look: a real find or a false positive). */
  | "unexpected"
  /** The key found nothing and the pipeline published nothing. */
  | "quiet"
  /** The college isn't in the answer key. */
  | "unchecked";

export interface Score {
  unit_id: string;
  name: string;
  tier: string;
  outcome: Outcome;
  queued: boolean;
  detail: string;
}

/** Counts within 0.5% of each other, rates within 0.1 point: the spec's accuracy bar for re-learning a recipe is 1 pt. */
const countsMatch = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
const ratesMatch = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) <= 0.001;

export function scorePilot(pilot: PilotCollege[], key: AnswerKeyEntry[], published: ReportedEntry[], queue: ReviewItem[]): Score[] {
  const keyById = new Map(key.map((k) => [k.unit_id, k]));
  const pubById = new Map(published.map((e) => [e.unit_id, e]));
  const queuedIds = new Set(queue.map((q) => q.unit_id));
  return pilot.map((c) => {
    const k = keyById.get(c.unit_id);
    const p = pubById.get(c.unit_id);
    const queued = queuedIds.has(c.unit_id);
    const base = { unit_id: c.unit_id, name: c.name, tier: c.tier, queued };
    if (!k) return { ...base, outcome: "unchecked", detail: p ? `published ${p.admissions.entering_term}` : "nothing published" };
    if (k.none_found) {
      return p
        ? { ...base, outcome: "unexpected", detail: `published ${p.admissions.entering_term} but the key found nothing newer; check ${p.lineage["reported.admissions.applicants"]?.url ?? p.lineage["reported.admissions.acceptance_rate"]?.url ?? "the source"}` }
        : { ...base, outcome: "quiet", detail: "nothing newer published, as expected" };
    }
    if (!p) return { ...base, outcome: "missed", detail: `key has ${k.entering_term} from ${k.url}${queued ? " (in the review queue)" : ""}` };
    if (p.admissions.entering_term !== k.entering_term) return { ...base, outcome: "other-term", detail: `published ${p.admissions.entering_term}, key has ${k.entering_term}` };
    const diffs: string[] = [];
    if (!countsMatch(p.admissions.applicants, k.applicants)) diffs.push(`applicants ${p.admissions.applicants} vs ${k.applicants}`);
    if (!countsMatch(p.admissions.admitted, k.admitted)) diffs.push(`admitted ${p.admissions.admitted} vs ${k.admitted}`);
    if (!countsMatch(p.admissions.enrolled, k.enrolled)) diffs.push(`enrolled ${p.admissions.enrolled} vs ${k.enrolled}`);
    if (!ratesMatch(p.admissions.acceptance_rate, k.acceptance_rate)) diffs.push(`rate ${p.admissions.acceptance_rate} vs ${k.acceptance_rate}`);
    return diffs.length ? { ...base, outcome: "wrong", detail: diffs.join("; ") } : { ...base, outcome: "correct", detail: `${k.entering_term} matches` };
  });
}

/** Per-tier table: how many had a newer figure to find, how many were found, how many were right. */
export function summarize(scores: Score[]): Record<string, { colleges: number; findable: number; found: number; correct: number; unexpected: number }> {
  const out: Record<string, { colleges: number; findable: number; found: number; correct: number; unexpected: number }> = {};
  for (const s of scores) {
    const t = (out[s.tier] ??= { colleges: 0, findable: 0, found: 0, correct: 0, unexpected: 0 });
    t.colleges++;
    if (["correct", "wrong", "other-term", "missed"].includes(s.outcome)) t.findable++;
    if (["correct", "wrong", "other-term"].includes(s.outcome)) t.found++;
    if (s.outcome === "correct") t.correct++;
    if (s.outcome === "unexpected") t.unexpected++;
  }
  return out;
}
