/**
 * The estimate's input from the student's saved profile: the one piece of the snapshot code the browser needs
 * (the planner, the profile's standing card). Client-safe, and kept apart from lib/chances/snapshot.ts so the
 * snapshot's measurement-only columns never reach a client bundle (specs/chances/README.md "Quad's estimate is
 * proprietary"; tests/chances-estimate-ui.test.mts guards the client imports).
 *
 *   const input = estimateInputFromProfile(profile, "243744", "ea");
 */
import type { EstimateInput } from "./types.ts";
import { allActivityStepsAnswered } from "../planner/activity-steps.ts";
import { planGpaRange, planTest, residencyState, unweightedGpa4, type StudentProfileData } from "../student-profile.ts";

/** The estimate's input for one college from the student's saved profile (the same numbers the plan reads). */
export function estimateInputFromProfile(profile: StudentProfileData | null, unitId: string, round: string | null): EstimateInput {
  const a = profile?.academics;
  const t = profile?.tests;
  const b = profile?.basics;
  return {
    unitId,
    student: {
      gpa: a ? unweightedGpa4(a.gpa, a.gpaScale) : null,
      gpaScale: a?.gpaScale ?? "4.0",
      gpaRange: profile ? planGpaRange(profile) : null,
      test: profile ? planTest(profile) : null,
      satMath: t?.satMath ?? null,
      actMath: t?.actMath ?? null,
      classRankPercentile: a?.classRankPercentile ?? null,
      courses: a?.courses ?? [],
      // Residency: the record's own state, else the household's address (owner, 2026-10-16); with neither the model
      // falls back to the high school's state and says so (model.ts ownerReading).
      state: residencyState(profile).state,
      majors: profile?.plans.intendedMajors ?? [],
      round,
      highSchoolId: b?.highSchoolId ?? null,
      practice: t?.practice ?? false,
      // Admission chances, next (specs/chances/depth.md, inputs-beyond-academics.md): passed through for U5's model
      // and U6's readings; this unit only wires them onto EstimateStudent, never scores them.
      activities: a?.activities ?? [],
      awards: a?.awards ?? [],
      classStanding: a?.classStanding ?? null,
      firstGeneration: a?.firstGeneration ?? null,
      // U11 (inputs-beyond-academics.md, method/standing.md "Revision 1"): wired through for U14's model, never
      // scored here.
      weightedGpa: a?.weightedGpa ?? null,
      rankExpectation: a?.rankExpectation ?? null,
      // Revision 3 (method/standing.md, rule 3): the target on the focus test and the graduation year, so the model
      // can read the target until junior year ends. Passed as entered; the model decides (it knows the date).
      testTarget: t && (t.focus === "sat" || t.focus === "act") && t.target !== null ? { kind: t.focus, score: t.target } : null,
      gradYear: b?.gradYear ?? null,
      // Owner, 2026-10-12: all four activity steps answered (entries or "None"), so an empty list reads as answered for
      // completeness rather than as a gap. Only the yes/no travels; the steps themselves stay on the profile.
      activitiesAnswered: a ? allActivityStepsAnswered(a.activities ?? [], a.awards ?? [], a.activitiesNone) : false,
    },
  };
}

