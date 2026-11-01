Trimmed, real docs manifest entries for the four CDS academics colleges (Vanderbilt 221999, Cornell 190415,
William & Mary 231624, UIUC 145637): the fixture's layers leave out `reported.docs` (pipeline bookkeeping, not
unit-filtered by the import), so a test that needs the manifest to validate the fixture's four CDS records reads
this instead. Source: `data/college-docs.json`, as committed 2026-10-31.

`college-batches.json` is the whole real (empty) file: the fixture's layers leave out `reported.batches` too, and
a test checks this file's shape. Source: `data/college-batches.json`, as committed 2026-10-31.
