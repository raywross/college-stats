# Counselor Portal: Quad for Counselors

> Status: **planned** (not built). After [accounts.md](accounts.md), [saved-lists.md](saved-lists.md), and
> [commercialization.md](commercialization.md); [scattergrams.md](scattergrams.md) uploads live here. Part of
> [product](README.md).

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

## Display
- **`/org`** dashboard: caseload table (student, grad year, list size and balance, applications by status, next
  deadline, last activity), filters by grad year and status, and alerts ("3 students have no Likely college",
  "5 deadlines this week").
- **Student view** (`/org/students/{id}`): the student's pages as the counselor sees them, with a banner, and a
  notes panel (organization notes, separate from the family's).
- **Reports:** a co-branded PDF "dossier" per student (list with standing and cost ranges the family chose to
  share, offers if any, deadlines, sources page), with the organization's logo and the Quad citation footer; and a
  caseload summary PDF/CSV for the office.
- **Scattergrams:** the upload flow from [scattergrams.md](scattergrams.md#import) and a match-review queue.
- **Members and billing:** seats, invitations, Stripe Customer Portal.
- Phones: the dashboard reads as a list of student rows ([mobile.md](../mobile.md)).

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
   (e.g. 60 per seat), matching how IECs think about caseloads.
2. School-office phase: start with the two Clearinghouse-publishing states' public schools, where outcomes data is
   already public and the value is obvious.
