The real GPA model and curve (lib/planner/gpa-model.ts fitGpaModel/fitGpaCurve), fit from the full real
data/schools.json (1,893 colleges) on 2026-10-31. The mini fixture's 12 colleges are far under the fit's
minRows (25), so tests/admin-hidden.test.mts loads this frozen fit instead of recomputing it, then runs
hidden.gpaPanel/collegeGpa against the mini fixture's own colleges.
