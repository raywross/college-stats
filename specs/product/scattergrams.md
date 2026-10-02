# Scattergrams: Outcomes From Your High School

> Status: **planned** (not built). After [high-school-data.md](high-school-data.md), [accounts.md](accounts.md), and
> [saved-lists.md](saved-lists.md); the upload side belongs with [counselor-portal.md](counselor-portal.md). Part of
> [product](README.md).

## Goal
A scattergram plots past applicants from one high school to one college by GPA and test score, marked admitted,
denied, or waitlisted. Naviance and Scoir show them inside a school's own account; families without those tools, or
with a counselor who doesn't maintain them, have nothing. Quad lets a counselor upload the school's application
history once, scrubbed of identities, and shows each student their school's dots over the college's national
ranges with their own "You" marker.

## Research (2026-10-02)
- **Scoir** exports an "Applications & Outcomes" CSV per class year with student, GPA, test scores, college name,
  app type (ED/EA/RD), deferred, waitlist, outcome, enrolling, test-optional flag, major, and comments.
  **Naviance** exports student, test score, and application history files separately, keyed by student id.
  Counselors are used to pulling five class years at a time.
- Both tools suppress scattergrams under a minimum count; Scoir's enhancements added separate outcome markers for
  deferred and waitlisted. The same k-threshold and markers here mean no surprises for counselors.
- **FERPA:** a school may share de-identified records; the counselor must have authority, and de-identification
  must consider small cells (a lone applicant to a college in a class year is identifiable to classmates). The
  threshold and binning below are the protection; the terms require the uploader to be authorized.

## Import
1. The counselor (an organization member in [counselor-portal.md](counselor-portal.md)) drops the CSV on
   `/org/scattergrams`. The browser parses it (PapaParse) and **drops identifying columns before upload**: names,
   emails, student ids, comments, majors, and anything not in the allowed list. The user sees exactly which columns
   will be sent. Nothing is sent until they confirm.
2. Allowed columns: class year, unweighted GPA (and weighted, with the school's scale from
   [high-school-data.md](high-school-data.md)), SAT total, ACT composite, college name, app type, outcome, deferred,
   waitlisted, enrolling, test-optional flag.
3. Server: match college names to `unit_id` (exact, then alias table, then a review list the counselor resolves in
   the UI); bin GPA to 0.05 and scores to 10 SAT points or 1 ACT point (removes exact-value identification); store
   rows under the organization and `ncessch`.
4. Re-uploads replace the same class years (idempotent); the counselor can delete all data at any time.

```
scattergram_points (org_id, ncessch, unit_id, class_year, gpa_bin, sat_bin, act_bin, app_type, outcome,
                    deferred, waitlisted, enrolled, test_optional, uploaded_at)
```

## Display rules
- A college's scattergram for a high school shows only when **10 or more points** exist across the last five class
  years; between 5 and 9 it shows counts only ("7 applied, 3 admitted"), under 5 nothing. The threshold is one
  constant with a test.
- No per-year breakdown under the threshold per year; the chart pools years with a "2021–2025" label.
- Points are jittered within their bin on the chart, with the admitted / denied / waitlisted / deferred markers
  Scoir users know (color plus shape, validated with the dataviz palette).
- The student's "You" marker from [student-profile.md](student-profile.md) sits on the same axes; the standing in
  [chances-and-fit.md](chances-and-fit.md) switches to local mode ("From your school, 8 of 11 applicants with your
  numbers or better were admitted") when the threshold is met.
- The national middle-50% ranges stay as bands behind the dots, so a student sees both.

## Who sees it
- Students of that high school: those who set it in their profile **and** are verified as the school's students by
  the organization (invite code or roster email match; [counselor-portal.md](counselor-portal.md#students)). Their
  guardians see what the student sees.
- The organization's members.
- Nobody else, unless the organization turns on **public aggregate** for a college: counts and admit share only,
  never dots, shown on the high school page's "Where graduates go".

## Self-reported outcomes
Students record outcomes on their own lists ([saved-lists.md](saved-lists.md#model)). With an explicit opt-in per
student ("Add my outcomes, without my name, to Quad's pooled scattergrams"), those points join a **national pool**
keyed by college, with the same bins and the same 10-point threshold, labeled "self-reported by Quad users". It is
weaker evidence than a counselor's upload (unverified, self-selected) and is drawn in a lighter style with that
label. It also serves as the panel for checking standing rules ([chances-and-fit.md](chances-and-fit.md#pilot)).

## Files (planned)
- `components/charts/Scattergram.tsx` (client; plain data in), `lib/scattergrams.ts` (binning, thresholds,
  matching; pure), `app/org/scattergrams/`, migration `…_scattergrams.sql`, alias table
  `data/reference/college-aliases.json`, `tests/scattergrams.test.mts` (column scrubbing: a fixture with a
  name column must never reach the server payload; thresholds; binning; name matching).

## Open questions
1. Should students be able to upload their own school's Naviance view (screenshots)? No: it's the school's data and
   unverifiable; self-reported outcomes cover the individual case.
2. Weighted GPA axis: only when the school's scale is known; otherwise unweighted only.
