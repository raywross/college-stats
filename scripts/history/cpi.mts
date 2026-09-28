/**
 * CPI-U (all urban consumers, U.S. city average, not seasonally adjusted; BLS series CUUR0000SA0), averaged over
 * each school year (July–June), the way NCES's Digest adjusts college prices. BLS's public API v1 needs no key and
 * returns up to 10 years per request.
 */
import type { CpiTable } from "../../lib/history.ts";

export const CPI_SERIES = "CUUR0000SA0";
/** v2 with a free registration key (BLS_API_KEY) allows 500 requests a day and 20 years per request; v1 needs no key. */
const API = process.env.BLS_API_KEY ? "https://api.bls.gov/publicAPI/v2/timeseries/data/" : "https://api.bls.gov/publicAPI/v1/timeseries/data/";

/** One month's index: year, month 1–12, value (null when BLS didn't collect it). */
export type CpiMonth = [number, number, number | null];

/**
 * School-year averages from monthly values: year Y = July Y through June Y+1. A year needs its June and at least
 * 11 of 12 months (October 2025 was never collected, during the 2025 funding lapse).
 */
export function schoolYearAverages(months: readonly CpiMonth[], from: number): { start: number; values: number[]; missing: string[] } {
  const byKey = new Map(months.map(([y, m, v]) => [`${y}-${m}`, v]));
  const values: number[] = [];
  const missing: string[] = [];
  for (let y = from; ; y++) {
    const keys = [7, 8, 9, 10, 11, 12].map((m) => `${y}-${m}`).concat([1, 2, 3, 4, 5, 6].map((m) => `${y + 1}-${m}`));
    const got = keys.map((k) => byKey.get(k) ?? null);
    const present = got.filter((v): v is number => v !== null);
    if (got[11] === null || present.length < 11) break;
    keys.forEach((k, i) => got[i] === null && missing.push(k));
    values.push(Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 1000) / 1000);
  }
  return { start: from, values, missing };
}

/** Fetch monthly CPI from BLS for [from, to] in 10-year requests. */
export async function fetchCpiMonths(from: number, to: number): Promise<CpiMonth[]> {
  const out: CpiMonth[] = [];
  for (let start = from; start <= to; start += 10) {
    const end = Math.min(to, start + 9);
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesid: [CPI_SERIES], startyear: String(start), endyear: String(end), ...(process.env.BLS_API_KEY ? { registrationkey: process.env.BLS_API_KEY } : {}) }),
    });
    if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);
    const body = (await res.json()) as {
      status: string;
      message: string[];
      Results?: { series: { data: { year: string; period: string; value: string }[] }[] };
    };
    if (body.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS: ${body.status} ${body.message.join("; ")}`);
    for (const d of body.Results!.series[0].data) {
      const m = /^M(\d\d)$/.exec(d.period);
      if (!m || m[1] === "13") continue; // M13 = annual average
      const v = Number(d.value);
      out.push([Number(d.year), Number(m[1]), Number.isFinite(v) ? v : null]);
    }
  }
  return out;
}

export async function buildCpi(from: number): Promise<CpiTable> {
  const months = await fetchCpiMonths(from, new Date().getFullYear());
  const { start, values, missing } = schoolYearAverages(months, from);
  return {
    series: CPI_SERIES,
    label: "Consumer Price Index for All Urban Consumers (CPI-U), U.S. city average, all items",
    url: `https://data.bls.gov/timeseries/${CPI_SERIES}`,
    retrieved: new Date().toISOString().slice(0, 10),
    basis: "School-year average, July through June, as in NCES's Digest of Education Statistics",
    start,
    values,
    missing,
  };
}
