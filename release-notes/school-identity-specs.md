---
title: "Plans: links to each college, its social accounts, searching by nickname, and its own colors"
pr: 59
date: 2026-10-03
kind: plans
summary: Plans for linking every profile to the college's website, admissions, application, aid, and campus-visit pages and its social accounts, for finding a college by a short name like "UGA", and for showing each college's own colors and mark on its profile.
---

## What's planned

A profile today is all numbers. Four plans, worked out and measured on 2026-10-03, give each college a presence of
its own:

- **[Official links](../specs/school-identity/links.md)**: the college's website, admissions office, online
  application, financial aid office, veterans' and disability-services pages, and the page where you book a
  **campus visit**. Nearly all of these come from the directory colleges file with the federal government every
  year; the visit page is found on each college's own admissions page.
- **[Social accounts](../specs/school-identity/social-accounts.md)**: Instagram, YouTube, TikTok, X, Facebook, and
  LinkedIn, one tap from the profile, for 1,548 of the 1,893 colleges to start with.
- **[Short names and nicknames](../specs/school-identity/aliases.md)**: search for **UGA**, **Vandy**, **Georgia
  Tech**, or **Ole Miss** and get the right college, with the short name shown in the result so you know why it
  matched. "ASU" lists all five.
- **[Colors and marks](../specs/school-identity/brand.md)**: the hero and the lettered tile take the college's own
  colors, sourced from brand guides, and the tile can show the college's own site icon instead of its initials.
  Colors will ship first; whether to show marks is a decision for the site's owner, and the plan explains what the
  law allows in plain terms.

## Behind the scenes

- The federal directory file the site already downloads carries seven link columns; the homepage was already stored
  and simply never shown.
- Wikidata records the federal id for 1,719 of our colleges, so accounts, other names, the Wikipedia article, and a
  logo file join exactly, with no name matching. A new `sync-wikidata` script will keep that file current.
- Wikipedia's college color table lists 1,555 athletic programs' colors with citations to the colleges' own brand
  guides; it is joined through each college's article.
- Every link, handle, alias, and color keeps its source, like every number on the site, and corrections go in the
  same override files.
