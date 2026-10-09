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
export const ROUND_VAR: Record<ListRound, string> = {
  ed: "var(--pv-ed)",
  ed2: "var(--pv-ed2)",
  rea: "var(--pv-rea)",
  ea: "var(--pv-ea)",
  rd: "var(--pv-rd)",
  rolling: "var(--pv-rolling)",
};
export const TEST_VAR = "var(--pv-test)";
export const MONEY_VAR = "var(--pv-money)";
export const KID_VARS = ["var(--pv-kid-1)", "var(--pv-kid-2)", "var(--pv-kid-3)"];

/**
 * Rounds take the reference palette's first three slots, the only three that stay apart for every reader in both
 * modes (validated all-pairs): regular blue, early decision orange, early action aqua. ED II and REA reuse their
 * family's color with a stripe, and every bar carries its round's short name, so color is never the only cue. Tests
 * (violet) and money (green) live in their own labeled lanes with their own marker shapes.
 */
export const PALETTE_CSS = `
.pv{--pv-ed:#eb6834;--pv-ed2:#eb6834;--pv-rea:#1baf7a;--pv-ea:#1baf7a;--pv-rd:#2a78d6;--pv-rolling:#2a78d6;--pv-test:#4a3aa7;--pv-money:#008300;--pv-kid-1:#2a78d6;--pv-kid-2:#eb6834;--pv-kid-3:#1baf7a}
.dark .pv{--pv-ed:#d95926;--pv-ed2:#d95926;--pv-rea:#199e70;--pv-ea:#199e70;--pv-rd:#3987e5;--pv-rolling:#3987e5;--pv-test:#9085e9;--pv-money:#008300;--pv-kid-1:#3987e5;--pv-kid-2:#d95926;--pv-kid-3:#199e70}
`;

/** Rounds drawn striped: the second binding round and the restrictive one. */
export const STRIPED: ReadonlySet<ListRound> = new Set<ListRound>(["ed2", "rea"]);

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
