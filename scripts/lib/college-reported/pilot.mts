/**
 * The pilot set: ~50 colleges across selectivity tiers and sectors (specs/college-reported-data.md "Pilot").
 * data/reference/college-reported-pilot.json lists them when it exists; otherwise a deterministic sample is drawn.
 */
import type { School, SchoolType } from "../../../lib/types";

export interface PilotFile {
  colleges: { unit_id: string; tier: string; sector: string }[];
}

export type Tier = "very selective" | "selective" | "less selective" | "open admission";

/** Admit rate under 15% / under 50% / under 85% / 85% and over or not reported. */
export function tierOf(s: School): Tier {
  const r = s.admissions.acceptance_rate;
  if (r === null) return "open admission";
  if (r < 0.15) return "very selective";
  if (r < 0.5) return "selective";
  if (r < 0.85) return "less selective";
  return "open admission";
}

const TIERS: Tier[] = ["very selective", "selective", "less selective", "open admission"];
const SECTORS: SchoolType[] = ["public", "private-nonprofit", "private-forprofit"];

/**
 * `n` colleges spread evenly over tier × sector buckets, round-robin, taking evenly spaced colleges (by unit id)
 * within each bucket. Same input, same pick.
 */
export function pickPilot(schools: School[], n = 50): PilotFile {
  const buckets = TIERS.flatMap((tier) =>
    SECTORS.map((sector) => ({
      tier,
      sector,
      members: schools.filter((s) => tierOf(s) === tier && s.type === sector).sort((a, b) => (a.unit_id < b.unit_id ? -1 : 1)),
    }))
  ).filter((b) => b.members.length);
  const picked: PilotFile["colleges"] = [];
  // How many each bucket gets: equal shares, capped by its size, leftovers to buckets with room.
  const quota = buckets.map(() => 0);
  let left = Math.min(n, buckets.reduce((k, b) => k + b.members.length, 0));
  while (left > 0) {
    for (let i = 0; i < buckets.length && left > 0; i++) {
      if (quota[i] < buckets[i].members.length) {
        quota[i]++;
        left--;
      }
    }
  }
  buckets.forEach((b, i) => {
    const step = b.members.length / quota[i];
    for (let k = 0; k < quota[i]; k++) {
      const s = b.members[Math.floor(k * step + step / 2)];
      picked.push({ unit_id: s.unit_id, tier: b.tier, sector: b.sector });
    }
  });
  return { colleges: picked };
}
