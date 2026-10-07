---
title: Your household, by name, with one list each
pr: 95
date: 2026-10-06
kind: feature
summary: The household page is now the family's home base: add a parent or a student by name, see everyone by name, open each person's list and numbers, and switch updates on or off per college instead of following.
---

## What's new

**Add someone in two steps.** On your household page, say whether you're adding a parent or a student, then fill in
only what that role needs: a parent's name and email (phone optional); a student's name, with email, phone, and
graduation year optional. A student without an email is added right away and you can start their list; with an email,
they get a link that makes the list theirs.

**Everyone by name.** The person you added shows up in the household at once, by name, with "Invited" until they
finish joining, and the link to copy or send again sits right there on their row. The avatar in the header uses the
first letter of your first name, never your email address.

**Set a password, nothing else.** Someone you invite opens the link and chooses a password. No separate sign-up, no
confirmation email.

**One list, for everyone.** "My list" and "Following" are now one thing. Each person in the household, parents
included, has a list, and each college on it has five switches: Updates (on by default: an email when its numbers
change), Applying, Visited, Following on social, and Accepted. Click a person in the household to open their list and,
for a student, their numbers. The old addresses still work and take you to the right place.

## Behind the scenes

The spec is `specs/product/household-hub.md`; a follow-on plan, `specs/product/application-plan.md`, turns the list
into steps and dates. Invited accounts are created by a small function that runs inside Supabase, so the project's
secret key never leaves it. Follows are now kept by the database from the list's Updates switch; the old Follow button
and its page are gone.
