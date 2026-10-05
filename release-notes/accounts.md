---
title: "Accounts: keep your list, your numbers, and your family in one place"
pr: 83
date: 2026-10-05
kind: feature
summary: Sign in with an emailed link to keep a college list sorted into Reach, Target, and Likely, save your scores and GPA once, link parents and students in a household, and follow colleges to hear when their numbers change.
---

## What's new

Until now the site forgot you between visits. You can now **sign in** with a link sent to your email (no password)
and keep your work. Everything public stays free and works without an account.

**Your numbers** ([My numbers](/me)): enter your GPA (on any scale; we convert it to an unweighted 4.0), SAT or ACT
scores, intended majors, home state, and what you're looking for once, and the site uses them everywhere:
- each college's admissions page already shows where your scores land in its middle 50%;
- Compare adds a "You" row beside each college's score ranges;
- Explore gains **Fits my scores** (colleges whose middle 50% includes your score, or that don't use scores) and
  **Fits my preferences** (fills in the size, setting, state, and cost filters for you to adjust).

**Your list** ([My list](/me/list)): add colleges from any profile, Explore, or the compare tray, and sort them into
**Reach**, **Target**, and **Likely**. Track each application's round, status, and decision; keep notes (private ones
stay yours alone); see deadlines for the next 30 days, from the college's own Common Data Set where we have it. Share
a read-only link with a grandparent or coach (it shows the colleges only, never notes or decisions), export to CSV,
or print it.

**Households** ([Account → Household](/account/household)): a parent or guardian and their students can link
accounts. Guardians see each student's list and numbers; students choose whether a guardian may edit, and see who
looked at their information and when. Parents can set up a student who doesn't have an account yet and hand it over
later. Only people 13 and older can create an account.

**Follow colleges**: a Follow button on every profile and in Compare. Colleges on your list are followed
automatically. When new data is published, each profile gets a **What changed** panel that anyone can see, listing
each change with both years and its source, such as "Fall 2025: 4.2% admitted (fall 2024: 3.6%)". Update emails
summarizing changes to the colleges you follow will start once the site's email is set up; until then,
[Updates](/me/updates) shows the same information.

You can download everything we hold about you, or delete your account, from [Your account](/account).

## Behind the scenes

- Sign-in uses Supabase Auth with server-side sessions; the browser never talks to the database directly.
- Every privacy rule (who sees a student's list, private notes, follows) is enforced by the database itself with
  row-level security, and tested against a real Postgres engine, including tests that fail if a rule is removed.
- Each data publish now compares the new data with the last one and records what changed in 17 headline figures,
  ignoring tiny moves (under 0.1 point, for example). A figure whose source changed is marked as an update rather than
  a new year.
- Google sign-in and our own email sending wait for the site's new domain.
