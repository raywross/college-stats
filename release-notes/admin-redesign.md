---
title: "The admin console, rearranged around the Steward"
pr: 226
date: 2026-11-08
kind: improvement
summary: Quad's admin console now opens on an Inbox of what needs a person, is organized into four doors (Steward, People, Data, More), explains every panel with an info icon, uses plain words instead of code names, has the Data Steward read the outcome of every scheduled job, and works on a phone.
---

## What's new

Nothing on the site changes for students, parents, or counselors. This release is about the console Quad's admins use
to look after the data and the people on it.

**An Inbox as the front door.** The console opens on what needs a person: a change held for review, a job that failed
or looked wrong, a decision the Steward wants made, a proposal to approve, an account being deleted, an invitation
nobody answered. Each row says what it is, why it matters, and what to do, in order of urgency. Below it, what the
Steward did lately, and six tiles for how things are: the live version, the review queue, data health, the week's
jobs, the people on the site, and the Steward's spend against its budget.

**Four doors.** Steward (the Inbox, findings, proposals, to do, decisions, audits, jobs, and the Steward's own runs),
People (accounts, households, organizations), Data (colleges, health, selectivity, essays, reference documents,
changes, published versions), and More (admins, settings, the log, help). Every old address still works and lands on
the new one.

**The Steward reads every job.** Each scheduled job now declares what a good run looks like: how long it usually
takes, what it should have produced, whether it may be run again. When a job finishes, the Steward compares the run
to that and marks it fine, flagged, or failed. For a flagged or failed run it writes a one-sentence note for a person,
opens a finding, and may make one small repair from a short list: restart a job that is safe to run again (once a
day at most), ask for a publish after a change went in without one, or leave a finding on a held change. The Jobs
list shows the Steward's reading beside each job, and the Inbox lists what it flagged.

**Plain words, and help where you need it.** Snapshots are published versions, change sets are changes, issues are
findings, "Point back here" is "Make this the live version", and a field code reads "C10, class rank" rather than
"C10". Every panel has an info icon that explains what you are looking at and what you can do, and a Help page lists
every term by door. Dangerous actions (granting or revoking an admin, closing a household, pausing an account,
publishing now, approving a proposal that touches many colleges) all ask you to type a word first.

**On a phone.** A tab bar at the bottom, cards instead of sideways tables, a record's actions at the top in buttons you
can tap, and panels that fold to one line until you want them.

## Behind the scenes

Every console table renders through one component that draws a table on a wide screen and a card list on a narrow
one; a test refuses any fixed minimum width under the console. Every old route has a redirect row, and a test checks
that each old page path has one. A help key is required on every panel, also by test. The Steward's review is a pure
function over a job's declared expectations and its run record, with the six recorded cases from the spec as
fixtures; the note is the only model call, on flagged and failed runs only, at ten cents a run and three dollars a
week inside the existing cap. Fine reviews write one small document and cost nothing. Nothing needed a database
migration or a new secret.
