---
title: Household and Explore respond on the click
pr: 99
date: 2026-10-07
kind: improvement
summary: Switching between people in your household and opening Explore now respond the moment you click, with the page's shape shown first and the content filling in, and signed-in pages make far fewer trips to the database.
---

## What's new

- **Switching people is quick.** Each person's page used to make eight to ten trips to the database one after
  another before showing anything. It now checks who you are without a round trip, reads what it needs in one or
  two trips, and shows the page's outline immediately while the list loads.
- **Explore answers the click.** Opening Explore shows its layout at once (the toolbar, the filter rail, the card
  grid), then the colleges fill in. The page itself was already fast after the last update; this removes the blank
  moment before it appeared.
- Nothing changes in what you see once a page has loaded, or in who can see what.

## Behind the scenes

The session is now verified locally with Supabase's `getClaims()` (the token's signature checked against the
project's published keys, cached for ten minutes) instead of a network call to the Auth server on every signed-in
page and in the middleware; identity rests on the same signature the database's row-level security trusts. Two
consequences are written into `specs/product/accounts.md`: a session revoked on another device reads as signed in
until its token expires, an hour at most, and the email shown comes from the token. Loading boundaries were added
for the household person pages and Explore (`loading.tsx`), the household reads are shared per request with React
`cache` and started in parallel, and a guardian's access-log write runs after the response (`after()` from
`next/server`). Guard tests keep each of these in place. Details in `specs/serving-architecture.md`, "Follow-up".
