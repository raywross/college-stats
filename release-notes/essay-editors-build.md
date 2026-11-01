---
title: "Parents and counselors can suggest changes to an essay"
pr: 211
date: 2026-11-01
kind: feature
summary: A parent or counselor can now propose changes in a student's draft, which the student accepts or rejects one by one, and every note, comment and suggestion is marked in the draft with a colored underline you can hover or tap.
---

## What's new

- **Suggest changes.** On a student's draft, a parent (and a counselor, once the portal exists) sees a Suggest changes
  button. It opens their own copy of the text; they edit, add a note, and send. Nothing in the essay changes yet.
- **The student decides.** A banner says who suggested how many changes, and a Review changes tab shows them the way
  Word does: deleted words struck through, new words underlined, in that person's color, with Accept and Reject on each
  change and Accept all or Reject all. Three views: With changes, As suggested, Original. An accepted change lands
  where it belongs even if the student kept writing; a change whose spot was since rewritten says "The draft changed
  here" and offers a copy.
- **Marks in the draft.** Every open reader's note, comment and suggestion is underlined in the field: amber for the
  reader, a color per person, gray for the student's own comments. Hover or tap for who and what; Open jumps to the
  details. A legend above the field names the colors and toggles them.
- **The reader's corrected words** (a typo's fix) now appear in Review changes with Accept, the one kind of text the
  site proposes.

## Behind the scenes

- A suggestion is stored once, as the editor's whole proposed text, and shown as the differences from the text they
  started with; each change is located in the current draft by its words and their neighbors before it is applied.
  Only the student's own account changes the essay; an editor's account can only write suggestions, and only until the
  student has decided anything.
- The editor stays a plain text field. The underlines are drawn on a layer behind it and the taps caught on a layer
  above it, so phones, dictation and screen readers work as before.
- Nothing about an essay reaches analytics: counts and roles only.
