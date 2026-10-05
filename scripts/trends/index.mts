/**
 * Every national-trends builder, in one list (specs/national-trends.md#adding-a-study). One line per unit, so
 * branches adding units in parallel only ever touch their own line. Each builder writes
 * data/history/trends/{name}.json; studies also return their /trends card for index.json.
 */
import type { TrendBuilder } from "./context.mts";
import { menAndWomen } from "./studies/men-and-women.mts";
import { priceGap } from "./studies/price-gap.mts";

export const BUILDERS: readonly TrendBuilder[] = [
  menAndWomen,
  priceGap,
  // ↑ One line per unit: Studies 2–6 (scripts/trends/studies/<slug>.mts), movers, conferences, states.
];
