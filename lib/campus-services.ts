/**
 * Campus services and athletics (specs/data-expansion/campus-services.md): IPEDS Institutional Characteristics (IC)
 * codes, from the IC2025 data dictionary (checked 2026-09-30), and how a row becomes the stored fields. Pure: sync-data,
 * the UI, and tests share it.
 *
 * IC's checkboxes are 1 "Yes" and 0 "Implied no": the college didn't tick the box. That's weaker than a stated no, so
 * the UI says "not listed", never "No". −2 "Not applicable" (and a missing row) is null.
 */
import { CONFERENCES, FBS_INDEPENDENTS, conferenceName, type ConferenceLevel } from "./conferences.ts";
import type {
  AthleticAssociation,
  Athletics,
  CalendarSystem,
  CampusPrograms,
  DivisionFilter,
  NcaaDivision,
  RotcBranch,
  School,
  Sport,
} from "./types";

type Row = Record<string, string> | undefined;

const has = (row: Row, col: string): boolean => row?.[col] !== undefined && row[col] !== "" && row[col] !== "-2";
const yes = (row: Row, col: string) => row?.[col] === "1";

/* ------------------------------------------------------------------ labels */

export const CALENDAR_LABELS: Record<CalendarSystem, string> = {
  semester: "Semesters",
  quarter: "Quarters",
  trimester: "Trimesters",
  "4-1-4": "4-1-4 (two terms and a January term)",
  other: "Another academic-year calendar",
  varies: "Differs by program",
  continuous: "Continuous enrollment",
};

/** CALSYS 1–7. */
const CALENDAR_CODES: Record<string, CalendarSystem> = {
  "1": "semester", "2": "quarter", "3": "trimester", "4": "4-1-4", "5": "other", "6": "varies", "7": "continuous",
};

export const DIVISION_LABELS: Record<DivisionFilter, string> = {
  "I-FBS": "Division I FBS",
  "I-FCS": "Division I FCS",
  I: "Division I, no football",
  II: "Division II",
  III: "Division III",
  naia: "NAIA",
};

/** Short, for chips and the profile header. */
export const DIVISION_SHORT: Record<DivisionFilter, string> = {
  "I-FBS": "D-I FBS",
  "I-FCS": "D-I FCS",
  I: "D-I",
  II: "D-II",
  III: "D-III",
  naia: "NAIA",
};

export const ASSOCIATION_LABELS: Record<AthleticAssociation, string> = {
  ncaa: "NCAA",
  naia: "NAIA",
  njcaa: "NJCAA",
  nscaa: "NSCAA",
  nccaa: "NCCAA",
  other: "Another association",
};

export const ROTC_LABELS: Record<RotcBranch, string> = { army: "Army", navy: "Navy", air_force: "Air Force" };

export const SPORT_LABELS: Record<Sport, string> = {
  football: "football",
  basketball: "basketball",
  baseball: "baseball",
  track: "cross country/track",
};

/* ------------------------------------------------------------------ athletics */

/** ASSOC1–6 in order. */
const ASSOCIATIONS: AthleticAssociation[] = ["ncaa", "naia", "njcaa", "nscaa", "nccaa", "other"];
/** SPORT1–4 / CONFNO1–4 in order. */
const SPORTS: Sport[] = ["football", "basketball", "baseball", "track"];
/** Which sport's conference names the college's "main" conference: basketball, then track, baseball, football. */
const MAIN_ORDER = [2, 4, 3, 1];

const confOf = (row: Row, i: number): number | null => {
  const v = Number(row?.[`CONFNO${i}`]);
  return Number.isInteger(v) && v > 0 ? v : null;
};
const levelOf = (code: number | null): ConferenceLevel | null => (code === null ? null : (CONFERENCES[code]?.level ?? null));
const isDivisionOne = (l: ConferenceLevel | null) => l === "I" || l === "I-FBS" || l === "I-FCS";

/**
 * NCAA division from the conferences: the main conference sets the division (any sport's, if that one's is mixed or
 * unknown); for Division I, the football conference sets FBS vs FCS, and no football is plain "I". Only for NCAA members.
 */
export function divisionFrom(row: Row): NcaaDivision | null {
  if (!yes(row, "ASSOC1")) return null;
  const levels = MAIN_ORDER.map((i) => levelOf(confOf(row, i)));
  const level = levels.find((l) => l !== null && l !== "NAIA") ?? null;
  if (level === null) return null;
  if (level === "II" || level === "III") return level;
  const football = yes(row, "SPORT1") ? levelOf(confOf(row, 1)) : null;
  if (football === "I-FBS" || (football !== null && confOf(row, 1) === 112 && row?.UNITID && FBS_INDEPENDENTS[row.UNITID])) return "I-FBS";
  if (isDivisionOne(football)) return "I-FCS";
  return "I";
}

/** A known conference code (current or retired) for a sport, or null. */
const knownConf = (row: Row, i: number): number | null => {
  const c = yes(row, `SPORT${i}`) ? confOf(row, i) : null;
  return c !== null && conferenceName(c) !== null ? c : null;
};

/** The main conference's code: basketball's, else track's, baseball's, or football's. History stores it too. */
export const mainConferenceCode = (row: Row): number | null => MAIN_ORDER.map((i) => knownConf(row, i)).find((c) => c !== null) ?? null;

/** Football's conference code, or null without football. */
export const footballConferenceCode = (row: Row): number | null => knownConf(row, 1);

