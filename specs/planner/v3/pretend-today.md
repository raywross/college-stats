# Pretend today: walking a plan through its cycle in one sitting

Built 2026-11-05 (owner: "I can't wait 3 months or a year to make sure the planner steps are transitioning properly").

## What it is
A site setting, `planner.today` (a `YYYY-MM-DD`, or null for off), set on `/admin/settings` under **Pretend today is**.
While it's set, every plan opens as if it were that day: the season, the moves on Next steps, the grid's dates, the
calendar, the "Next:" line, the counselor's caseload rows, and the dates the plan stamps when someone acts (applied on,
decided on, committed on, withdrawn on). A banner above every plan, household person page, and caseload says
*Quad is pretending today is Monday, March 15, 2027.* with a link back to the setting.

## What it isn't
- **Never honored in production.** `overrideAllowed()` reads `VERCEL_ENV`; in production the reader returns the real
  day whatever the row says, and the settings page says so. A real family's deadlines can't be shifted by a setting.
- **Not the whole site's clock.** Scheduled jobs (the season brief, nudges, digests, the day-before reminders), the
  lists page, the account page, and the database's own rules (invitation expiry, ask limits) keep the real date. Write
  timestamps (`done_at`, `updated_at`) stay real too, so the data is honest about when it was written.
- **Not per person.** One value for the deployment; two testers on different days need two previews.

## How it works
`lib/planner/today.ts` is the pure part (`isoDay`, `overrideAllowed`, `parseTodaySetting`, `pretendTodayLine`).
`lib/planner/today-server.ts` reads the row once per request with the viewer's session (`plannerTodayOverride`,
`plannerToday`), the all-moves preview's pattern. Every planner page and Server Action that used `todayIso()` now
awaits `plannerToday()`: `lib/planner/{load,hub,store,store-plan,store-actions,store-apply,store-offers}.ts`,
`lib/essays/store.ts` (the prompts' cycle), `/api/plan/next`, the print page, the household person page, and the
`/org` pages. `tests/planner-today.test.mts` guards that list, so a `todayIso()` reintroduced there fails CI.
`admin_set_setting()` learned the key and checks the value (migration `20261105120000_planner_today.sql`).

## Using it
Set the day, open a plan, look; change the day, open it again. The user-testing personas (a senior with everything
filled, a junior, a freshman) are the subjects. A useful walk for a class-of-2027 senior: 2026-07-15 (summer before
senior year), 2026-10-01 (senior fall), 2027-01-20 (winter), 2027-04-05 (spring), 2027-07-01 (after). Clear it when
done: a tester who forgets will see the banner.
