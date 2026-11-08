---
title: "The scheduled jobs run again"
pr: 219
date: 2026-11-08
kind: infra
summary: The site's daily and weekly jobs (update digests, visit alerts, interest confirmations, the Sunday emails) had been stopping before they could do anything because one server setting was blank; it is filled in, production is rebuilt, and a small script now copies such settings into place so this can't quietly happen again.
---

## What changed

The jobs that send the update digests, the visit alerts, the interest confirmations, and the Sunday "your week"
emails are scheduled by the hosting platform and run every day. Since they were set up, every run had ended at once:
the setting that lets a job read and write the database on the server was present but empty, so each job answered
"not configured" and left no record of itself. The admin console's Jobs page therefore showed them all as never run,
and the line "does nothing until email sending is configured" on each job's page made it look like email was the
missing piece. Email had been set up for weeks.

The setting is now filled in for production and preview deployments, and production has been rebuilt so the running
site sees it. The next scheduled runs will leave their records on the Jobs page.

## Behind the scenes

A new script, `npm run vercel-env -- NAME`, copies a named value from the developer's local environment file to the
hosting project's settings, reads the project's settings back to confirm which environments carry it, and with
`--redeploy` rebuilds the current production deployment, which a new value needs before it takes effect. The value is
read from the environment and sent in a request body, so it never appears on a command line or in a transcript. The
hosting notes in the Supabase spec now say which settings live on the hosting side and what an empty one does.
