/**
 * Where a student stands at one college (specs/planner/redesign/standing.md). The published rules moved to
 * lib/chances/baseline.ts, the open baseline behind Quad's estimate (specs/chances/estimate.md); this module
 * re-exports them so the design preview, the score coach's helpers, and the existing tests keep their imports. The
 * plan itself reads estimates from the server (lib/chances/estimate.ts) and no longer calls `standingFor`.
 */
export {
  actToSat,
  balance,
  FIT_RANK,
  gpaPoint,
  gpaSpan,
  RETAKE_REACH,
  retakeFromMoves,
  retakeSuggestion,
  satToAct,
  scoreToMoveUp,
  STANDING,
  standingFor,
  TEST_LABEL,
  TEST_MAX,
  TEST_MIN,
  TEST_STEP,
  type Fit,
  type GpaCite,
  type MoveUp,
  type Position,
  type RetakeSuggestion,
  type ScoreRead,
  type SendAdvice,
  type StandingResult,
  type StandingSchool,
  type StandingStudent,
  type TestKind,
} from "../chances/baseline.ts";
