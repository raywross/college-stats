/**
 * Council for Christian Colleges & Universities, member-school directory (specs/religious-life.md#measures item 2;
 * specs/campus-directories.md). cccu.org/members_and_affiliates/ is an Angular app whose institution table loads
 * from `GET /wp-json/imis/member-schools` (its own `members.js`: `$http.get('/wp-json/imis/member-schools')`); not
 * disallowed by robots.txt (only /wp-admin/ is). Checked 2026-10-04: 177 schools worldwide, 113 US + 3 Canada
 * "GOVM" (Governing Member, the voting membership religious-life.md's admission-factor rule means); the rest are
 * IAFF (international affiliate), AMEM (affiliate), and CPAR (corporate partner), left out.
 *
 * This is a membership fact about the college, not a campus chapter: `npm run merge-directories` reads this
 * adapter's file for `school.religion.cccu_member` (lib/cds/religion-cccu merge step) instead of the usual
 * chapter-listing table, so a CCCU member's profile never shows "CCCU" as a Christian student group.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://www.cccu.org/wp-json/imis/member-schools";
/** Full voting membership (religious-life.md: "voting members hire only faculty who profess Christian faith"). */
const VOTING_MEMBER_TYPE = "GOVM";

interface CccuSchool {
  Company?: string;
  MemberType?: string;
  City?: string;
  StateProvince?: string;
  Country?: string;
  Website?: string;
}

export function entriesFrom(schools: readonly CccuSchool[]): RawEntry[] {
  return schools
    .filter((s) => s.MemberType === VOTING_MEMBER_TYPE && s.Company && (s.Country === "United States" || s.Country === "Canada"))
    .map((s) => ({ campus: s.Company!, ...(s.City ? { city: s.City } : {}), ...(s.StateProvince ? { state: s.StateProvince } : {}), ...(s.Website ? { url: s.Website } : {}) }));
}

export default defineAdapter({
  key: "cccu",
  organization: "Council for Christian Colleges & Universities",
  publisher: "Council for Christian Colleges & Universities",
  listUrl: LIST_URL,
  tier: "D",
  domain: "faith",
  tradition: "christian",
  async crawl(ctx) {
    const schools = await ctx.fetchJson<CccuSchool[]>(LIST_URL);
    const entries = entriesFrom(schools);
    ctx.log(`${schools.length} schools worldwide, ${entries.length} US/Canada governing members`);
    return entries;
  },
});
