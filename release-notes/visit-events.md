---
title: "When a college is coming to your town: visit events, a pilot"
pr: 158
date: 2026-10-13
kind: feature
summary: Signed-in families now see every tour, session, and high-school visit four pilot colleges publish, with sign-up links, and can get a nightly email when a college on their list adds an event near home.
---

## What's new

Colleges publish far more visit events than their visit pages show: campus tours and information sessions, online
sessions, and the days their admissions officers spend at high schools and college fairs around the country. Quad now
reads those calendars every night and shows them to signed-in families, starting with four colleges: the University
of Florida, Duke, UNC Chapel Hill, and UT Austin (about 2,100 upcoming events between them).

- **On a college's page**, under its official links, "Upcoming visits" lists the next events on campus and the next
  ones near you, each with the date, time, place, how far it is, whether it still has room, and a **Sign up** link to
  the college's own page. Quad never takes a booking. Signed out, the page says only how many events the college
  lists.
- **Your visits page** (`/me/visits`) gathers the events at every college on your lists, nearest first, with a switch
  per college to stop its alerts.
- **A nightly email** when a college on your list adds an event within your chosen distance of home: 30 miles unless
  you change it, measured from your home address or, if none is saved, the student's high school. One email a night at
  most, each event with a sign-up link, "Stop alerts for this college" and one-click unsubscribe in the footer. Online
  sessions stay out of the email unless you turn them on.
- **In the planner**, a college's row shows its next two events, and "I registered" logs the visit for you.

Settings (distance, where it's measured from, online sessions, the email itself) are on your account page beside the
data-update emails.

## Behind the scenes

Every one of these colleges runs admissions on the same system, which answers one public search per college with its
whole calendar; a second read of each college's own event pages adds the online sessions and seat counts, and a third
read of each new event's page confirms its date, time zone, and address. Staff rows the colleges leave public (shipping
requests, filled group slots) are recognised by their titles and never shown. The read runs every night as a GitHub
workflow; the email job runs after it. The plan is in [the spec](../specs/product/visit-events.md), with what was built
and what waits for the next round (reading the other 800 or so colleges on the same system, and the ones on other
systems).
