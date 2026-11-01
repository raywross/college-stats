42 real colleges' minimal matcher fields (`unit_id`, `name`, `location.city`/`state`, `links.website`; the only
fields `collegesFrom` reads) for the matcher's hard-case tests: Boston University, Northeastern, the five Claremont
Colleges, Rice, three Miami University campuses, three Penn State campuses, the two Saint John's, Washington
University in St. Louis, IU Kokomo, UW Tacoma, George Washington, the two Columbia Colleges, Columbia University,
two SUNY campuses, Hunter College, UT Dallas, and the `FLAGSHIPS` (scripts/lib/directories/matcher.mts) not already
in the mini fixture's 38 colleges. These tests name real colleges to exercise the matcher's disambiguation rules
(same name, different campus; aliases; subdomains; consortia), which the mini fixture's smaller set can't stand in
for. Source: `data/schools.json`, as committed 2026-10-31.
