---
title: "Quad for counselors: run your caseload here, free"
pr: 215
date: 2026-11-02
kind: feature
summary: Counselors and independent consultants can now keep their students on Quad at no cost, with a caseload page that shows each student's record, list, deadlines, and signals, a one-tap way to ask a student for what's missing, office notes, and an export; students and parents grant the access and can end it any time.
---

## What's new

**For counselors and consultants.** Open the Caseload from your account menu (or go to `/org`) and start your
organization in one form. Students join from a link you send them or a short join code you can put on a slide, and
they sign up on the way if they don't have an account yet. Your caseload then shows, for each student, how much of
their record is filled in, how their list is shaped for the season, how many applications are in, the next deadline,
when they last did anything, and the same quiet signals a parent sees ("no Likely on the list yet"). Open a student
to see their advisor, record, and essays as they see them, leave notes your office keeps, and **ask** for what's
missing: "Ms. Rivera asked you to add your SAT score" lands in the student's advisor and inbox, and closes itself when
the score is there. Export the caseload as a CSV for Naviance, Scoir, or a spreadsheet. All of it is free, with
nothing to sign first.

**For students and parents.** A counselor sees your information only because you let them: you join their caseload
from their link or code, and the page tells you exactly what they'll see (your record, your list and advisor, your
essays) and what they never will (a parent's finances). Every time they look, it shows in your account's access log,
as it does for a parent. Switch them to view-only or end their access any time from Your counselors on the account
page. Parents see a child's counselors on the child's page in the household and can end that access too.

**Nothing about money changes.** Counselors see a quiet "Preview" chip on each student, and that's all; Quad never asks
a counselor to sell anything.

## Behind the scenes

A counselor is a third kind of viewer beside the student and the guardian. The grant lives in a new `org_students`
table, and the two functions that every student-data policy already asks (`can_read_student`, `can_edit_student`)
gained a counselor clause, so lists, the plan's tables, the record, offers, and essays opened to counselors without a
change to their own policies; the policy tests prove a counselor reads zero rows of finances, private notes, or a
parent's nudges, and nothing after a grant ends. The viewer relation was audited across the planner, the record, and
the essays so "not the student" covers a counselor while parent-only tools (nudges, Your part, the money column) stay
parent-only; one leak found on the way (the story's text was redacted only for guardians) is closed. The caseload
computes every row with the planner's own pure functions over data the counselor could open one student at a time,
and never runs Quad's estimate. The scattergram upload, the portal's last phase, is its own roadmap item again, and is
where the data processing agreement for schools now belongs.
