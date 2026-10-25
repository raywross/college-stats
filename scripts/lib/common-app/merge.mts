/**
 * The Common App block on data/schools.json (specs/data-expansion/common-app.md "Store"; common-app-build/brief.md
 * "Shared contracts"): `applyCommonApp` is pure and puts each member's Requirements Grid row and Explore facts on its
 * school; `mergeCommonApp` reads the committed files (the newest data/common-app/grid/*.json and
 * data/common-app/members.json), applies them to the committed data/schools.json, refreshes the source and its two
 * vintages in meta.json, rebuilds data/aliases.json, and writes nothing unless the lineage check passes, like
 * `mergeIdentity` (scripts/lib/identity-sync.mts). `npm run merge-common-app`; `npm run sync-data` and
 * `npm run merge-reported` re-apply the block from the same files (`loadCommonApp`).
 *
 * Newest wins for the test policy (brief "Store"): the grid's policy goes into `admissions.test_policy` when the grid
 * is the newest statement, keeping the replaced block in `admissions.federal_tests.policy` exactly as
 * lib/cds/test-blocks.ts does, and citing `common-app`. Deadlines and fees are never written outside `apply.*`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, LineageRecord, School, SourceInfo } from "../../../lib/types";
import type { FieldPath } from "../../../lib/fields";
import type { GridEdition, GridRow, Member, MembersFile, SchoolApply } from "../../../lib/common-app/types";
import { GRID_POLICY, gridCycleFall } from "../../../lib/common-app/test-policy.ts";
import { applyNewestTests, restoreFederalTests } from "../../../lib/cds/test-blocks.ts";
import { lineageFall } from "../../../lib/score-bands.ts";
import { validateLineage } from "../../../lib/lineage.ts";
import { formatSchools, loadIdentityInputs } from "../identity-sync.mts";
import { buildAliasTable, formatAliasRows } from "../aliases-sync.mts";

/** The only commonapp.org URL the site may show or cite (brief "Lineage"; tests/common-app-guards.test.mts). */
export const COMMON_APP_HOME = "https://www.commonapp.org";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09-25" → "September 25, 2026". */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`common-app: "${iso}" isn't an ISO date`);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** meta.vintages["common-app-grid"]: "2026-27 cycle, updated September 25, 2026", from the edition file. */
export function gridVintage(edition: Pick<GridEdition, "cycle" | "updated">): string {
  return `${edition.cycle} cycle, updated ${longDate(edition.updated)}`;
}

/** meta.vintages["common-app-members"]: "Member pages read October 25, 2026", from members.json. */
export function membersVintage(members: Pick<MembersFile, "retrieved">): string {
  return `Member pages read ${longDate(members.retrieved)}`;
}

/** meta.sources["common-app"]: the homepage is the url (the only commonapp.org link the site may show). */
export function commonAppSource(edition: Pick<GridEdition, "cycle" | "updated">, members: Pick<MembersFile, "retrieved">): SourceInfo {
  return {
    label: "Common App",
    publisher: "Common App, Inc.",
    edition: `${edition.cycle} Requirements Grid, updated ${longDate(edition.updated)}; member pages read ${longDate(members.retrieved)}`,
    url: COMMON_APP_HOME,
    description:
      "The application more than a thousand colleges share. Its Requirements Grid lists, for each member college, the application deadlines by round, the fee and whether the Common App fee waiver is taken, the essay, writing supplement, and Courses & Grades requirements, the test policy, and the recommendations required. Each member's own Common App page adds whether it offers aid to international students, its other names, and links to its transfer guarantee and DACA aid pages. Shown only for members; read with Common App's permission.",
  };
}

/** Sets the Common App source and its two vintages, built from the files (never typed). */
export function addCommonAppMeta(meta: DatasetMeta, edition: GridEdition, members: MembersFile): void {
  meta.sources["common-app"] = commonAppSource(edition, members);
  meta.vintages["common-app-grid"] = gridVintage(edition);
  meta.vintages["common-app-members"] = membersVintage(members);
}

/* ------------------------------------------------------------------ */
/* The block                                                           */
/* ------------------------------------------------------------------ */

