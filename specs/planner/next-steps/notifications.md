# Part 6, Bringing People Back: Briefs, the Week, and the Dot

> Status: **planned** 2026-10-14. After the other parts; builds on the built reminders
> ([../timeline.md](../timeline.md#reminders): Your week, the digest's task lines, day-before texts) and the parent
> summary ([../parents.md](../parents.md#the-weekly-summary)). Part 6 of [next steps](README.md).

## Goal
The moves reach people who aren't on the site, at the cadence of the season, without a second stream of reminders:
one brief when a season turns, the week's moves in the mail that already goes out, a text the day before a hard date,
and a dot in the header when something new is waiting. Castleman and Page's lesson stands: one task, one date, one
link, a few at a time.

## Channels (all built; nothing new to wire)
| Channel | Today | With moves |
|---|---|---|
| **Your week** (Sunday email + optional text, students) | This week's tasks and the first overdue one; default on for seniors in season, off for juniors before spring | The Now list's first three moves (dated first), one line each with the why's first clause; the text trims to three titles as today. Defaults below |
| **Parent summary** (weekly email, guardians) | The summary line, Your part, stuck signals; off by default | Their part first (money, calculators, aid forms, the cost check), then the child's top three moves as read-only lines |
| **Digest** (daily, when a college's data changed) | "Coming up on your plan", at most five lines | Unchanged; a changed college whose change created or closed a move gets that move as the line |
| **Day-before text** (Mon–Sat, hard deadlines) | Application, reply, deposit | Plus the ED decide date and the ED II deadline; still one text a day, quiet hours, consent |
| **Header dot** on Plan | A deadline within 7 days | Or a move added since the person last opened the plan (`plan_opens.last_at` per viewer and student; a plain table, no notification center) |

## The season brief
One email at the turn of each season, to the student and, separately, to each guardian: the season in one sentence,
this season's moves (three to six, the playbook's order, each with its why's first clause and a link), one line on
what next season brings, and the unsubscribe. The parent's brief leads with their part. Sent by the weekly job on the
first Sunday of the season (`emails/season-brief.tsx`; `notification_prefs.season_brief`, default on where email is
on). Ten seasons from freshman year to the summer after, plus one mid-year brief in February of freshman and
sophomore year (course planning, the PSAT's result), so at most twelve briefs across high school; a late joiner gets
the current season's brief on their first Sunday.

## Cadence by season
| Season | Student | Parent |
|---|---|---|
| Freshman, sophomore | The season brief in August and the February brief (two a year); Your week **off** by default | The same two briefs, leading with the money conversation |
| Junior fall, winter | The brief; Your week **off** by default (opt in); the PSAT and test-registration day-before texts if texts are on | The brief; summary off by default |
| Junior spring, summer | The brief; Your week **on** by default (the recommenders, the essay window, the ED decide move) | The brief; summary **on** by default (the cost checks) |
| Senior fall, winter, spring | The brief; Your week on; day-before texts for every hard date | The brief; summary on; the FAFSA/CSS and deposit texts if texts are on |
| Summer after | The brief (the summer list); then nothing | The brief |

A new ED or interest pill is never an instant message; it appears in the next Your week or summary as a line
("Good ED opportunity: Wake Forest, see your plan"). `yourWeekDefault()` reads the season instead of the grade.

## Rules
- Everything the planner's shared rules say about messages holds: no personal number, no note, no outcome in a text
  or subject line; a minor's texts need a guardian's consent; one text a day; quiet hours.
- A skipped move never appears in a brief or a week; a done move appears once as done in the next week's mail, then not.
- Email is dormant until the domain's sending is set up ([../../product/follow-colleges.md](../../product/follow-colleges.md));
  texts until Twilio is registered ([../timeline.md](../timeline.md#texts)). The briefs queue in `digests` as the
  digest does, so nothing is lost before then.
- One switch per channel on the account page, as today; the season brief is its own switch under Plan reminders.
- Telemetry: `brief_sent {season, role}`, `brief_opened`, and the built week and summary events; never the content.

## Files (planned)
`lib/emails/season-brief.ts`, the weekly cron's brief step (`app/api/cron/weekly/route.ts`, the marked extension
point), `notification_prefs.season_brief`, `plan_opens`, the dot's rule in `Header.tsx` (`lib/planner/plan-frame.ts`),
`yourWeekDefault` and the parent summary reading moves (`lib/planner/reminders-server.ts`). Tests:
`tests/planner-briefs.test.mts` (one brief per season turn; the late joiner; defaults per season; a skipped move never
mails; the dot clears on open; no number in any line).

## Open questions
1. Should the brief go on the season's first day instead of the first Sunday? Recommendation: Sunday, so it lands with
   the week's mail and the job stays one.
2. Push notifications wait for the iPhone app ([../../iphone-app/README.md](../../iphone-app/README.md)); the moves are
   already the right unit for them.
