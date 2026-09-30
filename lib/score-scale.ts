/**
 * Axis ranges for test-score bars. A full 400–1600 axis squeezes a selective
 * college's middle 50% into a sliver, so each bar uses the tightest of a few
 * fixed tiers that still holds its 25th percentile (and the reader's own
 * score). Fixed tiers, not per-school minimums, so bars in the same tier stay
 * comparable and the national median tick keeps its place.
 */
export type ScoreTest = "sat" | "sat-section" | "act";

interface Tier {
  scale: [number, number];
  ticks: number[];
}

const TIERS: Record<ScoreTest, Tier[]> = {
  sat: [
    { scale: [1000, 1600], ticks: [1000, 1100, 1200, 1300, 1400, 1500, 1600] },
    { scale: [800, 1600], ticks: [800, 1000, 1200, 1400, 1600] },
    { scale: [400, 1600], ticks: [400, 800, 1000, 1200, 1400, 1600] },
  ],
  "sat-section": [
    { scale: [500, 800], ticks: [500, 600, 700, 800] },
    { scale: [400, 800], ticks: [400, 500, 600, 700, 800] },
    { scale: [200, 800], ticks: [200, 400, 600, 800] },
  ],
  act: [
    { scale: [18, 36], ticks: [18, 24, 30, 36] },
    { scale: [12, 36], ticks: [12, 18, 24, 30, 36] },
    { scale: [1, 36], ticks: [1, 12, 18, 24, 30, 36] },
  ],
};

/** Room left below the lowest value so the bar never starts flush with the axis. */
const PAD: Record<ScoreTest, number> = { sat: 50, "sat-section": 25, act: 1 };

/** The tightest tier whose floor sits below every given score (nulls ignored). */
export function scoreScale(test: ScoreTest, ...values: (number | null | undefined)[]): Tier {
  const present = values.filter((v): v is number => v != null);
  const lowest = present.length ? Math.min(...present) : -Infinity;
  const tiers = TIERS[test];
  return tiers.find((t) => lowest - PAD[test] >= t.scale[0]) ?? tiers[tiers.length - 1];
}