/** `school.apply` for a member: the grid row's values, or `common_app` alone (cycle null) and every other key null. */
export function applyBlock(member: Member, row: GridRow | null, edition: Pick<GridEdition, "cycle" | "updated">): SchoolApply {
  return {
    common_app: { member: true, member_id: member.member_id, slug: member.slug, cycle: row ? edition.cycle : null, updated: row ? edition.updated : null },
    deadlines: row ? { ...row.deadlines } : null,
    fee: row ? { ...row.fee } : null,
    fee_waiver: row ? row.fee_waiver : null,
    essay_required: row ? row.essay_required : null,
    courses_grades_required: row ? row.courses_grades_required : null,
    writing_supplement: row ? row.writing_supplement : null,
    portfolio: row ? row.portfolio : null,
    test_policy: row ? { code: row.test_policy.code, tests_used: row.test_policy.tests_used, english_tests: [...row.test_policy.english_tests] } : null,
    recommendations: row ? { ...row.recommendations } : null,
    school_type: row ? row.school_type : null,
    saves_forms: row ? row.saves_forms : null,
  };
}

/** Top-level keys later pipelines own (lib/identity.ts LATER_KEYS): a new `apply` goes right before the first of them. */
const LATER_KEYS = ["directories", "lineage", "trends", "reported"];

/** Sets `school.apply`, keeping its place when it was already there, else before LATER_KEYS (after `selectivity`). */
function placeApply(school: School, block: SchoolApply): School {
  if (school.apply) return { ...school, apply: block };
  const entries = Object.entries(school);
  let at = entries.findIndex(([k]) => LATER_KEYS.includes(k));
  if (at < 0) at = entries.length;
  return Object.fromEntries([...entries.slice(0, at), ["apply", block], ...entries.slice(at)]) as unknown as School;
}

/** The registrable part of a host: "admissions.vanderbilt.edu" → "vanderbilt.edu"; "www.aber.ac.uk" → "aber.ac.uk". */
function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  const n = parts.length >= 3 && parts.at(-1)!.length === 2 && ["ac", "co", "edu", "org", "gov"].includes(parts.at(-2)!) ? 3 : 2;
  return parts.slice(-n).join(".");
}

/**
 * A member's link when it is a web address on the college's own site (same registrable domain as `links.website`,
 * when the school has one), never a commonapp.org page; else null.
 */
export function ownSiteLink(url: string | null, website: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (baseDomain(u.hostname) === "commonapp.org") return null;
  if (website) {
    try {
      if (baseDomain(new URL(website).hostname) !== baseDomain(u.hostname)) return null;
    } catch {
      /* an unparseable homepage can't vouch for anything; keep the member's link */
    }
  }
  return u.href;
}

/* ------------------------------------------------------------------ */
/* Test policy: newest wins                                            */
/* ------------------------------------------------------------------ */

/** True when `admissions.test_policy` currently cites the grid. */
const citesGrid = (s: School) => s.lineage?.["admissions.test_policy"]?.source === "common-app";

/**
 * Takes the grid's policy back out: puts every replaced test block back (restoreFederalTests) and re-applies the
 * college's newer CDS blocks (applyNewestTests), which is exactly the state lib/reported-merge.ts leaves before the
 * grid. Lineage records that survive keep their places (the round trip alone would move every test record to the end,
 * so a re-run would reorder the file). The same object when the policy doesn't cite the grid.
 */
export function withoutGridPolicy(school: School): School {
  if (!citesGrid(school)) return school;
  const ref = applyNewestTests(restoreFederalTests(school));
  const cur = school.lineage ?? {};
  const next = ref.lineage ?? {};
  const lineage: Record<string, LineageRecord | undefined> = {};
  for (const k of Object.keys(cur)) if (k in next) lineage[k] = next[k as FieldPath];
  for (const k of Object.keys(next)) if (!(k in lineage)) lineage[k] = next[k as FieldPath];
  return Object.keys(lineage).length ? { ...ref, lineage: lineage as School["lineage"] } : ref;
}

/**
 * The as-of date of the college's CDS test policy (C8): its edition's publication date, taken as January 1 of the
 * edition's second year ("2025–26" is published during 2025–26 → 2026-01-01); null without an edition. Never the
 * record's `retrieved` date: that is when Quad read the CDS, which says nothing about which statement is newer.
 */
export function cdsPolicyAsOf(school: School): string | null {
  const rec = school.lineage?.["reported.test_policy"];
  const m = /^(\d{4})[–-](\d{2})/.exec(rec?.edition ?? "");
  return m ? `${Number(m[1]) + 1}-01-01` : null;
}

