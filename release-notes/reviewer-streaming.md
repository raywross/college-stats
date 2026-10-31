---
title: "A reader's notes arrive one at a time"
pr: 200
date: 2026-10-31
kind: improvement
summary: On the essay editor, "Read this draft" now shows each note as the reader finds it instead of making you wait a minute for all of them; the reader also keeps to eight shorter notes and remembers its preparation for an hour.
---

## What's new

Asking for a reader's notes used to mean a blank minute, then everything at once. Now the first note appears within
about fifteen to twenty seconds and the rest follow as the reader finds them, so you can start reading while it
finishes. The panel says so: "Reading… notes appear as the reader finds them." Done and Ignore switch on the moment
the full set is saved.

The reader also keeps to **eight** notes instead of twelve, each shorter: what it noticed in about twenty words, why it
matters in about twenty-five, and its question. Fewer, sharper notes read better than a long list.

If the reader is cut off before it finishes, the notes that arrived whole are kept rather than thrown away, and the
panel tells you it stopped early. A second read within the hour starts faster, because the reader's preparation is
remembered that long.

## Behind the scenes

The review route streams one JSON line per event (reading, each note, done) once the read starts; every check before
the read answers as before. A small parser yields each complete note from the model's answer however the stream
splits it, the per-note guards run as notes arrive, and the review is stored and counted when the stream ends. The
prompt's stable block is cached for an hour. Tests cover the parser at every split point, the event order, a stream
cut off mid-way, a refusal, and the panel's states.
