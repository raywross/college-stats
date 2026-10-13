/**
 * `npm run check:visit-events` (specs/product/visit-events.md, "Checks"): per host, over its live upcoming rows, the
 * event count, the staff share (a host above 40% has a new noise pattern the title rules miss), the ZIP share of placed
 * rows (target 95%; below 80% fails), duplicates (one title at one start and place), starts more than 18 months out,
 * and rows whose start is more than a day before they were first seen. Pure: the CLI reads the rows.
 */
import type { VisitEventKind } from "../../../lib/visit-events/types.ts";
import type { StoredEvent } from "./sync.mts";

export const MAX_STAFF_SHARE = 0.4;
export const MIN_ZIP_SHARE = 0.8;
const DAY = 86_400_000;
const MONTHS_18 = 548 * DAY;

export interface HostCheck {
  host: string;
  unitId: string;
  events: number;
  kinds: Partial<Record<VisitEventKind, number>>;
  staffShare: number;
  /** Of the placed rows (not online, not staff): the share with a ZIP. Null when there are none. */
  zipShare: number | null;
  /** Of the placed rows: the share with lat/lng. */
  locatedShare: number | null;
  /** Groups of rows with one title, start, and place: "Campus Tour (2026-10-21T13:00:00Z) ×2". */
  duplicates: string[];
  farOut: string[];
  startsBeforeSeen: string[];
  /** Why the host fails, empty when it passes. */
  failures: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const uniq = (xs: string[]) => [...new Set(xs)];

/** The per-host figures and failures, over rows not removed and starting from yesterday on. */
export function checkHosts(rows: readonly StoredEvent[], now: Date): HostCheck[] {
  const since = now.getTime() - DAY;
  const byHost = new Map<string, StoredEvent[]>();
  for (const r of rows) {
    if (r.removed_at || Date.parse(r.starts_at) < since) continue;
    const list = byHost.get(r.host) ?? [];
    list.push(r);
    byHost.set(r.host, list);
  }
  const out: HostCheck[] = [];
  for (const [host, list] of [...byHost.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const kinds: Partial<Record<VisitEventKind, number>> = {};
    for (const r of list) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
    const staff = list.filter((r) => r.kind === "staff");
    const placed = list.filter((r) => r.kind !== "staff" && r.kind !== "online" && !r.online);
    const zipShare = placed.length ? placed.filter((r) => r.zip).length / placed.length : null;
    const locatedShare = placed.length ? placed.filter((r) => r.lat != null && r.lng != null).length / placed.length : null;
    // One title at one start and place, listed more than once (two Slate ids for one event).
    const groups = new Map<string, StoredEvent[]>();
    for (const r of list) {
      const key = `${r.title.trim().toLowerCase()}|${Date.parse(r.starts_at)}|${(r.venue ?? r.city ?? "").trim().toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const duplicates = [...groups.values()].filter((g) => g.length > 1).map((g) => `${g[0].title} (${g[0].starts_at}) ×${g.length}`);
    const farOut = list.filter((r) => Date.parse(r.starts_at) - now.getTime() > MONTHS_18).map((r) => `${r.title} (${r.starts_at})`);
    const startsBeforeSeen = list.filter((r) => Date.parse(r.first_seen) - Date.parse(r.starts_at) > DAY).map((r) => `${r.title} (${r.starts_at})`);
    const staffShare = list.length ? staff.length / list.length : 0;
    const failures: string[] = [];
    if (staffShare > MAX_STAFF_SHARE) {
      const titles = uniq(staff.map((r) => r.title)).slice(0, 15);
      failures.push(`staff share ${pct(staffShare)} is above ${pct(MAX_STAFF_SHARE)}; staff titles: ${titles.join("; ")}. A new title pattern may be counting real events as staff, or a host is mostly logistics.`);
    }
    if (zipShare != null && zipShare < MIN_ZIP_SHARE) {
      const titles = uniq(placed.filter((r) => !r.zip).map((r) => r.title)).slice(0, 15);
      failures.push(`ZIP share ${pct(zipShare)} is below ${pct(MIN_ZIP_SHARE)}; rows with no ZIP: ${titles.join("; ")}`);
    }
    out.push({ host, unitId: list[0].unit_id, events: list.length, kinds, staffShare, zipShare, locatedShare, duplicates, farOut, startsBeforeSeen, failures });
  }
  return out;
}

/** The report's lines for one host. */
export function hostReport(c: HostCheck): string[] {
  const kinds = Object.entries(c.kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const lines = [
    `${c.host} (${c.unitId}): ${c.events} events (${kinds}); staff ${pct(c.staffShare)}; ZIP ${c.zipShare == null ? "n/a" : pct(c.zipShare)}; located ${c.locatedShare == null ? "n/a" : pct(c.locatedShare)}`,
  ];
  if (c.duplicates.length) lines.push(`  ${c.duplicates.length} duplicated events (title, start, place): ${c.duplicates.slice(0, 5).join("; ")}`);
  if (c.farOut.length) lines.push(`  ${c.farOut.length} start more than 18 months out: ${c.farOut.slice(0, 5).join("; ")}`);
  if (c.startsBeforeSeen.length) lines.push(`  ${c.startsBeforeSeen.length} start more than a day before first seen: ${c.startsBeforeSeen.slice(0, 5).join("; ")}`);
  for (const f of c.failures) lines.push(`  FAIL: ${f}`);
  return lines;
}