export type PolicyVerdict = "grid" | "cds-newer" | "no-cycle";

/**
 * Whether the grid's policy is the newest statement for this school (a school already without the grid's policy):
 * against a CDS policy (`reported.test_policy.policy`), the grid's entering fall must be ≥ the CDS cycle and its
 * `updated` stamp later than the CDS record's as-of date (`cdsPolicyAsOf`); with no CDS policy the grid always beats
 * the federal (or hand-imported) value.
 */
export function gridPolicyVerdict(school: School, edition: Pick<GridEdition, "cycle" | "updated">): PolicyVerdict {
  const fall = gridCycleFall(edition.cycle);
  if (fall === null) return "no-cycle";
  const rp = school.reported?.test_policy;
  if (!rp?.policy) return "grid";
  if (fall < rp.cycle) return "cds-newer";
  const asOf = cdsPolicyAsOf(school);
  return asOf === null || edition.updated > asOf ? "grid" : "cds-newer";
}

/** The lineage record on a test policy the grid supplied: the edition's vintage text, the homepage, the read date. */
export function gridPolicyRecord(edition: Pick<GridEdition, "cycle" | "updated" | "retrieved">): LineageRecord {
  return { source: "common-app", year: gridVintage(edition), url: COMMON_APP_HOME, retrieved: edition.retrieved };
}

/**
 * Writes the grid's policy into `admissions.test_policy` (the school must have `apply.test_policy`). The block it
 * replaces is kept in `admissions.federal_tests.policy` the way applyNewestTests keeps it: when a CDS policy already
 * replaced the federal one, that federal block is already kept and stays; otherwise the current value and its record
 * become the kept block, and `admissions.federal_tests` (appended last, as the CDS does) gets the record too.
 */
export function withGridPolicy(school: School, edition: Pick<GridEdition, "cycle" | "updated" | "retrieved">): School {
  const code = school.apply?.test_policy?.code;
  if (!code) return school;
  const a = school.admissions as unknown as Record<string, unknown>;
  const oldLineage = school.lineage ?? {};
  const lineage: Partial<Record<FieldPath, LineageRecord>> = { ...oldLineage };
  const kept = { ...(school.admissions.federal_tests ?? {}) };
  if (!kept.policy) {
    const prev = oldLineage["admissions.test_policy"];
    kept.policy = {
      year: prev ? lineageFall(prev.year) : null,
      ...("test_policy" in a ? { test_policy: school.admissions.test_policy } : {}),
      ...(prev ? { records: { test_policy: { ...prev } } } : {}),
    };
    if (prev && !lineage["admissions.federal_tests"]) lineage["admissions.federal_tests"] = { ...prev };
  }
  const admissions: Record<string, unknown> = { ...a, test_policy: GRID_POLICY[code] };
  delete admissions.federal_tests;
  admissions.federal_tests = kept;
  lineage["admissions.test_policy"] = gridPolicyRecord(edition);
  return { ...school, admissions: admissions as School["admissions"], lineage };
}

/* ------------------------------------------------------------------ */
/* applyCommonApp                                                      */
/* ------------------------------------------------------------------ */

export interface CommonAppSummary {
  /** Members in members.json. */
  members: number;
  /** Members with no IPEDS id on their Explore page. */
  membersWithoutIpeds: number;
  /** Members whose IPEDS id isn't a school in data/schools.json. */
  membersNotInDataset: number;
  /** Schools given `apply` (members found in the dataset). */
  applied: number;
  withGridRow: number;
  /** Members in the dataset with no grid row (transfer-only, or a name the join left unmatched). */
  withoutGridRow: number;
  /** Grid rows joined to a unit id that no member in the dataset has. */
  rowsWithoutMember: number;
  /** Stale `apply` blocks removed from schools no longer members. */
  removed: number;
  /** Schools with `aid.international_offered` set (true, false). */
  internationalAid: { yes: number; no: number };
  /** Members whose school has no `aid` block, so the answer couldn't be stored. */
  aidBlockMissing: number;
  links: { transfer_guarantee: number; daca_aid: number; offSite: number };
  /** Test policy: grid written into admissions.test_policy, CDS kept as newer, of which replaced a CDS-applied one. */
  testPolicy: { grid: number; cdsNewer: number; overCds: number };
  /** Two members claiming the same IPEDS id (the first wins) and two grid rows joined to one unit id. */
  duplicateMembers: string[];
  duplicateRows: string[];
}

