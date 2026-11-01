`reports/`: the real `data/reports/` directory's 18 `college-reported-run-*.json` file names (the fixture's layers
leave out `reported.reports`: pipeline bookkeeping, not unit-filtered by the import), for the "newest run over every
college" test. Only the newest file (`college-reported-run-20261026-190530-145.json`, real, whole; `total: 1893`,
already a full run) carries real content — `fetchRunCost` stops at the first file whose `total` clears
`FULL_RUN_MIN_COLLEGES`, so the rest are read only for their names (empty placeholders). Source:
`data/reports/college-reported-run-20261026-190530-145.json`, as committed 2026-10-31.
