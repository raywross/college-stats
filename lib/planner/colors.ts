/**
 * The plan's colors (specs/planner/redesign/calendar.md "Colors", list.md "The row"), as CSS variables set in
 * app/globals.css for light and dark: one color per application round (the list's round chip, the calendar's bars,
 * the Next-up diamond), tests, money, and up to three children. Pure constants, safe anywhere.
 *
 * Rounds take the reference palette's first three slots, the only three that stay apart for every reader in both
 * themes (validated all-pairs): regular blue, early decision orange, early action aqua. ED II and REA reuse their
 * family's color drawn striped (STRIPED), and every mark carries its round's short name, so color is never the only
 * cue. Tests (violet) and money (green) live in their own labeled lanes with their own shapes. The group chips
 * (Reach / Target / Likely) deliberately use other hues, so a group never looks like a round, and calm tints so a
 * Reach never looks like a warning.
 */
import type { ListCategory, ListRound } from "../list-rules.ts";

export const ROUND_VAR: Record<ListRound, string> = {
  ed: "var(--round-ed)",
  ed2: "var(--round-ed2)",
  ea: "var(--round-ea)",
  rea: "var(--round-rea)",
  rd: "var(--round-rd)",
  rolling: "var(--round-rolling)",
};

/** Rounds drawn striped: the second binding round and the restrictive one. */
export const STRIPED: ReadonlySet<ListRound> = new Set<ListRound>(["ed2", "rea"]);

export const TEST_VAR = "var(--plan-test)";
export const MONEY_VAR = "var(--plan-money)";
/** Children in the order they were added (color slot 0, 1, 2). */
export const KID_VARS = ["var(--kid-1)", "var(--kid-2)", "var(--kid-3)"] as const;

/** Group chip classes: tinted backgrounds with dark text (light), deep tints with light text (dark). */
export const GROUP_CLASS: Record<ListCategory, string> = {
  reach: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  target: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  likely: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  unsorted: "bg-muted text-muted-foreground",
};
