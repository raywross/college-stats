---
title: A plan for the household page, one list per person, and an application plan
pr: 93
date: 2026-10-06
kind: plans
summary: Two plans from the first weeks with accounts: a household page where everyone appears by name with one list each, and a plan of steps and dates for every college on that list.
---

## What's planned

**The household page becomes the family's home base.** Adding someone starts with one question, parent or student,
and then asks only what that role needs: a parent's name and email (phone optional); a student's name, with email,
phone, and graduation year optional. A parent who gets the link just chooses a password; there is no separate
sign-up or confirmation email. Everyone shows up by name, in the header and in the household, and someone who hasn't
finished joining sits in the same list marked "Invited", with the link right there to copy or send again.

**One list, for everyone.** "My list" and "Following" were two names for the same thing, so they become one list,
and parents get one of their own alongside their students'. On each college you switch on or off: updates when its
numbers change (on by default), applying, visited, following on social media, and accepted. Clicking a person in the
household opens their list and, for a student, their numbers.

**Then, a plan.** A second spec turns the list into a plan: for each college, the steps worth taking (decide the
round, visit, follow the admissions office, aid forms, apply, reply) and the dates the college itself published,
grouped by month with the next one on top. A parent can see how it's going at a glance. Nudges come in the same
email as data updates.

## Behind the scenes

The specs are `specs/product/household-hub.md` and `specs/product/application-plan.md`, both on the roadmap under
"Accounts and households". The hub spec leaves four decisions to the owner: Supabase's secret key on Vercel for the
invite-to-password flow, storing pending invitation tokens in clear so Copy link works, whether a parent's list is
visible to the household, and collecting phone numbers before anything uses them.
