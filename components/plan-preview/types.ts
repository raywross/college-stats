/**
 * Shapes the design preview (/plan/preview) passes from the server page to its client views, and the colors every
 * view shares so a round looks the same on the list, the scores page, and the calendar
 * (specs/planner/redesign/calendar.md "Colors").
 */
import type { ListRound } from "@/lib/list-rules";
import type { AnyCited } from "@/lib/lineage";
import type { StandingSchool, TestKind } from "@/lib/planner/standing";
import type { AutoRoundsSchool } from "@/lib/planner/auto-rounds";

export interface PreviewDate {
  iso: string;
  cite: AnyCited;
}

export interface PreviewSchool {
  id: string;
  name: string;
  brand: unknown;
  type: string | null;
  profile: AutoRoundsSchool["profile"];
  logistics: AutoRoundsSchool["logistics"];
  standing: StandingSchool;
  cites: { sat: AnyCited | null; act: AnyCited | null; policy: AnyCited | null };
  dates: Record<ListRound, { closing: PreviewDate | null; notification: PreviewDate | null }>;
}

export interface PreviewKid {
  id: string;
  name: string;
  gradYear: number;
  /** Start year of the cycle the student applies in. */
  cycleStart: number;
  gpa: number;
  test: { kind: TestKind; score: number } | null;
  dream: string;
  schools: PreviewSchool[];
}

/** A cycle-file entry (data/application-cycle.json); `kid` null for test dates, which everyone shares. */
export interface PreviewEntry {
  id: string;
  kid: string | null;
  key: string;
  label: string;
  date: string | null;
  window: [string, string] | null;
  registerBy: string | null;
  assignee: string;
  applies: string;
  source: string;
}

/** Round colors as CSS variables (PALETTE_CSS sets the light and dark steps). */
/** The plan's colors now live in app/globals.css and lib/planner/colors.ts (the redesign's shared tokens). */
export { KID_VARS, MONEY_VAR, ROUND_VAR, STRIPED, TEST_VAR } from "@/lib/planner/colors";

export const ROUND_NAME: Record<ListRound, string> = {
  ed: "Early decision",
  ed2: "Early decision II",
  rea: "Restrictive early action",
  ea: "Early action",
  rd: "Regular decision",
  rolling: "Rolling",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
export const monthLabel = (m: number) => MONTHS[m];

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
}
