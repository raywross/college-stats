---
title: Creating an account asks who you are, then only what that needs
pr: 252
date: 2026-11-14
kind: improvement
summary: Sign-up starts with one question, student, parent, or counselor, then asks only what fits: a student's birth year and high school, a parent's home address, nothing more for a counselor, and the card step for a student comes right after, as part of signing up.
---

## What's new

- **One question first.** Create an account opens on three cards: a student, a parent or guardian, a counselor. The
  rest of the form follows from your answer.
- **Everyone** gives a full name, an email, and a password.
- **A student** gives a birth year (accounts are for people 13 and older) and can pick their high school from the
  directory as they type, or skip it and add it later from their record.
- **A parent or guardian** can give the home address, so distances to colleges and visits near you work from the
  first day; a ZIP code is enough, and it's optional. A household is made for you, named after you.
- **A counselor** gives nothing more and lands in the portal.
- **No birth year for adults.** Parents and counselors aren't asked for one, and the account page no longer prompts
  them to add it.
- **The card is part of signing up.** Once Quad Advisor's price is live, a new student goes straight from creating the
  account to putting a card on file, with the trial's end date and the price stated plainly, then to the advisor. No
  surprise after the email link.

## Behind the scenes

The sign-up action checks the same rules the form shows, by role. What the form collects beyond the profile's own
fields rides in the account's metadata until a new `/welcome` step, the first signed-in page, applies it (the high
school into the student's profile, the address into the new household), clears it, and sends the person on; the step
runs the same way whether the account was confirmed by email or signed in at once.