/** For history events: 1 NCAA member (including dual members), 2 NAIA only, 3 neither; null when not answered. */
export function associationCode(row: Row): 1 | 2 | 3 | null {
  if (row?.ATHASSOC !== "1" && row?.ATHASSOC !== "2") return null;
  return yes(row, "ASSOC1") ? 1 : yes(row, "ASSOC2") ? 2 : 3;
}

/** For history events: 1 offers ROTC (any branch), 2 not listed; null when not answered. */
export const rotcCode = (row: Row): 1 | 2 | null => (has(row, "SLO5") ? (yes(row, "SLO5") ? 1 : 2) : null);

export function athleticsFrom(row: Row): Athletics | null {
  // ATHASSOC: 1 member of a national association, 2 not, −2 not applicable.
  if (row?.ATHASSOC !== "1" && row?.ATHASSOC !== "2") return null;
  const associations = ASSOCIATIONS.filter((_, i) => yes(row, `ASSOC${i + 1}`));
  const sports = SPORTS.filter((_, i) => yes(row, `SPORT${i + 1}`));
  const named = (code: number | null) => (code !== null ? { code, name: conferenceName(code)! } : null);
  const mainCode = mainConferenceCode(row);
  const footballCode = footballConferenceCode(row);
  return {
    associations,
    division: divisionFrom(row),
    conference: named(mainCode),
    football_conference: footballCode !== mainCode ? named(footballCode) : null,
    sports,
  };
}

/* ------------------------------------------------------------------ programs, services, credit, calendar */

export function programsFrom(row: Row): CampusPrograms | null {
  if (!has(row, "SLO5") && !has(row, "SLO6")) return null;
  return {
    rotc: yes(row, "SLO5") ? (["army", "navy", "air_force"] as const).filter((_, i) => yes(row, ["SLO51", "SLO52", "SLO53"][i])) : [],
    study_abroad: yes(row, "SLO6"),
    // SLOA was added in IC2022.
    undergrad_research: has(row, "SLOA") ? yes(row, "SLOA") : null,
    intellectual_disability_program: yes(row, "SLOB"),
  };
}

export function servicesFrom(row: Row): NonNullable<NonNullable<School["campus"]>["services"]> | null {
  if (!has(row, "STUSRV2")) return null;
  return {
    counseling: yes(row, "STUSRV2"),
    employment: yes(row, "STUSRV3"),
    placement: yes(row, "STUSRV4"),
    child_care: yes(row, "STUSRV8"),
  };
}

export const apCreditFrom = (row: Row): boolean | null => (has(row, "CREDITS3") ? yes(row, "CREDITS3") : null);

export const calendarFrom = (row: Row): CalendarSystem | null => CALENDAR_CODES[row?.CALSYS ?? ""] ?? null;

/** DISAB 1 "3 percent or less", 2 "More than 3 percent" (then DISABPCT, in percent). */
export function disabilityFrom(row: Row): { share: number } | { three_or_less: true } | null {
  if (row?.DISAB === "1") return { three_or_less: true };
  if (row?.DISAB !== "2") return null;
  const pct = Number(row.DISABPCT);
  // Four decimals like other shares: 3.01% stays over 3%.
  return Number.isFinite(pct) && pct > 0 && pct <= 100 ? { share: Math.round(pct * 100) / 10000 } : null;
}

/* ------------------------------------------------------------------ explore filters */

export const DIVISION_FILTERS: readonly DivisionFilter[] = ["I-FBS", "I-FCS", "I", "II", "III", "naia"];
export const ROTC_BRANCHES: readonly RotcBranch[] = ["army", "navy", "air_force"];

export const isDivisionFilter = (v: string): v is DivisionFilter => (DIVISION_FILTERS as readonly string[]).includes(v);
export const isRotcBranch = (v: string): v is RotcBranch => (ROTC_BRANCHES as readonly string[]).includes(v);

/** A college's division for filtering: its NCAA division, or "naia" for an NAIA member outside the NCAA. */
export function divisionFilterOf(s: Pick<School, "campus">): DivisionFilter | null {
  const a = s.campus?.athletics;
  if (!a) return null;
  if (a.division) return a.division;
  return a.associations.includes("naia") ? "naia" : null;
}

export function matchesServices(
  s: Pick<School, "campus">,
  f: { division?: DivisionFilter[]; conference?: number; football?: boolean; rotc?: RotcBranch[]; ugResearch?: boolean; studyAbroad?: boolean }
): boolean {
  const a = s.campus?.athletics;
  const p = s.campus?.programs;
  if (f.division?.length) {
    const d = divisionFilterOf(s);
    if (!d || !f.division.includes(d)) return false;
  }
  if (f.conference !== undefined && a?.conference?.code !== f.conference && a?.football_conference?.code !== f.conference) return false;
  if (f.football && !a?.sports.includes("football")) return false;
  if (f.rotc?.length && !f.rotc.some((b) => p?.rotc.includes(b))) return false;
  if (f.ugResearch && !p?.undergrad_research) return false;
  if (f.studyAbroad && !p?.study_abroad) return false;
  return true;
}

/** "NCAA Division I FBS · Southeastern Conference", or null. */
export function athleticsLine(a: Athletics): string | null {
  const who = a.division ? `NCAA ${DIVISION_LABELS[a.division].replace(", no football", "")}` : a.associations.length ? a.associations.map((x) => ASSOCIATION_LABELS[x]).join(", ") : null;
  if (!who) return null;
  return a.conference ? `${who} · ${a.conference.name}` : who;
}
