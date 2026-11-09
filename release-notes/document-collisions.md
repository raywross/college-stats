---
title: "When two files claim the same year, the admin sees both and picks one"
pr: 232
date: 2026-11-08
kind: improvement
summary: The admin console now shows, for every college, where each Common Data Set file came from, when it was pulled, how it was filed and how well it read; when two files claim the same edition it lays their differences side by side and lets an admin keep one, and the Data Steward raises that choice instead of guessing.
---

## What's new

Nothing changes on the site for students, parents, or counselors. This release is about how Quad's admins and the
Data Steward handle the files behind a college's numbers.

**Every file, explained.** A college's page in the admin console now lists its Common Data Set files in plain words:
the site it was pulled from, the date, whether the year was stated on the cover or assumed, who read it and when, and
how many of its items yielded a value and how many tripped a check.

**Two files, one year.** Sometimes two files claim the same edition, as when a university's Drive copy of a Common
Data Set sits beside the official PDF. The page now shows both files' facts side by side and every item where their
values differ, named in words, so an admin can see which file is the better read. **Keep this file** removes the
other one from the college, takes its items out of the review queue, and remembers its address so the Steward never
fetches it again.

**The Steward asks instead of guessing.** When the Steward finds a file whose cover says one year but which was filed
under another, and the right year is already taken, it no longer proposes a move that cannot happen. It leaves a
finding that says "Two files" with a link straight to the comparison. And when something the Steward was asked to do
fails, the proposal now says "Apply failed" and why, instead of looking approved.

## Behind the scenes

The comparison is a pure function over the two stored documents, tested against the UC Santa Cruz case that prompted
this. Keeping a file is one change set that touches the record, the manifest, the review queue and the college's
source recipe, written by the console directly through the data store with the same library the pipelines use. A new
command, drop-document, does the same from a terminal. The Steward's writer refuses a colliding refile and the apply
step refuses one with a link in its message; a failed apply marks the proposal failed in its own change set.
