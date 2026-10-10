/**
 * The 2018 ACT/SAT concordance (specs/planner/redesign/standing.md "The rules"), shared by the standing model and the
 * GPA model (lib/planner/gpa-model.ts) so neither imports the other. Pure.
 */

/**
 * ACT composite → SAT total, the 2018 concordance (College Board and ACT, "Guide to the 2018 ACT/SAT Concordance").
 * Index = ACT composite; below 9 the tables stop.
 */
const ACT_TO_SAT: Record<number, number> = {
  36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370, 29: 1340, 28: 1310, 27: 1280, 26: 1240,
  25: 1210, 24: 1180, 23: 1140, 22: 1110, 21: 1080, 20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890, 15: 850, 14: 800,
  13: 760, 12: 710, 11: 670, 10: 630, 9: 590,
};

export function actToSat(act: number): number | null {
  return ACT_TO_SAT[Math.round(act)] ?? null;
}

/** SAT total → the ACT composite whose concorded SAT is nearest (ties go to the lower ACT). */
export function satToAct(sat: number): number | null {
  let best: number | null = null;
  let gap = Infinity;
  for (const [act, s] of Object.entries(ACT_TO_SAT)) {
    const d = Math.abs(s - sat);
    if (d < gap || (d === gap && Number(act) < (best ?? Infinity))) {
      best = Number(act);
      gap = d;
    }
  }
  return gap <= 40 ? best : null;
}