/**
 * Applies the grid edition and member records to `schools` (see the file comment). Pure: returns new school objects
 * for every school it changes and the same object for the rest. `today` (ISO) guards against a stamp in the future.
 */
export function applyCommonApp(schools: readonly School[], edition: GridEdition, members: MembersFile, today: string): { schools: School[]; summary: CommonAppSummary } {
  if (edition.updated > today) throw new Error(`common-app: the grid's "Updated" stamp ${edition.updated} is after today (${today})`);
  if (gridCycleFall(edition.cycle) === null) throw new Error(`common-app: the grid's cycle "${edition.cycle}" isn't a cycle like 2026-27`);
  const ids = new Set(schools.map((s) => s.unit_id));
  const summary: CommonAppSummary = {
    members: members.members.length,
    membersWithoutIpeds: 0,
    membersNotInDataset: 0,
    applied: 0,
    withGridRow: 0,
    withoutGridRow: 0,
    rowsWithoutMember: 0,
    removed: 0,
    internationalAid: { yes: 0, no: 0 },
    aidBlockMissing: 0,
    links: { transfer_guarantee: 0, daca_aid: 0, offSite: 0 },
    testPolicy: { grid: 0, cdsNewer: 0, overCds: 0 },
    duplicateMembers: [],
    duplicateRows: [],
  };

  const memberById = new Map<string, Member>();
  for (const m of members.members) {
    if (!m.ipeds) {
      summary.membersWithoutIpeds++;
      continue;
    }
    if (!ids.has(m.ipeds)) {
      summary.membersNotInDataset++;
      continue;
    }
    if (memberById.has(m.ipeds)) summary.duplicateMembers.push(`${m.ipeds}: ${memberById.get(m.ipeds)!.slug}, ${m.slug}`);
    else memberById.set(m.ipeds, m);
  }
  const rowById = new Map<string, GridRow>();
  for (const r of edition.rows) {
    if (!r.unit_id) continue;
    if (rowById.has(r.unit_id)) summary.duplicateRows.push(`${r.unit_id}: ${rowById.get(r.unit_id)!.name}, ${r.name}`);
    else rowById.set(r.unit_id, r);
  }
  summary.rowsWithoutMember = [...rowById.keys()].filter((id) => !memberById.has(id)).length;

  const out = schools.map((original) => {
    const member = memberById.get(original.unit_id);
    if (!member) return removeStale(original, summary);
    let school = withoutGridPolicy(original);
    const row = rowById.get(school.unit_id) ?? null;
    school = placeApply(school, applyBlock(member, row, edition));
    summary.applied++;
    if (row) summary.withGridRow++;
    else summary.withoutGridRow++;

    // aid.international_offered: Yes/No from the member page; unanswered leaves the key absent.
    if (school.aid) {
      const aid = { ...school.aid };
      if (member.aid.international === null) delete aid.international_offered;
      else {
        aid.international_offered = member.aid.international;
        summary.internationalAid[member.aid.international ? "yes" : "no"]++;
      }
      school = { ...school, aid };
    } else if (member.aid.international !== null) summary.aidBlockMissing++;

    // The two links, when present and on the college's own site.
    if (school.links) {
      const links = { ...school.links };
      for (const key of ["transfer_guarantee", "daca_aid"] as const) {
        const raw = member.links[key];
        const url = ownSiteLink(raw, links.website);
        if (raw && !url) summary.links.offSite++;
        if (url) {
          links[key] = url;
          summary.links[key]++;
        } else delete links[key];
      }
      school = { ...school, links };
    }

    if (row) {
      const verdict = gridPolicyVerdict(school, edition);
      if (verdict === "grid") {
        if (school.lineage?.["admissions.test_policy"]?.source === "college-site") summary.testPolicy.overCds++;
        school = withGridPolicy(school, edition);
        summary.testPolicy.grid++;
      } else summary.testPolicy.cdsNewer++;
    }
    return sameJson(school, original) ? original : school;
  });
  return { schools: out, summary };
}

