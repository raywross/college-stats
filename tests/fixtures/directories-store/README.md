A small `data/`-shaped directory (the old file layout `importLayers`/`import-data-from-git.mts` reads) for
`tests/directories-store.test.mts`. The mini fixture's layers leave out `directories.unmatched`,
`directories.blocked`, `directories.matches`, and `campus.sources` entirely (pipeline bookkeeping, not
unit-filtered by the import), and the test needs `importLayers` to read a real `data/` directory, which won't
exist after phase 4.

- `data/directories/{sigma-delta-tau,tpc-athletics,sigma-nu,pi-kappa-phi}.json`: four small organizations' real
  listings, already trimmed to the mini fixture's colleges (the same bodies as
  `tests/fixtures/snapshot-mini/layers/directories.listings/`).
- `data/directories/unmatched/{same four}.json`: their real unmatched entries, whole.
- `data/directories/blocked.json`, `data/directories/matches.json`: the whole real files.
- `data/campus-pages.json`, `data/campus-sources.json`: three colleges' real pilot pages and recipes (204796 Ohio
  State, 199120 UNC Chapel Hill, 110635 UC Berkeley — the smallest of the colleges where the mini fixture's
  `campus.pages` layer and the real `data/campus-sources.json` overlap), self-consistent with each other.
- `data/schools.json`: two small real colleges (138558 Abraham Baldwin, 490328 Mechon L'hoyroa) for the
  `base.colleges` test (an adapter matching "Mechon L'hoyroa" against "Columbia College", standing in for the
  original test's Vanderbilt/Columbia pair — any two names that don't fuzzy-match work).
- `data/reference/campus-pilot-3-colleges.json`: the whole real file (also in the mini fixture's reference set).

Source: `data/directories/`, `data/campus-pages.json`, `data/campus-sources.json`, `data/schools.json`,
`data/reference/campus-pilot-3-colleges.json`, as committed 2026-10-31.
