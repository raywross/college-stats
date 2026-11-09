---
title: The header knows you at first paint, and pages stop downloading what you may never open
pr: 234
date: 2026-11-08
kind: improvement
summary: "Sign in" or your avatar shows the instant a page paints, pages no longer fetch dozens of other pages in the background, the college and compare pages carry less, every plan tab switches in place, and a revoked sign-in key stops being accepted within the hour.
---

## What's new

- **The header is right from the first moment.** Signed out you see "Sign in" before any script has run; signed in
  you see your avatar with your initial at once, where before the slot sat empty for up to a second or two while the
  page asked who you were.
- **Pages download far less in the background.** A compare page used to fetch 37 other pages' payloads as soon as
  it loaded, about 660 KB; now it fetches about 56 KB, and the same goes for Explore, the home page, and every college
  page. Links still load fast: the page behind a link starts downloading when you hover or touch it.
- **College and compare pages are lighter.** The source list, the citations behind each ⓘ, and the estimate's data
  travel in a smaller form, with the same words on the page.
- **Every plan tab switches in place now**, Offers and Next steps included.

## Behind the scenes

A small readable cookie carries only the initials and role, and a tiny inline script sets the header's state before
the bundles load; the account state still comes from the server afterwards. Links to heavy static pages use a
wrapper that prefetches on intent rather than on sight, with a test listing the links allowed to prefetch on sight.
The plan reads the Offers tab's letters and the open asks in its first wave, and marking asks seen became an action
the Next steps panel fires when it is first shown. The signing keys the session check uses now refresh once an hour
per server, after a response, so a revoked key leaves within the hour without a deploy.
