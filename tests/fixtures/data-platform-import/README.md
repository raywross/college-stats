A git-layout `data/` slice for three real colleges (IDS in tests/data-platform-import.test.mts): Duke (198419,
Common App, Coalition, essays, a college-reported CDS record, directories, the campus pilot's policies,
selectivity), Simpson University (123457, CCCU, Common App's international-aid answer), Hilbert College (191621,
Common App's own-site links, directories). Built by the test's own `buildFixture()` logic run once against the
real `data/` and committed here, 2026-10-31, because the comment that introduced this fixture ("until the mini
fixture exists") predates tests/fixtures/snapshot-mini/ but this script (import-data-from-git.mts /
import-data-from-files.mts) reads the git layout, not the store's layer format the mini fixture ships.

`overrides-sample.json`: NYU's real committed School record (193900) and its real data/overrides.json entry, copied
separately 2026-10-31 (none of the three colleges above has a real override entry; NYU's is the smallest one that
does), so "the legacy overrides stay in the base" still runs against a real override on real data.
