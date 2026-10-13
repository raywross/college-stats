---
title: "Planned: when a college is coming to your town"
pr: 155
date: 2026-10-13
kind: plans
summary: A plan to read every college's visit calendar each night and tell signed-in families when a college on their list adds a tour, a session, or a visit to a high school near them.
---

## What's planned

Colleges publish far more visit events than their visit pages show. On 13 October the University of Florida listed
528 upcoming events: campus tours and information sessions in Gainesville, nine online sessions, and **340 visits by
its admissions officers to high schools and college fairs in 18 states**, each one open to any family that signs up.
Duke listed its tours with open and full slots and its "Discover Duke" evenings in Detroit, Denver, Philadelphia, and
Boston. Today a family finds these only by searching the right ZIP code on the right page of each college.

The plan, [Visit events](../specs/product/visit-events.md):

- **Read every calendar nightly.** About 820 colleges run admissions on the same system, and all of them publish
  their events the same way. Quad will read those calendars every night and keep each event's date, time, place, and
  the link to sign up on the college's own page. Quad never takes a booking itself.
- **Show them to signed-in families.** A college page gains "Upcoming visits", with the next events on campus and the
  next ones near you; a visits page lists everything at the colleges on your lists, nearest first; the planner's
  "Book a visit" shows the next two and logs the one you registered for.
- **An email when something new is near you.** When a college on your list adds an event within your chosen distance
  of home (30 miles unless you change it; your high school when no home is saved), you get one email that night,
  with a sign-up link for each event. Alerts can be turned off for any one college, or altogether, in one click.

It starts with a two-week trial on about two dozen colleges before every calendar is read.

## Behind the scenes

The idea's research ran from a desktop session and is recorded in [the idea file](../specs/ideas/visit-events.md):
the standard search every Slate host answers, the portal widget that carries online events and seat counts, the event
page that states the full date and venue, a 100-college sample of our visit links (59 reach a Slate page in one
hop), the staff rows some colleges leave public (30% of Duke's list), and what CampusBooker, the one comparable
product, turns out to read. The roadmap entry moves from ideas to the planning tools at the largest complexity.
