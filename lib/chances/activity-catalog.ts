/**
 * The activity catalogs a student picks from instead of typing a name (specs/chances/inputs-beyond-academics.md,
 * depth.md "What the student enters", Wave 4 U12): data/reference/sports.json, data/reference/clubs.json, and
 * data/reference/activity-roles.json (the titles per kind, each mapped to the `ActivityRole` tier the model reads).
 * Read by `components/me/ActivitiesForm.tsx`'s autocomplete (the same pattern as the AP course picker,
 * lib/chances/catalog.ts) and `ActivityEntry.catalogKey`/`family`/`titles`. Checked by
 * scripts/check-activity-catalogs.mts in `npm run verify`. Pure and client-safe (no server or browser APIs).
 */
import sportsFile from "../../data/reference/sports.json" with { type: "json" };
import clubsFile from "../../data/reference/clubs.json" with { type: "json" };
import rolesFile from "../../data/reference/activity-roles.json" with { type: "json" };
import type { ActivityFamily, ActivityKind, ActivityRole } from "./types.ts";

export interface CatalogActivity {
  /** Stable id (`ActivityEntry.catalogKey`). */
  key: string;
  /** As shown in the picker. */
  name: string;
  /** Short forms and acronyms students actually type ("XC", "DECA" is itself an acronym so may be empty). */
  aliases: string[];
  kind: ActivityKind;
  family: ActivityFamily;
  /** The organization that runs or governs it, or null for a common school-level type with no national umbrella. */
  org: string | null;
  /** The organization's own page; null exactly when `org` is null. */
  source_url: string | null;
}

export interface ActivityCatalogFile {
  retrieved: string;
  editorial: string;
}

export interface SportsFile extends ActivityCatalogFile {
  sports: CatalogActivity[];
}

export interface ClubsFile extends ActivityCatalogFile {
  clubs: CatalogActivity[];
}

export const SPORTS_FILE = sportsFile as SportsFile;
export const CLUBS_FILE = clubsFile as ClubsFile;

/** Every sport in the catalog, in file order. */
export const SPORTS: readonly CatalogActivity[] = SPORTS_FILE.sports;
/** Every club/arts/service/research entry in the catalog, in file order. */
export const CLUBS: readonly CatalogActivity[] = CLUBS_FILE.clubs;

const BY_KEY = new Map<string, CatalogActivity>([...SPORTS, ...CLUBS].map((a) => [a.key, a]));

/** One catalog entry (sport or club) by key, or null when it isn't in either catalog (an old key since dropped). */
export function activityByKey(key: string | null | undefined): CatalogActivity | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Rank tiers, highest first: an exact alias match beats a name-prefix match beats an alias-prefix match beats "found somewhere". */
function score(a: CatalogActivity, q: string): number | null {
  const name = normalize(a.name);
  const aliases = a.aliases.map(normalize);
  if (aliases.includes(q)) return 4;
  if (name.startsWith(q)) return 3;
  if (aliases.some((al) => al.startsWith(q))) return 2;
  if (name.includes(q) || aliases.some((al) => al.includes(q))) return 1;
  return null;
}

/**
 * Activities whose name or alias/acronym matches `query`, best match first ("DE" finds DECA by name-prefix, "xc"
 * finds Cross Country by alias-prefix); ties keep the catalog's own order. "sport" searches data/reference/sports.json,
 * "club" searches data/reference/clubs.json (which covers the club/arts/service/research kinds); "work" and "other"
 * have no catalog (free text), so they always return an empty list. An empty or whitespace-only query matches nothing.
 */
export function searchActivities(kind: "sport" | "club" | "work" | "other", query: string, limit = 8): CatalogActivity[] {
  const q = normalize(query);
  if (!q) return [];
  const pool = kind === "sport" ? SPORTS : kind === "club" ? CLUBS : [];
  return pool
    .map((a) => ({ a, s: score(a, q) }))
    .filter((r): r is { a: CatalogActivity; s: number } => r.s !== null)
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map((r) => r.a);
}

/* ------------------------------------------------------------------ */
/* Titles → role tiers (data/reference/activity-roles.json)           */
/* ------------------------------------------------------------------ */

export interface ActivityRoleRow {
  kind: ActivityKind;
  title: string;
  role: ActivityRole;
}

export interface ActivityRolesFile {
  retrieved: string;
  editorial: string;
  roles: ActivityRoleRow[];
}

export const ACTIVITY_ROLES = rolesFile as ActivityRolesFile;

/** The titles offered for an activity kind, in file order (the picker's list for that kind's year chips). */
export function titlesFor(kind: ActivityKind): { title: string; role: ActivityRole }[] {
  return ACTIVITY_ROLES.roles.filter((r) => r.kind === kind).map(({ title, role }) => ({ title, role }));
}

/** The role tier a picked title maps to; "member" (the safe default: a checked year with no role is member) when the kind/title pair isn't in the file. */
export function roleForTitle(kind: ActivityKind, title: string): ActivityRole {
  return ACTIVITY_ROLES.roles.find((r) => r.kind === kind && r.title === title)?.role ?? "member";
}

