/**
 * Conference moves as the conference pages read them (specs/trends/conferences.md rule 6): the moves come from
 * conferences.json, which took them from lib/events.ts `conferenceMoves` with its reporting-fix rules.
 */
import { conferenceName, isLeague } from "@/lib/conferences";
import type { ConferencesFile } from "@/lib/trends";

export interface Move {
  year: number;
  unit_id: string;
  from: number;
  to: number;
  football: boolean;
}

/** "the Pac-12" style name for a sentence; "independent" codes read as such. */
export function leagueName(code: number): string {
  const n = conferenceName(code) ?? `conference ${code}`;
  return isLeague(code) ? `the ${n.replace(/^The /, "")}` : /independent/i.test(n) ? "independent status" : n;
}

/** Every move in the file, once each (a move appears under both conferences). */
export function allMoves(file: ConferencesFile): Move[] {
  const seen = new Map<string, Move>();
  for (const c of file.conferences) {
    for (const m of c.moves) {
      const mv: Move = m.joined ? { year: m.year, unit_id: m.unit_id, from: m.other, to: c.code, football: m.football } : { year: m.year, unit_id: m.unit_id, from: c.code, to: m.other, football: m.football };
      seen.set(`${mv.year}:${mv.unit_id}:${mv.from}:${mv.to}:${mv.football}`, mv);
    }
  }
  return [...seen.values()].sort((a, b) => b.year - a.year || a.to - b.to || a.unit_id.localeCompare(b.unit_id));
}

/** One line of a conference's timeline: who joined from (or left for) one other conference in one year. */
export interface MoveGroup {
  year: number;
  joined: boolean;
  other: number;
  football: boolean;
  ids: string[];
}

/** A conference's moves grouped by year, direction, and the other conference, newest first. */
export function groupMoves(moves: ConferencesFile["conferences"][number]["moves"]): MoveGroup[] {
  const groups = new Map<string, MoveGroup>();
  for (const m of moves) {
    const key = `${m.year}:${m.joined}:${m.other}:${m.football}`;
    const g = groups.get(key) ?? { year: m.year, joined: m.joined, other: m.other, football: m.football, ids: [] };
    g.ids.push(m.unit_id);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.year - a.year || Number(b.joined) - Number(a.joined) || b.ids.length - a.ids.length);
}
