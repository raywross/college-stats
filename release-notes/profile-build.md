---
title: "A shorter college profile: overview cards and a page per topic"
pr: 47
date: 2026-10-02
kind: improvement
summary: Each college's profile now opens with one card per topic and a page for each, instead of one page that ran to 25 screens; nothing was removed, and every number keeps its citation.
---

## What's new

Open any college and you land on a **short overview**: a card for getting in, students and campus, majors and
faculty, cost and aid, outcomes, and how it's changed. Each card shows the few numbers people quote most, a ten-year
line, and a one-sentence takeaway. Tap or click a card for **its own page** with everything the profile showed
before: the funnel and your scores, who's on campus, every major with search, what families pay, earnings and
graduation, and the year-by-year charts. A row of topic pills at the top of each page moves sideways between them.

On phones it's a card, a tap, a page, and back. Tablets get the desktop layout with the long chart groups folded.
The year-by-year charts show one group at a time (cost, aid, admissions, and so on) so that page is one to four
screens instead of a wall of charts. Old links into the profile, like `#cost`, still work and take you to the right
page.

Harvard's profile went from about 23,000 pixels on a desktop to an overview of about 2,500, with topic pages of
2,000 to 4,000 each.

## Behind the scenes

The build followed [profile-redesign.md](../specs/profile-redesign.md): routes and shared pieces first, then the
cards, then tablet folding, the Over time pills, and a measurement script (`npm run measure-profile`) that checks
page heights and phone viewports against the spec's budgets. A test proves the pages together still show every
field the single page showed. Topic pages render on first visit and are kept for a day; the Over time page renders
per request so `?group=` is honoured in the HTML. Four subagents built the phases on their own branches.
