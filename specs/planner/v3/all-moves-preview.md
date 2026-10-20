# All-Moves Preview

> Status: **built** 2026-10-20. A testing setting, off by default. Code: `lib/planner/all-moves.ts` (grouping),
> `lib/planner/all-moves-server.ts` (the setting), `generators/season.ts` and `generators/cycle.ts` (`input.allMoves`),
> `components/planner/NextSteps.tsx` (`AllMoves`). Tests: `tests/planner-all-moves.test.mts`.

## Why
The owner, 2026-10-20: "show all possible tasks for a student organized by the season we'd recommend. It should be off by
default, but on for now that way I can use the students I have loaded in to play with the workflow of each and refine."
[Now](now.md) shows at most three moves from the current season, so a move from another season, or one whose rule
doesn't apply to a student, can't be opened or tried without changing the student or the date.

## The setting
`PLANNER_ALL_MOVES=1` in the server's environment turns it on for every plan that server opens; unset (the default) it
is off and nothing below happens. On a local server it goes in `.env.local`; on Vercel it is an environment variable
per environment (Preview and Development share the dev database). Restart a local dev server after changing it.

## What changes with it on
- **The moves exist.** The season generator emits every [playbook](../next-steps/seasons.md) entry of every season,
  whatever its `applies`, `replaces`, or staleness says; the class-year move only for a plan without a class year. An
  entry whose title can't be filled reads in words ("Work toward your target score"). The cycle generator emits every
  entry of the student's cycle whatever it applies to and however old, except the national test dates, which stay one
  pair per date the student picked. These are real plan rows, so Done, Skip, Bring back, and each move's guide work as
  they do on the real tab.
- **The Next steps tab** shows, under the usual header, one folded section per season in calendar order (the current one
  open and marked Now): each open move as its real card, done moves with Undo, skipped moves with Bring back. A
  financial-aid move, which the real tab hides for now, carries a line saying so. Last, **When the list calls for
  them**: the rule moves (ED, interest, the list's shape, confirm, decisions, offers) this plan has no row for, since
  those exist only once their rule fires for a college on the list.
- **Not changed:** the rule moves still follow their rules; per-college tasks still come from the list. Other readers
  of the tasks (the people line's "Next:", the calendar, the weekly and season emails) see the extra rows too while it
  is on, so leave it off anywhere real families use the plan.

## Turning it off
The next open of each plan orphans the preview's extra rows (the usual merge for a task its generator no longer
wants), so they leave every view. Turning it back on brings them back with their done and skipped state.
