/**
 * Compare's "All the numbers" rows for CDS C9 (specs/data-expansion/cds-test-scores-and-policy.md, Display): how many
 * sent each test (count and share) and the share in the top band. "–" (null) where not reported or under
 * MIN_SUBMITTERS. Shown only; never in the radar, metric cards, or Key differences. Pure module.
 */
import type { FieldPath } from "./fields";
import type { TermKey } from "./glossary";
import type { School } from "./types";
import { MIN_SUBMITTERS, submitters } from "./score-bands.ts";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "1,243 (33%)", or the share alone when the count isn't reported. */
function sent(n: number | null, share: number | null): string | null {
  if (n === null && share === null) return null;
  if (n === null) return pct(share!);
  return share === null ? n.toLocaleString("en-US") : `${n.toLocaleString("en-US")} (${pct(share)})`;
}

function enough(s: School, test: "sat" | "act"): boolean {
  const t = s.reported?.tests;
  if (!t) return false;
  const n = submitters(test === "sat" ? t.sat_submitters : t.act_submitters, test === "sat" ? t.sat_share : t.act_share, s.admissions.enrolled);
  return n !== null && n >= MIN_SUBMITTERS;
}

export const TEST_ROWS = [
  ["Sent an SAT", "test-submission", "reported.tests.sat_submitters", (s: School) => (s.reported?.tests ? sent(s.reported.tests.sat_submitters, s.reported.tests.sat_share) : null)],
  ["Sent an ACT", "test-submission", "reported.tests.act_submitters", (s: School) => (s.reported?.tests ? sent(s.reported.tests.act_submitters, s.reported.tests.act_share) : null)],
  ["Scored 1400+ on the SAT", "score-bands", "reported.tests.bands.sat_composite", (s: School) => {
    const b = s.reported?.tests?.bands.sat_composite;
    return b && enough(s, "sat") ? pct(b[0]) : null;
  }],
  ["Scored 30+ on the ACT", "score-bands", "reported.tests.bands.act_composite", (s: School) => {
    const b = s.reported?.tests?.bands.act_composite;
    return b && enough(s, "act") ? pct(b[0]) : null;
  }],
] as const satisfies readonly (readonly [string, TermKey, FieldPath, (s: School) => string | null])[];
