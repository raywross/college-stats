---
title: "An admin console for Quad support"
pr: 140
date: 2026-10-12
kind: feature
summary: Quad support can now find and fix an account or household, see which colleges' data is fresh or failing, and start data reruns, and every time support looks at a student's information, the student sees it.
---

## What's new

- **Help when an account goes wrong.** Quad support can now look up an account or a household, fix a name or an email
  address, send a password reset, link a student or parent to the right household, or pause or delete an account when a
  family asks. Deleting still waits 30 days, so it can be undone.
- **You see when support looks.** If support opens a student's information, the student's "Who viewed your information"
  list says "Quad support viewed your information", just as it does when a parent looks. If support adds someone to a
  household, the household is told the next time anyone opens it.
- **Fresher college data.** Support can see which colleges have recent data and which ones the site keeps failing to
  read, and start a fresh read for a college without waiting for the next scheduled run.

## Behind the scenes

The console lives at `/admin` and only Quad's admins can open it, with a second sign-in step from an authenticator app.
Every action is recorded. The database checks admin rights on every read and change, and the sign-in operations that
need Supabase's secret key run in a separate, small function that does only those operations. College data health is
read from a compact summary the data pipelines rebuild with each update. The college pages' hidden values come next,
after the five-level estimate lands.
