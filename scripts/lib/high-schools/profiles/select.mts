/**
 * Choosing the profile pilot's 100 high schools (specs/product/high-school-data.md, Phases 3; owner assumption: Los
 * Angeles, Dallas–Fort Worth, New York). Pure: the caller passes the shard rows.
 *
 * The rule, recorded in data/high-schools/profile-pilot.json:
 * - A metro is a circle around a centre point, in its own state (each metro sits in a phase-2 state, so profile data
 *   sits beside state outcomes).
 * - Eligible: open rows from the shards with a 12th grade of at least 10 students (a class a profile can describe);
 *   public schools must be regular (not alternative, special education, or career and technical) and not virtual.
 * - Per metro, two thirds public and one third private, each split into three size bands by total enrollment, so the
 *   pilot covers small, medium and large schools of both kinds.
 * - Within a band, schools are taken in the order of sha256(seed + id): a fixed, reproducible shuffle, not the
 *   biggest or best-known schools. A band with too few schools passes its shortfall to the next band of the same kind.
 */
import { createHash } from "node:crypto";
import type { HighSchool } from "../../../../lib/high-school-types.ts";

export interface Metro {
  key: "los-angeles" | "dallas-fort-worth" | "new-york";
  label: string;
  state: string;
  center: { lat: number; lng: number };
  radius_km: number;
  /** Schools to take from this metro. */
  take: number;
}

export const PILOT_METROS: readonly Metro[] = [
  { key: "los-angeles", label: "Los Angeles", state: "CA", center: { lat: 34.0522, lng: -118.2437 }, radius_km: 40, take: 34 },
  { key: "dallas-fort-worth", label: "Dallas–Fort Worth", state: "TX", center: { lat: 32.8, lng: -97.05 }, radius_km: 55, take: 33 },
  { key: "new-york", label: "New York", state: "NY", center: { lat: 40.7128, lng: -74.006 }, radius_km: 30, take: 33 },
];

export const PILOT_SEED = "hs-profile-pilot-2026";

/** Size bands by total enrollment: [min, max) for public and private schools. */
export const SIZE_BANDS = {
  public: [
    { key: "small", min: 0, max: 500 },
    { key: "medium", min: 500, max: 1500 },
    { key: "large", min: 1500, max: Infinity },
  ],
  private: [
    { key: "small", min: 0, max: 300 },
    { key: "medium", min: 300, max: 800 },
    { key: "large", min: 800, max: Infinity },
  ],
} as const;

export type SizeBand = "small" | "medium" | "large";

export interface PilotSchool {
  id: string;
  name: string;
  kind: "public" | "private";
  metro: Metro["key"];
  city: string | null;
  state: string;
  enrollment: number | null;
  grade12: number | null;
  size: SizeBand;
  district: string | null;
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const NOT_REGULAR = /alternative|special education|career and technical|vocational/i;

/** Whether a row can be in the pilot at all (before the metro test). */
export function eligible(r: HighSchool): boolean {
  const g12 = r.enrollment?.by_grade?.["12"] ?? null;
  if (g12 === null || g12 < 10) return false;
  if (r.kind === "public") {
    if (r.status?.virtual) return false;
    if (r.school_type && NOT_REGULAR.test(r.school_type)) return false;
  }
  return true;
}

export function inMetro(r: HighSchool, m: Metro): boolean {
  if (r.state !== m.state || r.lat === null || r.lng === null) return false;
  return distanceKm({ lat: r.lat, lng: r.lng }, m.center) <= m.radius_km;
}

export function sizeBand(r: Pick<HighSchool, "kind" | "enrollment">): SizeBand {
  const n = r.enrollment?.total ?? 0;
  return SIZE_BANDS[r.kind].find((b) => n >= b.min && n < b.max)!.key;
}

const order = (seed: string, id: string) => createHash("sha256").update(`${seed}:${id}`).digest("hex");

/** How many of `take` go to each kind and band: two thirds public (rounded), bands as even as possible, largest last. */
export function quotas(take: number): Record<"public" | "private", Record<SizeBand, number>> {
  const pub = Math.round((take * 2) / 3);
  const split = (n: number): Record<SizeBand, number> => {
    const base = Math.floor(n / 3);
    const extra = n - base * 3;
    return { small: base, medium: base + (extra >= 2 ? 1 : 0), large: base + (extra >= 1 ? 1 : 0) };
  };
  return { public: split(pub), private: split(take - pub) };
}

/** The pilot's schools for one metro, from every shard row (any state; the metro filters). */
export function selectMetro(rows: readonly HighSchool[], m: Metro, seed = PILOT_SEED): PilotSchool[] {
  const pool = rows.filter((r) => eligible(r) && inMetro(r, m));
  const q = quotas(m.take);
  const out: PilotSchool[] = [];
  for (const kind of ["public", "private"] as const) {
    let carry = 0;
    for (const band of ["small", "medium", "large"] as const) {
      const want = q[kind][band] + carry;
      const cands = pool
        .filter((r) => r.kind === kind && sizeBand(r) === band)
        .sort((a, b) => (order(seed, a.id) < order(seed, b.id) ? -1 : 1));
      const got = cands.slice(0, want);
      carry = want - got.length;
      for (const r of got) {
        out.push({
          id: r.id,
          name: r.name,
          kind,
          metro: m.key,
          city: r.city,
          state: r.state,
          enrollment: r.enrollment?.total ?? null,
          grade12: r.enrollment?.by_grade?.["12"] ?? null,
          size: band,
          district: r.district?.name ?? null,
        });
      }
    }
    // A shortfall in the last band is taken from any band of the same kind not yet used.
    if (carry > 0) {
      const used = new Set(out.map((s) => s.id));
      const rest = pool.filter((r) => r.kind === kind && !used.has(r.id)).sort((a, b) => (order(seed, a.id) < order(seed, b.id) ? -1 : 1));
      for (const r of rest.slice(0, carry)) {
        out.push({ id: r.id, name: r.name, kind, metro: m.key, city: r.city, state: r.state, enrollment: r.enrollment?.total ?? null, grade12: r.enrollment?.by_grade?.["12"] ?? null, size: sizeBand(r), district: r.district?.name ?? null });
      }
    }
  }
  return out;
}

export function selectPilot(rows: readonly HighSchool[], metros: readonly Metro[] = PILOT_METROS, seed = PILOT_SEED): PilotSchool[] {
  return metros.flatMap((m) => selectMetro(rows, m, seed));
}

/** The rule in words, for profile-pilot.json. */
export function selectionRule(metros: readonly Metro[] = PILOT_METROS, seed = PILOT_SEED): string {
  const where = metros.map((m) => `${m.label} (${m.state}, ${m.radius_km} km of ${m.center.lat}, ${m.center.lng}; ${m.take} schools)`).join("; ");
  return (
    `Metros: ${where}. Eligible: shard rows with at least 10 students in grade 12; public schools regular (not alternative, special education, or career and technical) and not virtual. ` +
    `Per metro two thirds public, one third private, each split evenly into size bands by total enrollment (public <500, 500–1,499, 1,500+; private <300, 300–799, 800+), ` +
    `taken within a band in sha256("${seed}:" + id) order; a short band passes its shortfall to the next.`
  );
}
