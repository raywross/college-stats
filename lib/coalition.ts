/**
 * The Coalition application (specs/data-expansion/coalition-app.md): the shapes of data/coalition/members.json and of
 * the block a member carries (`school.coalition`), and the one sentence the site says about it. Pure and client-safe;
 * the readers and the merge live in scripts/lib/coalition/.
 */
import type { School } from "./types.ts";

export const COALITION_HOME = "https://www.coalitionforcollegeaccess.org";
export const COALITION_MEMBERS_URL = `${COALITION_HOME}/our-members`;
export const SCOIR_LIST_URL = "https://www.scoir.com/apply-colleges";

/** How a name on one of the lists was joined to a college. */
export type CoalitionJoinRule = "name" | "normalized" | "alias" | "domain" | "name-map";

export interface CoalitionMember {
  /** The name as the Coalition's page prints it. */
  name: string;
  /** The admissions page the Coalition links for it (its own site); used to join by domain, never shown. */
  admissions_url: string | null;
  /** The site's college, or null when no rule joined the name (then it is also in `unmatched`). */
  unit_id: string | null;
  join: CoalitionJoinRule | null;
  /** On Scoir's list of colleges taking applications through it (the Coalition form). */
  via_scoir: boolean;
}

export interface CoalitionUnmatched {
  name: string;
  list: "coalition" | "scoir";
  tried: CoalitionJoinRule[];
}

export interface CoalitionFile {
  /** The day both pages were read (ISO date). */
  retrieved: string;
  member_url: string;
  scoir_url: string;
  members: CoalitionMember[];
  scoir: {
    /** The "As of" date Scoir prints (ISO), or null when the page shows none. */
    as_of: string | null;
    /** Scoir's names as printed, with the unit id each joined to (null when none). */
    names: { name: string; unit_id: string | null; join: CoalitionJoinRule | null }[];
    /** Scoir names that joined a college the Coalition's list doesn't carry: for a person to look at; stored nowhere. */
    not_members: { name: string; unit_id: string }[];
  };
  unmatched: CoalitionUnmatched[];
}

/** `school.coalition`: present only on a member (specs/data-expansion/coalition-app.md "Store"). */
export interface SchoolCoalition {
  member: true;
  via_scoir: boolean;
  retrieved: string;
}

/**
 * The sentence a college's page and the planner say (coalition-app.md "Display"): only for a college on Scoir's list,
 * since membership alone tells an applicant nothing. Inside the "What it takes to apply" card (a Common App member
 * with a grid row, `apply.deadlines`) the sentence is "Also takes…"; on its own it is "Takes…".
 */
export function coalitionSentence(school: Pick<School, "coalition" | "apply">): string | null {
  if (!school.coalition?.via_scoir) return null;
  return school.apply?.deadlines ? "Also takes the Coalition application, through Scoir." : "Takes the Coalition application, through Scoir.";
}