/* ------------------------------------------------------------------ */
/* Validation (scripts/check-activity-catalogs.mts, `npm run verify`) */
/* ------------------------------------------------------------------ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-z][a-z0-9_]{1,60}$/;
const ACTIVITY_KINDS: readonly ActivityKind[] = ["sport", "club", "arts", "service", "work", "research", "family", "other"];
const ACTIVITY_FAMILIES: readonly ActivityFamily[] = [
  "english", "math", "science", "history", "language", "cs", "arts",
  "business", "health", "engineering", "service", "athletics", "leadership", "media", "faith", "other",
];
const ACTIVITY_ROLE_VALUES: readonly ActivityRole[] = ["member", "officer", "leader"];

function isHttps(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** Problems with one catalog file (sports or clubs), one line each (empty means sound). */
export function validateActivityCatalog(input: unknown, name: string, allowedKinds: readonly ActivityKind[], listKey: string): string[] {
  const errors: string[] = [];
  const f = input as Record<string, unknown>;
  const list = f ? f[listKey] : undefined;
  if (!f || typeof f !== "object" || !Array.isArray(list)) return [`${name}: "${listKey}" must be an array`];
  if (typeof f.retrieved !== "string" || !ISO.test(f.retrieved)) errors.push(`${name}: retrieved must be yyyy-mm-dd`);
  if (typeof f.editorial !== "string" || !(f.editorial as string).trim()) errors.push(`${name}: "editorial" must say the entries are reviewed`);
  const seen = new Set<string>();
  (list as CatalogActivity[]).forEach((a, i) => {
    const where = `${name}[${i}] ${a && typeof a.key === "string" ? a.key : "(no key)"}`;
    if (!a || typeof a !== "object") {
      errors.push(`${where}: not an object`);
      return;
    }
    if (typeof a.key !== "string" || !KEY_RE.test(a.key)) errors.push(`${where}: key must be lowercase letters, digits, underscores`);
    else if (seen.has(a.key)) errors.push(`${where}: key listed twice`);
    else seen.add(a.key);
    if (typeof a.name !== "string" || !a.name.trim()) errors.push(`${where}: name is required`);
    if (!Array.isArray(a.aliases) || a.aliases.some((al) => typeof al !== "string" || !al.trim())) errors.push(`${where}: aliases must be a list of non-empty strings`);
    if (!allowedKinds.includes(a.kind)) errors.push(`${where}: kind must be one of ${allowedKinds.join(", ")}`);
    if (!ACTIVITY_FAMILIES.includes(a.family)) errors.push(`${where}: family isn't a known ActivityFamily`);
    if (a.org !== null && (typeof a.org !== "string" || !a.org.trim())) errors.push(`${where}: org must be a non-empty string or null`);
    if (a.source_url !== null && !isHttps(a.source_url)) errors.push(`${where}: source_url must be an https url or null`);
    if ((a.org === null) !== (a.source_url === null)) errors.push(`${where}: org and source_url must both be set or both be null`);
  });
  return errors;
}

/** Problems with data/reference/activity-roles.json: every kind covered, unique (kind, title) pairs, a known role. */
export function validateActivityRoles(input: unknown): string[] {
  const errors: string[] = [];
  const f = input as ActivityRolesFile;
  if (!f || typeof f !== "object" || !Array.isArray(f.roles)) return ['activity-roles.json: "roles" must be an array'];
  if (typeof f.retrieved !== "string" || !ISO.test(f.retrieved)) errors.push("activity-roles.json: retrieved must be yyyy-mm-dd");
  if (typeof f.editorial !== "string" || !f.editorial.trim()) errors.push('activity-roles.json: "editorial" must say how titles map to roles');
  const seen = new Set<string>();
  const kindsSeen = new Set<ActivityKind>();
  f.roles.forEach((r, i) => {
    const where = `activity-roles.json[${i}]`;
    if (!r || typeof r !== "object") {
      errors.push(`${where}: not an object`);
      return;
    }
    if (!ACTIVITY_KINDS.includes(r.kind)) errors.push(`${where}: kind must be a known ActivityKind`);
    else kindsSeen.add(r.kind);
    if (typeof r.title !== "string" || !r.title.trim()) errors.push(`${where}: title is required`);
    const pairKey = `${r.kind}::${r.title}`;
    if (seen.has(pairKey)) errors.push(`${where}: ${r.kind}/${r.title} listed twice`);
    else seen.add(pairKey);
    if (!ACTIVITY_ROLE_VALUES.includes(r.role)) errors.push(`${where}: role must be member, officer, or leader`);
  });
  for (const k of ACTIVITY_KINDS) if (!kindsSeen.has(k)) errors.push(`activity-roles.json: no titles for kind "${k}"`);
  return errors;
}

/** All three files together, for the check script. */
export function validateActivityCatalogs(sports: unknown, clubs: unknown, roles: unknown): string[] {
  return [
    ...validateActivityCatalog(sports, "sports.json", ["sport"], "sports"),
    ...validateActivityCatalog(clubs, "clubs.json", ["club", "arts", "service", "research", "other"], "clubs"),
    ...validateActivityRoles(roles),
  ];
}
