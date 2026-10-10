/**
 * Everything the preview's views show for one student, worked out from their numbers, Dream, and any groups or
 * rounds they changed: the same pure rules the Plan page will run (lib/planner/standing.ts, auto-rounds.ts,
 * rounds.ts), here in the browser so a typed score re-sorts the list at once.
 */
import type { ListRound } from "@/lib/list-rules";
import { roundsOffered } from "@/lib/planner/rounds";
import { autoRounds, edTwoSuggestion, roundProblems, type AutoRoundsSchool } from "@/lib/planner/auto-rounds";
import { balance, retakeSuggestion, scoreToMoveUp, standingFor, type Fit, type MoveUp, type RetakeSuggestion, type StandingResult, type StandingStudent, type TestKind } from "@/lib/planner/standing";
import type { PreviewDate, PreviewKid, PreviewSchool } from "./types";

export interface KidState {
  gpa: number | null;
  test: { kind: TestKind; score: number } | null;
  dream: string | null;
  /** Groups the student set themselves (otherwise the suggested one). */
  fits: Record<string, Fit>;
  /** Rounds the student set themselves (otherwise the starting round). */
  rounds: Record<string, ListRound>;
}

export interface Row {
  school: PreviewSchool;
  dream: boolean;
  standing: StandingResult;
  fit: Fit | null;
  fitAuto: boolean;
  round: ListRound;
  roundAuto: boolean;
  roundWhy: string;
  pickable: ListRound[];
  deadline: PreviewDate | null;
  decision: PreviewDate | null;
  moveUp: MoveUp | null;
}

export interface Derived {
  student: StandingStudent;
  rows: Row[];
  problems: string[];
  /** The college the ED II line suggests, if any. */
  edTwo: PreviewSchool | null;
  retake: RetakeSuggestion | null;
  balance: Record<Fit, number>;
  /** The next deadline on the list from today. */
  next: Row | null;
}

export function initialState(kid: PreviewKid): KidState {
  return { gpa: kid.gpa, test: kid.test, dream: kid.dream, fits: {}, rounds: {} };
}

export function derive(kid: PreviewKid, st: KidState, today: string): Derived {
  const student: StandingStudent = { gpa: st.gpa, test: st.test };
  const schools: Record<string, AutoRoundsSchool> = Object.fromEntries(kid.schools.map((s) => [s.id, { profile: s.profile, logistics: s.logistics, type: s.type }]));
  const items = kid.schools.map((s) => ({ id: s.id, dream: st.dream === s.id, chosen: st.rounds[s.id] ?? null }));
  const rounds = autoRounds(items, schools);
  const byId = new Map(rounds.map((r) => [r.id, r]));
  const names = Object.fromEntries(kid.schools.map((s) => [s.id, s.name]));

  const rows: Row[] = kid.schools.map((s) => {
    const standing = standingFor(student, s.standing);
    const r = byId.get(s.id)!;
    const offered = roundsOffered(schools[s.id]);
    const own = st.fits[s.id];
    return {
      school: s,
      dream: st.dream === s.id,
      standing,
      fit: own ?? standing.fit,
      fitAuto: !own,
      round: r.round,
      roundAuto: r.auto,
      roundWhy: r.why,
      pickable: offered.pickable.length > 0 ? offered.pickable : ["rd"],
      deadline: s.dates[r.round].closing,
      decision: s.dates[r.round].notification,
      moveUp: scoreToMoveUp(student, s.standing),
    };
  });

  const upcoming = rows.filter((r) => r.deadline && r.deadline.iso >= today).sort((a, b) => a.deadline!.iso.localeCompare(b.deadline!.iso));
  const edTwoId = edTwoSuggestion(items, rounds, schools);
  return {
    student,
    rows,
    problems: roundProblems(rounds, schools, names),
    edTwo: kid.schools.find((s) => s.id === edTwoId) ?? null,
    retake: retakeSuggestion(student, kid.schools.map((s) => ({ id: s.id, school: s.standing }))),
    balance: balance(rows.map((r) => r.fit)),
    next: upcoming[0] ?? null,
  };
}
