/**
 * Consortium of Higher Education LGBT Resource Professionals, campus center map (specs/lgbtq-life.md "Case study";
 * specs/campus-directories.md). The find-an-lgbtq-campus-center page embeds a Google My Maps map
 * (`google.com/maps/d/u/1/embed?mid=…`); Google My Maps publishes a KML export of any map its owner has made public
 * at the same `mid`, so reading `google.com/maps/d/kml?mid=…` is the map's own public export, not a way around
 * anything (recon 2026-10-04 found no other data feed on the page itself). robots.txt allows both the page and the
 * export (checked 2026-10-04). Tier D (owner decision 4): a center the Consortium lists, not confirmed by the
 * college; directories lag closures (lgbtq-life.md's UT Austin case study), so the profile pairs this with the
 * state-law line rather than asserting a listed center is still open.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";
import { clean, decode } from "./_tpc-common.mts";

const PAGE_URL = "https://www.lgbtcampus.org/find-an-lgbtq-campus-center";
const MID = "1uYlF3milN1euuDcLS_iXLncpsHQ";
const KML_URL = `https://www.google.com/maps/d/kml?mid=${MID}&forcekml=1`;

/** The map's `mid`, read from the page's embedded iframe, so a re-crawl notices if the Consortium swaps maps. */
export function embeddedMid(html: string): string | null {
  return /google\.com\/maps\/d\/(?:u\/\d+\/)?embed\?mid=([\w-]+)/.exec(html)?.[1] ?? null;
}

type Center = { name: string | null; year: number | null; url: string | null };
const FOUNDED = /found(?:ed|ing)?\s*:?\s*(?:in\s*)?(\d{4})/i;
const URL_LINE = /^(https?:\/\/\S+)$/;
const empty = (): Center => ({ name: null, year: null, url: null });
const isSet = (c: Center) => c.name !== null || c.year !== null || c.url !== null;

/**
 * One placemark's description: "Center name<br>Founded: YYYY<br>http://…" lines, `<br><br>`-separated when a campus
 * lists several centers (e.g. UCLA's two). Blank-line breaks mark a new center only some of the time (sometimes
 * they just separate a center's own year from its URL), so centers are split by which field repeats: a second
 * founding year, a second URL, or a second name line starts a new one. About a fifth of placemarks (2026-10-04) have
 * no description at all; the marker alone still means the Consortium lists a center there, so an empty description
 * still yields one bare entry (just the campus), not zero.
 */
export function centersFrom(description: string): Center[] {
  const lines = decode(description)
    .split(/<br\s*\/?>/i)
    .map((l) => clean(l))
    .filter(Boolean);
  const out: Center[] = [];
  let cur = empty();
  const startNew = (next: Center) => {
    out.push(cur);
    cur = next;
  };
  for (const line of lines) {
    const year = FOUNDED.exec(line)?.[1];
    const url = URL_LINE.exec(line)?.[1];
    if (year) {
      if (cur.year !== null) startNew({ ...empty(), year: Number(year) });
      else cur.year = Number(year);
    } else if (url) {
      if (cur.url !== null) startNew({ ...empty(), url });
      else cur.url = url;
    } else {
      if (isSet(cur)) startNew({ ...empty(), name: line });
      else cur.name = line;
    }
  }
  if (isSet(cur) || !out.length) out.push(cur);
  return out;
}

/** Every `<Placemark>` in the Consortium's KML export: the campus name and its center(s). */
export function entriesFromKml(kml: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const m of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const campus = clean(/<name>([\s\S]*?)<\/name>/.exec(m[1])?.[1] ?? "");
    if (!campus) continue;
    const description = /<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/.exec(m[1])?.[1] ?? "";
    for (const c of centersFrom(description)) {
      out.push({ campus, ...(c.name ? { name: c.name } : {}), ...(c.url ? { url: c.url } : {}), ...(c.year ? { fact: `founded ${c.year}` } : {}) });
    }
  }
  return out;
}

export default defineAdapter({
  key: "lgbt-campus-consortium",
  organization: "Consortium of Higher Education LGBT Resource Professionals",
  publisher: "Consortium of Higher Education LGBT Resource Professionals",
  listUrl: PAGE_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "center",
  async crawl(ctx) {
    const page = await ctx.fetchText(PAGE_URL);
    const mid = embeddedMid(page);
    if (mid !== MID) ctx.log(`the page's embedded map id changed (now ${mid}); update MID in this adapter`);
    const kml = await ctx.fetchText(mid ? `https://www.google.com/maps/d/kml?mid=${mid}&forcekml=1` : KML_URL);
    const entries = entriesFromKml(kml);
    ctx.log(`${entries.length} centers at ${new Set(entries.map((e) => e.campus)).size} campuses`);
    return entries;
  },
});
