---
title: "Every high school's AP courses, by name, from College Board"
pr: 134
date: 2026-10-11
kind: data
summary: High school pages now list the AP courses College Board authorizes each school to offer, public and private, and the course picker and the rigor reading start from that list instead of a bare count.
---

## What's new

- **A named list of AP courses for every listed high school.** Each high school page's Rigor section now shows the
  AP courses on record for the school, by name: everything College Board lists the school as authorized to offer this
  year and, where we have it, everything the school's own profile lists, each course once. The federal count of AP
  courses taught stays beside it, and the ⓘ says which sources the list draws on and from what years. Private
  schools, which the federal data never covered, get this list too.
- **Your courses against your school's list.** When you add your courses, the picker opens on your own school's
  list, every course on record for it, and the reading says how many of them you've taken: "College Board lists 14 AP
  courses your school is authorized to offer," or, where we also have the school's own profile, "Your school's
  profile and College Board together list 28 AP courses."
- **Not every school is listed.** About 17,600 of the 35,000 high schools on the site are in College Board's list, 13,700
  of them with at least one AP course. A school missing from the list shows "not listed", not "offers none".
  And the list records what a school renewed with College Board that year, so a school that missed a renewal can show
  fewer courses than it teaches; we say "authorized" and keep the federal count next to it for that reason.

## Behind the scenes

- The list comes from College Board's AP Course Ledger, read once a year, slowly, through the same requests its own
  page makes. There is no download, so a new sync script fetches one state's directory at a time and then each
  school's courses, and picks up where it left off if interrupted.
- The Ledger has no federal school id, so schools are matched by name and place. A name written two ways
  ("Plano East Sr H S", "Plano East Senior High School") matches; two candidates we can't tell apart are left
  unmatched and listed for review rather than guessed.
