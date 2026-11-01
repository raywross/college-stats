---
title: "The console lists every scheduled job"
pr: 209
date: 2026-11-01
kind: improvement
summary: A new Jobs section in the admin console shows every batch job the site runs, when each runs next, its schedule in plain words, and a history of past runs that opens into one run's details.
---

## What's new

The admin console has a **Jobs** section. It lists every job that runs on a schedule, from the daily update digest
to the monthly history rebuild, with where it runs, its schedule in words ("Every day at 13:00 UTC", "Monday to
Saturday at 23:00 UTC", "The 3rd of every month at 09:00 UTC"), when it will next run, and how its last run went.
Jobs a person starts by hand are listed too, so their history is one click away.

Open a job and you get its schedules with the exact cron line and the next firing of each, how to start it by hand,
and its last thirty runs. Open a run and you get what it did: for the email and text jobs, the counts it reported
and any error; for the data pipelines, each step with its outcome and how long it took, plus the change sets the run
wrote, each linking to the Data console.

## Behind the scenes

The email and text jobs on Vercel Cron now record their own runs in a `job_runs` table as they go (start, outcome,
the counts they answered with), since Vercel keeps only logs; the GitHub workflows' runs are read from GitHub through
the console's existing App. A small cron parser computes next runs and puts schedules into words, and a test holds the
console's job table to `vercel.json` and the workflows' schedule lines in both directions, so a schedule changed in
one place and not the other fails the build. The college-reported pipeline's half-hourly batch-collection firings are
hidden from its history unless asked for.
