---
title: The nightly calendar read writes only what changed
pr: 244
date: 2026-11-10
kind: fix
summary: The visit-events sync no longer rewrites every one of its 220,000 rows each night to move a timestamp; it writes the few thousand that changed, reads "last read" from the hosts table, and runs at 2:30 am Eastern instead of drifting into the morning.
---

## What's new

Nothing changes in what you see. A college's "Read from its calendar at …" line now shows when the calendar was last
read, as it did, from a different column.

## Behind the scenes

On 2026-11-10 sign-in hung for a quarter of an hour. The nightly visit-events sync was the cause: it rewrote every
live event (about 220,000 rows across 859 college calendars) to move each row's `last_seen`, for about 1,300 real
changes. On the database's smallest instance each 500-row batch took a second, eight hosts wrote at once, and the
signed-in pages' reads timed out behind them. The run also used up the instance's CPU burst, so the site stayed slow
after it ended. GitHub had been starting the 07:00 UTC schedule between 13:47 and 17:16 UTC all week.

Now a row seen again with nothing different is not written, the "read at" time comes from the hosts table, and the
schedule is 06:23 UTC. The compute add-on is the remaining item, left with the owner.