/** A school that isn't a member (any more): its `apply`, the Explore facts, and a grid-cited policy removed. */
function removeStale(original: School, summary: CommonAppSummary): School {
  let school = withoutGridPolicy(original);
  if (school.apply) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping `apply` is the point
    const { apply: _apply, ...rest } = school;
    school = rest as School;
    summary.removed++;
  }
  if (school.aid && "international_offered" in school.aid) {
    const aid = { ...school.aid };
    delete aid.international_offered;
    school = { ...school, aid };
  }
  if (school.links && ("transfer_guarantee" in school.links || "daca_aid" in school.links)) {
    const links = { ...school.links };
    delete links.transfer_guarantee;
    delete links.daca_aid;
    school = { ...school, links };
  }
  return school;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

/** The newest grid edition under `root`/data/common-app/grid (latest `updated`, then cycle), or null. */
export function readNewestEdition(root: string): GridEdition | null {
  const dir = join(root, "data", "common-app", "grid");
  if (!existsSync(dir)) return null;
  const editions = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as GridEdition);
  editions.sort((a, b) => (a.updated === b.updated ? a.cycle.localeCompare(b.cycle) : a.updated.localeCompare(b.updated)));
  return editions.at(-1) ?? null;
}

/** data/common-app/members.json under `root`, or null. */
export function readMembers(root: string): MembersFile | null {
  const path = join(root, "data", "common-app", "members.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as MembersFile) : null;
}

/** Both committed inputs, or null when either is missing (sync-data and merge-reported then skip the block). */
export function loadCommonApp(root: string): { edition: GridEdition; members: MembersFile } | null {
  const edition = readNewestEdition(root);
  const members = readMembers(root);
  return edition && members ? { edition, members } : null;
}

/** One line for the sync logs. */
export function summaryLine(s: CommonAppSummary): string {
  return (
    `${s.applied} members in the dataset (${s.withGridRow} with a grid row, ${s.withoutGridRow} without), ${s.removed} stale blocks removed; ` +
    `test policy from the grid at ${s.testPolicy.grid} (${s.testPolicy.overCds} over a CDS policy), CDS newer at ${s.testPolicy.cdsNewer}; ` +
    `international aid ${s.internationalAid.yes} yes / ${s.internationalAid.no} no; links: transfer ${s.links.transfer_guarantee}, DACA ${s.links.daca_aid}, ${s.links.offSite} off-site skipped; ` +
    `members without IPEDS id ${s.membersWithoutIpeds}, not in the dataset ${s.membersNotInDataset}`
  );
}

export interface MergeCommonAppSummary extends CommonAppSummary {
  edition: string;
  aliasRows: number;
}

/**
 * Re-applies the Common App block to `root`/data/schools.json from the newest edition file and members.json, sets
 * the source and its vintages in meta.json, and rebuilds data/aliases.json. Throws, writing nothing, when an input is
 * missing or the result fails the lineage check (with the first 30 problems).
 */
export function mergeCommonApp(root: string, opts: { dryRun?: boolean; today?: string } = {}): MergeCommonAppSummary {
  const inputs = loadCommonApp(root);
  if (!inputs) throw new Error("merge-common-app: needs data/common-app/grid/<cycle>_<updated>.json and data/common-app/members.json (npm run sync-common-app)");
  const schoolsPath = join(root, "data", "schools.json");
  const metaPath = join(root, "data", "meta.json");
  const schools: School[] = JSON.parse(readFileSync(schoolsPath, "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(metaPath, "utf8"));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const { schools: merged, summary } = applyCommonApp(schools, inputs.edition, inputs.members, today);
  addCommonAppMeta(meta, inputs.edition, inputs.members);
  const problems = validateLineage(merged, meta);
  if (problems.length) {
    const more = problems.length > 30 ? `\n  …and ${problems.length - 30} more` : "";
    throw new Error(`merge-common-app: lineage check failed (${problems.length}); nothing written:\n  ${problems.slice(0, 30).join("\n  ")}${more}`);
  }
  // Built (and checked) before anything is written, so a bad alias table also writes nothing.
  const aliasInputs = { schools: merged, hdRows: null, wikidata: loadIdentityInputs(root).wikidata, commonApp: inputs.members };
  const aliases = buildAliasTable(root, aliasInputs);
  if (!opts.dryRun) {
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    writeFileSync(schoolsPath, formatSchools(merged));
    writeFileSync(join(root, "data", "aliases.json"), formatAliasRows(aliases));
  }
  return { ...summary, edition: gridVintage(inputs.edition), aliasRows: aliases.filter((r) => r.source === "common-app").length };
}
