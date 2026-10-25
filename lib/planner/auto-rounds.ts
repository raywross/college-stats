/**
 * The round each college starts in (specs/planner/redesign/rounds.md "Starting rounds"), so the student confirms a
 * plan instead of building one. Replaces the ranking-driven proposal in rounds.ts for the redesigned Plan page; the
 * student changes any round with one tap and a changed round is theirs from then on.
 *
 * The Dream decides the one binding or restrictive round; everything else takes the free early option where the
 * college offers it. ED II is never started automatically; the Good ED opportunity pills (lib/planner/ed-opportunities.ts,
 * specs/planner/next-steps/ed-opportunities.md) replaced the ED II and "ED would help most" suggestions. Pure.
 */
import type { ListRound } from "../list-rules.ts";
import type { StandingLevel } from "../chances/types.ts";
import { isOffered, type RoundsSchool } from "./rounds.ts";

export type AutoRoundsSchool = Pick<RoundsSchool, "profile" | "logistics" | "apply"> & { type?: string | null };

export interface AutoRoundsItem {
  id: string;
  dream: boolean;
  /** A round the student set themselves (kept as is), or null to take the starting round. */
  chosen: ListRound | null;
  /** Applied or decided colleges keep whatever round they have. */
  locked?: boolean;
}

export interface AutoRound {
  id: string;
  round: ListRound;
  /** True when this is the starting round rather than one the student picked. */
  auto: boolean;
  /** One plain line, shown only behind the round chip's ⓘ. */
  why: string;
}

const offered = (s: AutoRoundsSchool | undefined, r: ListRound) => isOffered(s ?? null, r) === true;

/** The Dream's starting round at Reach, Target, Likely, or Safe: ED where offered, else restrictive EA, else EA, else regular. */
function dreamRound(s: AutoRoundsSchool | undefined): { round: ListRound; why: string } {
  if (offered(s, "ed")) return { round: "ed", why: "Your Dream offers early decision, so it starts there. ED is binding: check the cost with a parent before you apply." };
  if (offered(s, "rea")) return { round: "rea", why: "Your Dream offers restrictive early action: an early answer without a commitment, but it limits other early applications." };
  if (offered(s, "ea")) return { round: "ea", why: "Your Dream offers early action: an early answer, no commitment." };
  if (offered(s, "rolling")) return { round: "rolling", why: "Decisions roll in as applications arrive; apply early in the fall." };
  return { round: "rd", why: "The college has no early round on record, so it starts in regular decision." };
}

/**
 * The Dream's starting round at High reach (rounds.md "The ED guard" 2): never ED or REA. EA where offered, else
 * regular. Early decision helps most where the student is already in range, so it isn't offered to start here; the
 * student can still pick it from the chip.
 */
function dreamRoundHighReach(s: AutoRoundsSchool | undefined): { round: ListRound; why: string } {
  const why =
    "Early decision is binding and helps most where you're already in range; this college isn't one of them yet, so it starts in " +
    (offered(s, "ea") ? "early action" : "regular decision") +
    ". You can still pick ED from the chip.";
  if (offered(s, "ea")) return { round: "ea", why };
  if (offered(s, "rolling")) return { round: "rolling", why };
  return { round: "rd", why };
}

/** The Dream's starting round for its level (rounds.md "The ED guard" 1–2); no level (null) follows the plain rule. */
function dreamRoundFor(s: AutoRoundsSchool | undefined, level: StandingLevel | null | undefined): { round: ListRound; why: string } {
  return level === "high_reach" ? dreamRoundHighReach(s) : dreamRound(s);
}

/**
 * Starting rounds for a list. The Dream gets ED (or REA, or EA) unless its level is High reach (the ED guard: EA or
 * regular instead); every other college takes EA where offered (not where the Dream's REA forbids a private
 * college's early round), rolling where that's how it admits, else regular. No college but the Dream starts in a
 * binding round. `levels` is the estimate's group per item id (rounds.md "The ED guard"); without a level for an
 * item, the Dream follows the plain rule.
 */
export function autoRounds(items: AutoRoundsItem[], schools: Record<string, AutoRoundsSchool | undefined>, levels: Record<string, StandingLevel | null> = {}): AutoRound[] {
  const dream = items.find((i) => i.dream) ?? null;
  const dreamLevel = dream ? (levels[dream.id] ?? null) : null;
  const dreamPick = dream ? (dream.chosen ?? dreamRoundFor(schools[dream.id], dreamLevel).round) : null;
  const dreamRea = dreamPick === "rea";

  return items.map((i): AutoRound => {
    if (i.chosen || i.locked) return { id: i.id, round: i.chosen ?? "rd", auto: false, why: "You picked this round." };
    const s = schools[i.id];
    if (i.dream) return { id: i.id, auto: true, ...dreamRoundFor(s, levels[i.id] ?? null) };
    if (offered(s, "ea")) {
      if (dreamRea && s?.type !== "public") {
        return { id: i.id, round: "rd", auto: true, why: "Your Dream's restrictive early action usually rules out early action at other private colleges, so this starts in regular decision." };
      }
      return { id: i.id, round: "ea", auto: true, why: "Early action is free to use: an earlier answer and no commitment." };
    }
    if (offered(s, "rolling")) return { id: i.id, round: "rolling", auto: true, why: "Decisions roll in as applications arrive; apply early in the fall." };
    return { id: i.id, round: "rd", auto: true, why: offered(s, "ed") ? "Early decision is binding, so only your Dream starts there." : "Regular decision: the college's standard round." };
  });
}

/** Plain-language conflicts, only when they exist: two binding rounds, ED with REA, a round the college doesn't offer. */
export function roundProblems(rounds: AutoRound[], schools: Record<string, AutoRoundsSchool | undefined>, names: Record<string, string>): string[] {
  const out: string[] = [];
  const ed = rounds.filter((r) => r.round === "ed");
  const ed2 = rounds.filter((r) => r.round === "ed2");
  const rea = rounds.filter((r) => r.round === "rea");
  if (ed.length > 1) out.push(`Early decision is binding, so it can go to only one college. Pick one of ${ed.map((r) => names[r.id]).join(" and ")}.`);
  if (ed2.length > 1) out.push(`ED II is binding too: one college only. Pick one of ${ed2.map((r) => names[r.id]).join(" and ")}.`);
  if (rea.length > 1) out.push(`Restrictive early action goes to one college. Pick one of ${rea.map((r) => names[r.id]).join(" and ")}.`);
  if (ed.length > 0 && rea.length > 0) out.push(`Restrictive early action at ${names[rea[0].id]} can't be combined with early decision at ${names[ed[0].id]}.`);
  for (const r of rounds) {
    if (isOffered(schools[r.id] ?? null, r.round) === false) out.push(`${names[r.id]} doesn't offer that round. Pick another.`);
  }
  return out;
}
