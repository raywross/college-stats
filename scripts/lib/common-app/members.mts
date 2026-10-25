/**
 * Common App member records (specs/data-expansion/common-app.md, source 2): the Explore sitemap lists every member's
 * slug, and each member's Gatsby `page-data.json` holds its IPEDS id (the join to the site's `unit_id`), alternate
 * names, aid flags, a few links on the college's own site, and the first-year flags. Common App agreed to this use in
 * October 2026: one request per member per refresh, through PoliteHttp (honest user agent, at least a second between
 * requests), cached in data/common-app/members.json so a rerun fetches only new slugs.
 *
 * Only the fields in `Member` are kept: no marketing text, quotes, photos, logos, phone numbers, or staff emails, and
 * any URL pointing at commonapp.org is dropped (the site may link only to the homepage).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PoliteHttp } from "../college-reported/http.mts";
import type { Member, MembersFile } from "../../../lib/common-app/types.ts";

export const SITEMAP_URL = "https://www.commonapp.org/sitemap-0.xml";
export const pageDataUrl = (slug: string) => `https://www.commonapp.org/page-data/explore/${slug}/page-data.json`;

/** The Explore slugs in a sitemap's text: `/explore/<slug>` URLs, one path segment, sorted and unique. */
export function slugsFromSitemap(xml: string): string[] {
  const out = new Set<string>();
  for (const m of xml.matchAll(/<loc>\s*https?:\/\/(?:www\.)?commonapp\.org\/explore\/([a-z0-9][a-z0-9-]*)\/?\s*<\/loc>/gi)) out.add(m[1].toLowerCase());
  return [...out].sort();
}

/** Every member slug from the sitemap. Throws when the sitemap can't be read. */
export async function fetchSlugs(http: Pick<PoliteHttp, "get">): Promise<string[]> {
  const res = await http.get(SITEMAP_URL);
  if (!res) throw new Error(`${SITEMAP_URL}: robots.txt disallows it`);
  if (!res.ok) throw new Error(`${SITEMAP_URL}: HTTP ${res.status}`);
  const slugs = slugsFromSitemap(await res.text());
  if (!slugs.length) throw new Error(`${SITEMAP_URL}: no /explore/ URLs`);
  return slugs;
}

type Raw = Record<string, unknown> | null | undefined;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const yesNo = (v: unknown): boolean | null => (v === "Yes" ? true : v === "No" ? false : null);
const flag = (v: unknown): boolean => v === "Yes";
/** Drupal relationships come as an object or a one-element list. */
const one = (v: unknown): Raw => (Array.isArray(v) ? (v[0] as Raw) : (v as Raw));

/** An http(s) URL that isn't on commonapp.org; anything else is null. */
export function ownSiteUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (/(^|\.)commonapp\.org$/i.test(u.hostname)) return null;
    return s;
  } catch {
    return null;
  }
}

/** `field_su_alternate_names` ("VU, Vandy") split on commas, trimmed, empty and repeated pieces dropped. */
export function splitAlternateNames(v: unknown): string[] {
  const s = str(v);
  if (!s) return [];
  const out: string[] = [];
  for (const piece of s.split(",")) {
    const t = piece.replace(/\s+/g, " ").trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** A `Member` from a page-data.json body (`result.data.nodeSchool`); null when the body has no school. Pure. */
export function memberFromPageData(slug: string, body: unknown, retrieved: string): Member | null {
  const node = (body as { result?: { data?: { nodeSchool?: Raw } } })?.result?.data?.nodeSchool;
  if (!node) return null;
  const rel = (node.relationships ?? {}) as Record<string, unknown>;
  const su = one(rel.field_site_update) ?? {};
  const mp = one(rel.field_membership_profile) ?? {};
  const ipeds = str(su.field_su_ipeds);
  const country = str(su.field_su_addr_country);
  const state = str(su.field_su_addr_state);
  const inUs = !country || /^(united states|usa?|united states of america)$/i.test(country);
  return {
    slug,
    title: str(node.title) ?? slug,
    member_id: str(node.field_member_id) ?? (typeof node.field_member_id === "number" ? String(node.field_member_id) : null),
    ipeds: ipeds && /^\d{6}$/.test(ipeds) ? ipeds : null,
    state: inUs && state && /^[A-Z]{2}$/.test(state) ? state : null,
    alternate_names: splitAlternateNames(su.field_su_alternate_names),
    aid: { need: yesNo(mp.field_mp_fac_need_fa), merit: yesNo(mp.field_mp_fac_merit_fa), international: yesNo(mp.field_mp_fac_international_fa) },
    links: {
      daca_aid: ownSiteUrl(su.field_su_addr_fy_daca),
      transfer_guarantee: ownSiteUrl(su.field_transfer_guaranteed_admiss),
      first_year_admissions: ownSiteUrl(su.field_su_addr_fy_adm_website),
      financial_aid: ownSiteUrl(su.field_su_addr_fy_finaid_website),
    },
    first_year: {
      essay: flag(su.field_su_ff_fy_per),
      test_optional: flag(su.field_su_ff_fy_tp),
      fee_waiver: flag(su.field_su_ff_fy_caf),
      self_reported_scores: flag(su.field_su_ff_fy_srs),
      recommendations_required: flag(su.field_su_ff_fy_rec_req),
    },
    retrieved,
  };
}

/** One member's record (one request). Null for a 404 or a body without a school; throws on other failures. */
export async function fetchMember(http: Pick<PoliteHttp, "get">, slug: string, retrieved: string): Promise<Member | null> {
  const url = pageDataUrl(slug);
  const res = await http.get(url, {}, { Accept: "application/json" });
  if (!res) throw new Error(`${url}: robots.txt disallows it`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return memberFromPageData(slug, await res.json(), retrieved);
}

export function readMembersFile(path: string): MembersFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as MembersFile;
}

/** The members file: header keys first, then one member per line, sorted by slug, keys in `Member`'s order. */
export function membersFileText(file: MembersFile): string {
  const members = [...file.members].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)).map(orderedMember);
  return `{\n  "retrieved": ${JSON.stringify(file.retrieved)},\n  "sitemap_url": ${JSON.stringify(file.sitemap_url)},\n  "members": [\n${members.map((m) => `    ${JSON.stringify(m)}`).join(",\n")}\n  ]\n}\n`;
}

export function writeMembersFile(path: string, file: MembersFile): void {
  writeFileSync(path, membersFileText(file));
}

/** A member with its keys in the type's order (so reruns diff cleanly). */
export function orderedMember(m: Member): Member {
  return {
    slug: m.slug,
    title: m.title,
    member_id: m.member_id,
    ipeds: m.ipeds,
    state: m.state,
    alternate_names: m.alternate_names,
    aid: { need: m.aid.need, merit: m.aid.merit, international: m.aid.international },
    links: { daca_aid: m.links.daca_aid, transfer_guarantee: m.links.transfer_guarantee, first_year_admissions: m.links.first_year_admissions, financial_aid: m.links.financial_aid },
    first_year: {
      essay: m.first_year.essay,
      test_optional: m.first_year.test_optional,
      fee_waiver: m.first_year.fee_waiver,
      self_reported_scores: m.first_year.self_reported_scores,
      recommendations_required: m.first_year.recommendations_required,
    },
    retrieved: m.retrieved,
  };
}
