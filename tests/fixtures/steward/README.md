# Steward fixtures

Real documents from the data store on 2026-11-01 (public data about colleges): a sample of the review queue (up to 40 open items for each of the 14 biggest checks, keyed as `reported.review_queue` keys them), 60 `reported.failures` documents, and the `reported.docs` manifest entries of documents the sampled items cite. Exported by a read-only script; no person's data. Rebuild by re-exporting, never by hand.

`review/` holds recorded job runs for the job review (`--mode review --run-file`; tests/steward-job-review.test.mts), one per case in specs/product/admin-redesign.md "Tests", each with the review it should get. The answers in `answers/` whose `note` says "written for the fixture, not recorded" are the one-sentence notes for those runs, written by hand and keyed by their request as the dry run keys it.
