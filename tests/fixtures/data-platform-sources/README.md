`high-schools/`: a small slice of the real `data/high-schools/` (DC and DE's school/ledger shards, South Carolina's
state shard, the whole `detail/` folder, and the three shared files), copied 2026-10-31 for
tests/data-platform-sources.test.mts's `smallHighSchools()`. `data/high-schools/schools/`, `ledger/`, and `detail/`
are pipeline bookkeeping the mini fixture's layers deliberately leave out (scripts/build-mini-fixture.mts
LAYER_EXCLUDES), so this test needs its own copy while `data/` still exists.

`coalition/members.json`: the real, untrimmed `data/coalition/members.json`, copied 2026-10-31. The mini fixture's
own `coalition.members` layer is trimmed to its 38 colleges (8 Coalition members), too few for
`sync-coalition.mts`'s own sanity guard (it expects 100–300 names on a real member page); this test generates a
fake "scraped" page from a real-sized document instead.
