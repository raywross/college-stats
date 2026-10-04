---
title: "College data agent: a fix from its first live run"
pr: 63
date: 2026-10-03
kind: fix
summary: "The agent that reads colleges' own reports stopped partway through its first live run because of a cost-tracking mismatch; it now runs through, still refusing any model it can't price."
---

## What's new

Nothing changes on the site itself. The agent that collects newer figures from colleges' Common Data Sets stopped
partway through its first live run on ten new colleges. It stopped on purpose: it refuses to keep going when it
can't price a model's work, so its spending cap is never blind. The cause was a naming mismatch, now fixed, so the
next run goes all the way through.

## Behind the scenes

- Message Batches results name the dated model snapshot (`claude-haiku-4-5-20251001`) while requests name the alias.
  Prices are now looked up by the alias when an id ends in a date; any other unknown model still stops the run.
- Guessed institutional-research hosts that don't exist are now logged as "didn't respond", once per host, instead
  of as robots.txt refusals. What the agent fetches is unchanged.
