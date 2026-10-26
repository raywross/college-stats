# Counselor Portal: Quad for Counselors

> Status: **planned** (not built); **revised** 2026-10-26 after the roadmap review. After
> [commercialization.md](commercialization.md) (organization billing reuses its Stripe products). Builds on what is
> built since this was written on 2026-10-02: accounts and households with roles ([accounts.md](accounts.md),
> [household-hub.md](household-hub.md)), the planner as the student's list ([../planner/README.md](../planner/README.md)),
> the student's record ([../planner/record/README.md](../planner/record/README.md)), Quad's estimate and its levels
> ([../chances/README.md](../chances/README.md)), visit events with rep visits to high schools
> ([visit-events.md](visit-events.md)), and the admin console's people tools ([admin.md](admin.md)), whose search,
> detail, link, and unlink pages are the model for the caseload pages here. [Scattergrams](#scattergrams) are a phase
> of this spec since 2026-10-26 ([scattergrams.md](scattergrams.md) keeps their rules). Part of [product](README.md).

## Goal
An **organization** account for an independent educational consultant (IEC) or a school counseling office: a
caseload of students, each with their own Quad account and list, seen in one dashboard; the school's scattergram
data; and co-branded PDF reports for family meetings. Priced per the strategy document at $299–$599 a year by
seats. It bridges the tools counselors use for applications (Naviance, Scoir, Common App) and the cost and outcome
data Quad has.

## Research (2026-10-02)
- Scoir's institutional plans start in the thousands per month; Naviance is district-licensed. Neither sells to
  individual IECs at a small price, which is the gap the strategy document points at. IECs (roughly 10,000 in the
  US, many solo) are the first market: they have direct family consent and no district procurement.
- School counselors need district approval for any tool holding student data, and FERPA's school-official
  exception requires a contract with data-use limits. That makes school offices a second phase with a data
  processing agreement template, not a sign-up form.

## Model
```
organizations (id, name, kind: iec | school | district, ncessch nullable, plan, seats, created_by)
org_members   (org_id, user_id, role: owner | counselor, status)
org_students  (org_id, student_id, status: invited | active | ended, invited_email, consent_at)
```
- A student joins an organization's caseload by **accepting an invitation** (or their guardian accepting for a
  managed student); the organization never creates student data itself. The grant gives counselors read access to
  the student's profile, list, statuses, standing, and offers, and write access to list items and notes
  ([accounts.md](accounts.md#privacy-model)), attributed ("Added by Ms. Rivera"). **Never** the guardian's finances.
- A student can end the relationship at any time; the organization keeps nothing but its own notes.
- An organization with `kind: school` and an `ncessch` is the owner of that school's scattergram uploads.

## Students
Students verify as a school's students through the organization (an invite code or a roster email domain), which
is also what unlocks the school's scattergrams for them ([scattergrams.md](scattergrams.md#who-sees-it)).

- **A student invited by a counselor pays nothing.** The organization's plan covers its students' accounts at whatever
  tier the map in [commercialization.md](commercialization.md#feature-map) gives organization students; this is the
  acquisition pattern College Kickstart proved ([ideas/README.md](../ideas/README.md), proposal 9) and the reason the
  portal is the first paid product worth selling.
- **The student's record and plan are the student's.** A counselor reads what the grant allows and writes list items
  and notes, attributed. Nothing a counselor enters changes Quad's estimate: the estimate reads the record, and the
  record is the student's (a counselor may fix a typo in a course list with edit access, like a guardian).
- **Rep visits** ([visit-events.md](visit-events.md)): the caseload dashboard lists the colleges visiting the school's
  own campus or fairs within the radius, from the same events table, so a counseling office sees in one place what
  its students see one by one.

## Display
- **`/org`** dashboard: caseload table (student, grad year, the list's shape against the season's target
  ([../planner/next-steps/list-shape.md](../planner/next-steps/list-shape.md): "3 of 12–15, no Likely yet"),
  applications by status, next deadline, last activity), filters by grad year and status, and alerts from the same
  `shapeGaps` the plan uses ("3 students have no Likely or Safe", "5 deadlines this week"). Levels are Quad's five
  ([../chances/levels.md](../chances/levels.md)); the dashboard shows the level, never the hidden odds.
- **Student view** (`/org/students/{id}`): the student's pages as the counselor sees them, with a banner, and a
  notes panel (organization notes, separate from the family's).
- **Reports:** a co-branded PDF "dossier" per student (list with standing and cost ranges the family chose to
  share, offers if any, deadlines, sources page), with the organization's logo and the Quad citation footer; and a
  caseload summary PDF/CSV for the office.
- **Scattergrams:** the upload flow from [scattergrams.md](scattergrams.md#import) and a match-review queue.
- **Members and billing:** seats, invitations, Stripe Customer Portal.
- Phones: the dashboard reads as a list of student rows ([mobile.md](../mobile.md)).

## Scattergrams
*A phase of this spec since 2026-10-26; the rules are in [scattergrams.md](scattergrams.md).* A scattergram plots a
high school's past applicants to one college by GPA and score, marked admitted, denied, waitlisted, deferred. Naviance
and Scoir show them inside a school's own account; families whose counselor doesn't maintain them have nothing.

- **Who uploads**: an organization member, on `/org/scattergrams`, from a Scoir "Applications & Outcomes" or Naviance
  export. The browser drops every identifying column before anything is sent (names, emails, ids, comments, majors)
  and shows exactly which columns will go; the server matches college names to IPEDS ids (exact, alias table, then a
  review list the counselor resolves), bins GPA to 0.05 and scores to 10 SAT points or 1 ACT point, and stores the
  points under the organization and its `ncessch` ([scattergrams.md "Import"](scattergrams.md#import)). Re-uploads
  replace the same class years; the organization can delete everything at any time.
- **Who sees**: the school's verified students and their guardians, and the organization's members. Nobody else, unless
  the organization turns on public aggregates for a college (counts and admit share, never dots) on the high school
  page's "Where graduates go" ([scattergrams.md "Who sees it"](scattergrams.md#who-sees-it)).
- **Thresholds**: a chart at 10 or more points over the last five class years; counts only from 5 to 9; nothing under
  5; one constant with a test.
- **Beside Quad's estimate, never inside it.** On the college's admissions page and in the plan's row panel, the dots
  draw over the national ranges with the student's "You" marker, and one fact line reads from them ("From your school,
  8 of 11 applicants with your numbers or better were admitted, 2021–2025"), cited to the upload. Quad's estimate
  does not use the high school ([../chances/README.md](../chances/README.md#quads-estimate-is-proprietary)) and the
  panel says so; if that ever changes, the site says it.
- **Self-reported outcomes** are already built as [../chances/calibration.md](../chances/calibration.md) and are not
  part of this phase.
- **Phase order**: after the caseload and reports, because the uploader, the verification, and the data owner are all
  the organization. Files: `components/charts/Scattergram.tsx`, `lib/scattergrams.ts` (binning, thresholds, matching;
  pure), `app/org/scattergrams/`, a migration, `data/reference/college-aliases.json`, and the scrubbing test (a fixture
  with a name column must never reach the server payload).

## Rules
- Counselor access is a grant from the student, visible in the student's `/account` with an audit log, and
  revocable.
- Reports include only what the student (and for finances, the guardian) chose to share; the PDF renderer takes
  the same filtered data the counselor's session can read, never a wider query.
- School organizations require a signed data processing agreement before activation (a checkbox isn't enough);
  IEC organizations accept the Terms.

## Files (planned)
- `app/org/**`, `lib/orgs.ts`, `lib/pdf/` (one renderer shared with [saved-lists.md](saved-lists.md#display);
  server-side, `@react-pdf/renderer` or Playwright-to-PDF, decided when built), migration `…_organizations.sql`,
  `tests/orgs-policies.test.mts` (a counselor can't read finances; an ended student disappears; a member of
  another organization sees nothing).

## Open questions
1. Seat pricing: per counselor or per student? Recommendation: per counselor seat with a soft student cap
   (e.g. 60 per seat), matching how IECs think about caseloads. The 2026-10-03 research
   ([ideas/README.md](../ideas/README.md), proposal 8) found $299 to $599 per organization two to six times under
   College Kickstart; price per seat and revisit before launch.
2. School-office phase: start with the two Clearinghouse-publishing states' public schools, where outcomes data is
   already public and the value is obvious.
