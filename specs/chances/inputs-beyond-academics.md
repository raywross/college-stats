# Inputs Beyond the Numbers: Class Standing, Awards, Work, Legacy, Recruiting, Interest

> Status: **built** 2026-10-12 on `feature/chances` (see "As built"; planned 2026-10-11) from the owner's review. Part 11 of [admission chances](README.md). Each input here
> is small on its own; together they are what colleges say they read beyond grades, courses, and scores (CDS C7), and
> each one enters the estimate only at colleges that rate it. How each moves the level is the method's
> ([method/standing.md](method/standing.md#the-other-multipliers)). After [levels.md](levels.md); the per-college
> toggles need the list row ([../planner/redesign/list.md](../planner/redesign/list.md)).

## Goal
Collect a few more facts a student can answer in a minute, each with a clear reason on the screen, and use each only
where the college's own factor ratings say it counts. Nothing here is required; nothing here lowers a level; and every
input shows up in "what went into it" as used or "not used here: {college} doesn't weigh it".

## The commitment, rewritten
Owner decision 2026-10-11. The public commitment in [README.md](README.md#quads-estimate-is-proprietary),
[calibration.md](calibration.md#commitments-public), and [method/outcomes.md](method/outcomes.md) now reads:

> The estimate never uses race, ethnicity, sex, or religion, whatever the method. Every individual in the outcomes
> the estimate learns from is anonymized: no names, no account ids, no free text. Legacy is used only where a college
> says it weighs alumni relation and the state allows it. The student's high school is not used in this version;
> when enough outcomes exist, "how many students this college takes from your school" may be added, and the site will
> say so when it is.

The old sentence ("never legacy or high school identity") is removed everywhere it appears: the two specs above, the
product README's rules where repeated, `lib/glossary.ts`, and the Data page's accuracy section.

## Class standing
The profile has `classRankPercentile` (a number few students know). The form asks it as a pick:

| Pick | Stored `classRankPercentile` |
|---|---|
| Valedictorian or salutatorian | 1 |
| Top 5% | 5 |
| Top 10% | 10 |
| Top quarter | 25 |
| Top half | 50 |
| Lower half | 75 |
| My school doesn't rank / I don't know | null, with `classStanding: "no_rank"` so the form doesn't ask again |

- New field `academics.classStanding: "top1" | "top5" | "top10" | "top25" | "top50" | "lower" | "no_rank" | null`,
  beside the percentile (which stays for students who know the number; entering one sets the pick).
- Asked in the intake's numbers step as one optional row under GPA ("Where you stand in your class, roughly") and on
  `/me`. Reason shown: "Some colleges weigh rank, and some states guarantee admission by rank."
- Enters the estimate as the rank distance where C7 counts rank ([method](method/standing.md#the-distance-of-each-measure))
  and the guaranteed-admission checks (Texas top 5–10%, and the programs in `data/guaranteed-admission.json`).
- The pick is the student's **perceived** standing, a proxy like weighted GPA (owner, 2026-10-12; method
  [Revision 3](method/standing.md#revision-3-the-estimate-reads-the-record-the-way-the-owner-does-2026-10-12) rule 5).
  A stored `no_rank` reads as unanswered in the estimate; the pick itself leaves the form with U16.
- Without a state of residence, the estimate uses the high school's state and says so (Revision 3, rule 7).

## Awards
`StudentProfile.awards: AwardEntry[]`, at most 6:
```
AwardEntry { id: string, key: string | null, name: string, tier: 1 | 2 | 3 | 4, year: 9 | 10 | 11 | 12 | null }
```
- **Pick, don't type**: `data/reference/awards.json`, a reviewed catalog of about 40 common awards with their tier
  and the body that gives them (National Merit Finalist and Semifinalist 1; AIME qualifier 2, USAMO 1; Regeneron
  STS or ISEF finalist 1; Scholastic Art & Writing national medal 1, regional gold key 2; all-state ensemble 2;
  state champion 2; Eagle Scout, Gold Award 2; AP Scholar with Distinction 3; National Honor Society 4; school
  subject awards 3; honor roll 4; …), each with a source URL. "Something else" takes a name and the tier picker with
  the same examples as the activities form.
- Enters the estimate through the recognition tier: the highest award tier counts as the student's recognition where
  it beats the activities' ([depth.md](depth.md#the-reading)); the method uses the larger of depth and recognition.
- Sentence: "National Merit Semifinalist (national recognition) counts at colleges that rate talent or
  extracurriculars." or "Honor roll is shown for you; colleges see it on the transcript already."

## Work and family responsibilities
Entered as activities of kind `work` or `family` ([depth.md](depth.md#what-the-student-enters)) with hours a week and
years; no separate form. The Common App asks the same question, so the entry is reusable.
- Enters the estimate as `M_work` where C7 rates work experience at least *considered*: 10+ hours a week in the
  school year 1.1, 20+ hours 1.2; and as an activity in the depth reading (a four-year job is a Deep activity).
- Sentence: "Working 15 hours a week through the school year counts at colleges that weigh work experience, and it
  explains a shorter activity list."

## Legacy
A toggle on the college's row in the planner, in the drawer under a new **About you and {College}** line:
**"A parent or grandparent graduated from here"**. Stored on the list item, not the profile, because it is per college.

- `list_items.legacy boolean not null default false` (migration with the five-levels change or its own).
- Enters as `M_legacy` by the college's C7 alumni-relation rating; `1` with a sentence where no C7 or *not considered*.
- **State bans → `1`.** `data/reference/legacy-bans.json`:
  ```
  [{ "state": "CO", "sectors": ["public"],            "effective": "2021-05-25", "law": "HB21-1173", "source_url": "…" },
   { "state": "VA", "sectors": ["public"],            "effective": "2024-07-01", "law": "HB 48 / SB 46", "source_url": "…" },
   { "state": "IL", "sectors": ["public"],            "effective": "2024-08-09", "law": "HB 4260", "source_url": "…" },
   { "state": "MD", "sectors": ["public","private"],  "effective": "2024-07-01", "law": "HB 4", "source_url": "…" },
   { "state": "CA", "sectors": ["public","private"],  "effective": "2025-09-01", "law": "AB 1780", "source_url": "…" }]
  ```
  Dates and bill numbers verified against the state's legislative page when the file is written (the builder cites
  each); the file is reviewed like other reference files and extended as states act (Massachusetts, New York, and
  others have bills pending as of 2026). A college's sector is `type` (public / private non-profit / for-profit);
  a ban with `private` covers both private sectors.
- Sentences: "Legacy helps here: {College} rates alumni relation {important}." / "{College} doesn't say it weighs
  alumni relation." / "{State} bars legacy preference at {public|all} colleges, so this isn't used." The label on top
  is never "Legacy"; the level and the Elite cap stay as the method says.
- The profile's standing card, which has no list row, shows "Add {College} to your list to mark a legacy or recruiting
  connection" when neither is set.
- Privacy: the toggle is the student's (or the editing guardian's); exported and deleted with the list item; never in
  telemetry.

## Recruited athlete
A pick on the same **About you and {College}** line: **"A coach here is recruiting me"** → none · a coach has
contacted me · I've had a pre-read (and it came back positive) · I have a likely letter.
- `list_items.recruited text not null default 'none' check (recruited in ('none','contact','pre_read','likely_letter'))`.
- Enters as the method says: contact `×1.5`; pre-read and likely letter are floors ("Recruited" label). The sentence
  always says the outcome depends on the coach's support: "Recruited athletes with a coach's support are admitted at
  far higher rates; the estimate assumes that support holds. Confirm it with the coach in writing before relying on it."
- Why it's in: recruited athletes are the largest single admissions advantage the research measures (Chetty, Deming,
  and Friedman 2023: recruited athletes rise from 5% of admits in most of the income distribution to 13% at the top;
  the Harvard trial exhibits show admit rates for recruited athletes an order of magnitude above the overall rate).
  Leaving it out would make the estimate wrong for exactly the students who most need the ED advice to be right.

## Demonstrated interest
Not asked anywhere in setup (owner, 2026-10-11): it is per college and already an **action** the planner recommends
and tracks ([../planner/actions.md](../planner/actions.md): follow, request information, log a visit or interview,
shown where C7 says interest counts). One change: a logged visit, interview, or information request on a college
whose C7 rates interest *very important* or *important* gives the row `M_interest` (1.15; 1.05 at *considered*), with
the sentence "You've shown interest here, which {College} says it considers." Nothing where interest is *not
considered*.

## First generation
Collected as `academics.firstGeneration: boolean | null` on `/me` ("Neither of my parents finished a four-year
degree"), optional, with the reason "Many colleges consider it." **Not in the level** in this version: shown in "what
went into it" as "{College} rates first-generation status {considered}; it's noted, not estimated." Measured in the
first season (admitted share by first-generation among students with the same distance) before any weight is set.

## What is not collected
Essay and recommendation quality (unscorable from self-report), race, ethnicity, sex, religion (excluded by the
commitment), family income (the net-price estimator's business, never the estimate's), and the high school's
identity (reserved, as the commitment says).

## Where it shows
- `/me`: Class standing under GPA; Awards and Activities as their own sections; First generation under "About you".
- Planner: the drawer's **About you and {College}** line with the legacy toggle and the recruited pick; interest is the
  built Show interest section.
- Standing card and drawer: each input as used or "not used here" in the panel; the recruited sentence whenever set.
- Compare: no new rows.

## Measurements
Ablations `without_hooks` (legacy and recruited off together, and each separately in the internal report) and
`without_interest`; the first-generation and work cells reported descriptively. The legacy multiplier is the one most
likely to be wrong (self-report is looser than a college's definition), so the first season's report compares legacy
and non-legacy admit shares at the same distance at colleges rating alumni relation at least *considered*.

## Files (planned)
`lib/student-profile.ts` (`classStanding`, `awards`, `firstGeneration`, validation), `data/reference/awards.json`,
`data/reference/legacy-bans.json` (both registered in `lib/fields.ts` as reference sources with URLs),
`lib/chances/hooks.ts` (pure: `legacyMultiplier(school, state)`, `recruitedFloor(pick, d, tier)`, `banFor(state,
sector)`), `lib/list-rules.ts` + migration (`legacy`, `recruited`), `lib/planner/store-list.ts` (the two writes,
attributed like other edits), `components/planner/AboutYouAndCollege.tsx`, `components/me/ClassStandingPick.tsx`,
`components/me/AwardsForm.tsx`, `lib/chances/model.ts`, `lib/chances/notes.ts`, `lib/account-export.ts` (the new
columns), `tests/chances-hooks.test.mts` (every ban row, both sectors, the floors against the caps, no telemetry of
the toggles), `tests/lists-policies.test.mts` (the new columns under RLS).

## Open questions
1. Should the legacy toggle offer "parent" vs "grandparent" vs "sibling" (many colleges count only parents)?
   Recommendation: one toggle now, worded "parent or grandparent"; split if the first season shows the multiplier
   overstated.
2. Awards catalog size: start at ~40, grow from "Something else" entries that recur.

## As built (2026-10-12)
- **Profile:** class standing (under GPA, setting the percentile), activities, awards, and first generation (under an
  "About you" heading in Basics) on `/me` and the household Numbers page; the intake's optional "More about you" step
  is step 3, after AP courses. All four reach `EstimateStudent`; the account export includes them; parents see them.
- **Awards:** `data/reference/awards.json`, 40 awards, each checked against its giving body's page on 2026-10-12
  (`check:awards-catalog`). The All-National Honor Ensemble was dropped (paused by NAfME since 2023). The President's
  Volunteer Service Award is paused by AmeriCorps (since May 2025) and kept; the owner may drop it.
- **Legacy bans:** `data/reference/legacy-bans.json`, five states verified on each legislature's site on 2026-10-12
  (CA private; CO, IL, VA public; MD public and private); no other state had enacted one (Maine's bill died; New York
  and Massachusetts pending). `banFor` in `lib/chances/legacy-bans.ts` (client-safe); `check:legacy-bans`.
- **Per college:** "About you and {College}" in the planner row drawer (legacy toggle, recruited pick, the ban sentence
  where one applies); the profile's standing card asks to add the college to the list first. Interest comes from
  logged visits and info requests.
