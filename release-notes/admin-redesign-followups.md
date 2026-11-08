---
title: "The admin console speaks plainer, and its phone lists fold"
pr: 229
date: 2026-11-08
kind: improvement
summary: What the Data Steward writes now names fields in words instead of codes, deciding a policy question asks for a typed word, a finding names the check that raised it, and long lists on a phone fold after 25 cards.
---

## What's new

Nothing changes on the site for students, parents, or counselors. This release finishes the admin console's redesign
from earlier today with the four things its QA pass left for later.

**The Steward's own words.** When the Data Steward writes a finding, a proposal, a question, or a note, it used to
refer to fields by their codes ("C7", "B4–B5", "loan_no_pell"). On the console those now read as names, with the code
after the name the first time it appears, and the Steward itself has been asked to write that way from now on.

**Deciding asks you to type it.** Answering one of the Steward's policy questions now works like the console's other
consequential actions: the button stays off until you type the word.

**A finding names its check.** Where a cluster of findings used to show the identifier of the check that raised it,
it now says what the check looks for.

**Shorter scrolls on a phone.** A list with more than 25 rows shows 25 cards and a "Show the other N" control, so the
health and to-do pages no longer run tens of thousands of pixels long on a phone.

## Behind the scenes

The rewriting is a pure function over the stored text, applied where the console renders it, with the original kept
in the element's title; the Steward's system prompt gained one sentence, and the recorded dry-run answers were
re-keyed for it. The check names are a typed map, so a new check without a name fails the typecheck. The fold is in
the console's one responsive table and only below the phone breakpoint; Approve on a proposal never folds, so no
ticked row is out of sight.
