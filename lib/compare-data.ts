import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getData, getDetail, getHistory, getHistoryFiles, type Dataset } from "./data";
import type { School } from "./types";
import type { SchoolDetail } from "./detail";
import type { SchoolHistory } from "./history";
import type { HistoryFiles } from "./supabase";
import { shortName } from "./brand";
import { compareHref, compareTopicOf, type ComparePage } from "./compare-topics";

/** At most this many colleges side by side: MAX_COMPARE in lib/compare.ts, a client module, so not importable here. */
const MAX_IDS = 4;

/** The colleges a compare URL names, loaded once per request and shared by the page and its metadata. */
export interface Comparison {
  data: Dataset;
  /** The resolved colleges' ids, in URL order: for links (`compareHref(ids, …)`) and the cached loaders below. */
  ids: string[];
  schools: School[];
  /** History's shared files (build metadata, CPI), or null when history isn't published or no college resolved. */
  historyFiles: HistoryFiles | null;
}

/**
 * `?ids=` as a string: unique, unknown ids dropped, at most four, URL order kept. React `cache` keys on the string,
 * so a page, its metadata, and the frame share one load.
 */
export const loadComparison = cache(async (idsParam: string): Promise<Comparison> => {
  const data = await getData();
  const wanted = [...new Set(idsParam.split(",").map((id) => id.trim()).filter(Boolean))];
  const schools = data.getSchoolsByIds(wanted).slice(0, MAX_IDS);
  const historyFiles = schools.length > 0 ? await getHistoryFiles() : null;
  return { data, ids: schools.map((s) => s.unit_id), schools, historyFiles };
});

/**
 * A topic page's comparison, or a redirect to the overview when fewer than two colleges resolve: the overview shows
 * the one-college or empty state (specs/compare-redesign.md, owner assumption 4).
 */
export async function requireComparison(idsParam: string): Promise<Comparison> {
  const comparison = await loadComparison(idsParam);
  if (comparison.schools.length < 2) redirect(comparison.ids.length ? compareHref(comparison.ids) : "/compare");
  return comparison;
}

/** Each college's detail file (majors, programs, campus pages), in `ids` order; the key is the comma-joined ids. */
export const loadCompareDetails = cache(async (idsKey: string): Promise<(SchoolDetail | null)[]> =>
  Promise.all(idsKey.split(",").filter(Boolean).map((id) => getDetail(id)))
);

/** Each college's history shard, in `ids` order; the key is the comma-joined ids. */
export const loadCompareHistories = cache(async (idsKey: string): Promise<(SchoolHistory | null)[]> =>
  Promise.all(idsKey.split(",").filter(Boolean).map((id) => getHistory(id)))
);

/** "Harvard vs. Ohio State vs. UCLA · Cost & aid" for a topic page; "Compare: Harvard vs. UCLA" for the overview. */
export function compareMetadata(c: Comparison, page: ComparePage): Metadata {
  const names = c.schools.map(shortName).join(" vs. ");
  if (page === "overview") return { title: names ? `Compare: ${names}` : "Compare" };
  const topic = compareTopicOf(page);
  return { title: `${names || "Compare"} · ${topic.label}`, description: topic.description };
}
