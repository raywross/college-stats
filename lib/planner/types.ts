/**
 * The planner's shared shapes (specs/planner/model.md; the build brief's "Types"). Every row type the planner tables
 * hold (supabase/migrations/20261008120000_planner.sql) and the PlanContext that PlanPage computes once and passes to
 * each stage panel. Types only: safe to import from server code, client components, and tests.
 */

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type StageState = "done" | "open" | "not_yet";
export type Assignee = "student" | "guardian" | "either";
/** `season`: the playbook's own entries (specs/planner/next-steps/seasons.md; lib/planner/generators/season.ts). */
export type TaskSource = "college" | "cycle" | "stage" | "own" | "season";
export type TaskKind =
  | "apply" | "decision_expected" | "aid_forms" | "reply_by" | "housing_deposit" | "ed2_conditional"   // college (U5)
  | "cycle"                                                                                            // cycle file entries; key = entry key (U5)
  | "decide_rounds"                                                                                    // U3
  | "follow" | "request_info" | "write_visit_notes"                                                    // U4
  | "fee" | "send_scores" | "transcript" | "recommendation" | "supplement" | "submit" | "portal_setup" | "portal_check"
  | "continued_interest" | "waitlist_accept" | "waitlist_deposit_elsewhere"                            // U6
  | "add_offer" | "deposit" | "withdraw" | "waitlist_decide" | "summer"                                // U7
  | "cost_check" | "test_register" | "test_day"                                                         // redesign (U6)
  | "playbook"                                                                                         // next steps U1: the playbook's own entries
  | "ed_decide" | "ed2_decide"                                                                         // next steps U2
  | "visit_ed" | "show_interest"                                                                       // next steps U3
  | "shape_gap" | "shape_cost"                                                                         // next steps U4
  | "confirm_complete" | "compare_offers" | "decide_by" | "outcome_share"                              // next steps U5
  | "story"                                                                                            // next steps U7
  | "own";
/**
 * What a move's one button does (specs/planner/next-steps/seasons.md "Moves"; build-plan.md "Moves"), stored in
 * plan_tasks.action (jsonb). Null: no button beyond Done and Not now.
 */
export type MoveAction =
  | { kind: "href"; href: string }
  | { kind: "open_intake"; step: number }
  | { kind: "open_tab"; tab: import("./plan-tabs").PlanTab }
  | { kind: "open_row"; itemId: string; panel?: "ed" | "capture" }
  | { kind: "mark_applied"; itemId: string }
  | { kind: "record_decision"; itemId: string }
  | { kind: "set_round"; itemId: string; round: "ed" | "ed2" }
  | { kind: "choose"; itemId: string }
  | { kind: "show_rail"; level: import("../chances/types").StandingLevel; gap: import("./list-shape").ShapeGapKind }
  | { kind: "story" }
  | { kind: "tick" };
export interface PlanTask {
  id: string; list_id: string; item_id: string | null; key: string | null; kind: TaskKind;
  title: string; detail: string | null;
  due_on: string | null; window_start: string | null; window_end: string | null;
  assignee: Assignee; source: TaskSource; source_field: string | null; source_edition: string | null;
  /** "last_cycle" when the date came from the previous cycle's edition (timeline.md "Rules"); "own" for a typed date. */
  date_note: "last_cycle" | "own" | null;
  done_at: string | null; done_by: string | null; snoozed_until: string | null; dismissed: boolean;
  /** Set by mergeTasks when a generated task's source disappeared; shown once, then hidden. */
  orphaned: boolean;
  position: number; created_by: string | null; created_at: string;
  /**
   * Next steps (20261014120000_next_steps.sql): the season the move belongs to (only the season generator sets it;
   * otherwise a move's season is its date's, lib/planner/moves.ts taskSeason) and what its one button does. Null
   * before the migration is applied (read-plan.ts reads without them).
   */
  season: import("./seasons").Season | null;
  action: MoveAction | null;
  /**
   * Plan v3 (20261016120000_plan_v3.sql; specs/planner/v3/now.md "Skip, recorded"): when and by whom the move was
   * skipped (`dismiss`), cleared with the flag (`undismiss`). Null before the migration is applied (read-plan.ts reads
   * without them) and on a task skipped before it.
   */
  dismissed_at: string | null;
  dismissed_by: string | null;
}
/** What a generator emits. `season` and `action` are optional (null when left out), so the older generators are untouched. */
export type GeneratedTask = Omit<PlanTask, "id" | "list_id" | "done_at" | "done_by" | "snoozed_until" | "dismissed" | "dismissed_at" | "dismissed_by" | "orphaned" | "created_by" | "created_at" | "season" | "action"> & {
  key: string;
  season?: import("./seasons").Season | null;
  action?: MoveAction | null;
};
export type VisitKind = "campus_tour" | "info_session" | "open_house" | "virtual" | "interview" | "fair" | "overnight" | "other";
export interface PlanVisit { id: string; item_id: string; kind: VisitKind; on_date: string; at_time: string | null; registered: boolean; registration_url: string | null; who: string[]; rating: number | null; notes: VisitNotes; created_by: string | null; created_at: string; updated_at: string }
export interface VisitNotes { stood_out?: string; worried?: string; people?: string; questions?: string; live_here?: string; free?: string; interviewer?: string; interviewer_kind?: "alumni" | "admissions" }
export interface PlanOffer { id: string; item_id: string; award_year: number; letter_date: string | null; source: "form" | "upload"; coa: OfferCoa; gift: OfferGift[]; work_study: number | null; loans: OfferLoan[]; quotes: Record<string, string> | null; pros: string | null; cons: string | null; confirmed_at: string | null; created_by: string | null; created_at: string }
export interface OfferCoa { tuition_fees: number | null; housing_food: number | null; books: number | null; transport: number | null; personal: number | null; other: number | null; total: number | null; stated_by_college: boolean }
export interface OfferGift { kind: "federal" | "state" | "college_need" | "college_merit" | "outside"; name: string; amount: number; renewable: boolean | null; renewal_condition: string | null; years: number | null }
export interface OfferLoan { kind: "direct_sub" | "direct_unsub" | "parent_plus" | "private" | "institutional"; amount: number }
export interface PlanLetter { id: string; item_id: string; kind: "admission" | "aid" | "other"; storage_path: string; uploaded_by: string; created_at: string }
export interface PlanNudge { id: string; task_id: string; from_user: string; to_student: string; note: string | null; sent_at: string; channel: "email" | "sms" | "app"; reply: string | null; replied_at: string | null }
export type SocialNetwork = import("../types").SocialNetwork;   // instagram | youtube | tiktok | x | facebook | linkedin
/** list_items gains these columns (U1 migration); ListItem in lib/list-rules.ts gains them too (U1, additive). */
export interface PlanItemColumns { dream: boolean; priority: number | null; followed_networks: SocialNetwork[]; info_requested_on: string | null; application_platform: "common_app" | "coalition" | "own" | "uc" | "apply_texas" | "other" | null; applied_on: string | null; complete_on: string | null; portal_url: string | null; committed_on: string | null; withdrawn_on: string | null; recommendations_count: number | null; supplements_count: number | null; transcript_shared: boolean;
  /** Redesign (20261010120000_plan_redesign.sql): whose group is stored. 'auto' = the standing model's suggestion, rewritten as it changes; 'student' = picked, never changed by the site. */
  category_source: "auto" | "student";
  /** Redesign: whose round is stored. 'auto' = the starting round (lib/planner/auto-rounds.ts); 'student' = picked. */
  round_source: "auto" | "student";
  /**
   * Admission chances, next (20261012100000_five_levels.sql; specs/chances/inputs-beyond-academics.md "Legacy",
   * "Recruited athlete"): per-college, set from the drawer's "About you and {College}" line (U8), written by
   * lib/planner/store-list.ts setItemLegacy/setItemRecruited.
   */
  legacy: boolean;
  recruited: import("../chances/types").RecruitedPick;
  /**
   * A brother or sister went here (owner, 2026-10-12; 20261012130000_list_item_sibling.sql), set from the row's
   * Connections line. Optional: absent until the column exists (read-plan.ts falls back without it).
   */
  legacy_sibling?: boolean;
  /** Next steps (20261014120000_next_steps.sql; ed-opportunities.md): "Not for me" on the row's ED pill. Optional: absent before the migration (read as null). */
  ed_dismissed_at?: string | null;
  /** Next steps: the ED sheet's checklist ticks, by check key. Optional: absent before the migration (read as {}). */
  ed_checks?: Record<string, boolean> }
export type PlanItem = import("../list-rules").ListItem & PlanItemColumns;
/** lists gains: sort text null, rounds_plan_accepted_at timestamptz null. */
export type ListSort = "mine" | "category" | "dream_priority" | "next_date" | "admit_rate" | "avg_cost" | "distance" | "standing";
export type Capability = "planner.tab" | "planner.rounds" | "planner.actions.visits" | "planner.calendar" | "planner.reminders" | "planner.texts" | "planner.parents.nudge" | "planner.offers";

/** Everything a stage panel gets, computed once by PlanPage (server) and passed down. Serializable: client stage
 *  components receive the parts they need as props; no functions. */
export interface PlanContext {
  list: import("../list-rules").ListRecord & { sort: ListSort | null; rounds_plan_accepted_at: string | null };
  items: PlanItem[]; tasks: PlanTask[]; visits: PlanVisit[]; offers: PlanOffer[]; nudges: PlanNudge[];
  student: { id: string; display_name: string | null; grad_year: number | null; user_id: string | null } | null;  // null for a guardian's own list
  profile: import("../student-profile").StudentProfileData | null;
  schools: Record<string, PlanSchool>;          // by unit_id; the slice of School a stage needs, with citations resolved
  home: import("../home").HomeLocation | null;
  viewer: { userId: string; firstName: string | null; canEdit: boolean; relation: "self" | "guardian" | "household"; isGuardian: boolean };
  today: string;                                // ISO date
  cycle: import("./cycle").Cycle;               // the student's cycle entries (or the current one for a guardian's list)
  grade: import("./cycle").Grade;
  /** Next steps: the student's season on `today` (lib/planner/seasons.ts seasonOf; `unknown` without a grad year). */
  season: import("./seasons").Season;
  /** Next steps: the plan's graduation year (the student's effective one; null for a guardian's own list or unset). */
  gradYear: number | null;
  /** Next steps (build-plan.md review note 3): Quad's estimate per college by unit id, computed on the server. */
  estimates: Record<string, import("../chances/types").EstimateResult>;
  stages: Record<Stage, { state: StageState; count: string }>;
  current: Stage;
  /**
   * Chances (additive, rigor-in-context.md): the student's courses read against their high school, computed on the
   * server by lib/planner/load.ts (the rules never reach the browser). Absent for a signed-out plan and when the
   * student has entered nothing. A guardian's copy carries no AP exam scores while the student keeps them private.
   */
  rigor?: import("../chances/rigor-view").RigorView | null;
  /**
   * Chances (additive, course-plan.md): next year's course suggestions, guardrail messages, or the 9th–10th grade path,
   * written on the server (lib/chances/course-plan-server.ts; the rules never reach the browser). Absent for a
   * signed-out plan and when the student has no profile.
   */
  coursePlan?: import("../chances/course-plan-view").CoursePlanView | null;
}
/** The college facts stages read, cut from School on the server with citations already resolved
 *  (`citeField` → the serializable Citation the InfoTip takes). U1 defines and fills it; add fields additively. */
export interface PlanSchool { unit_id: string; name: string; city: string | null; state: string | null; brand?: unknown; admitRate: number | null; admitRateCite: unknown; avgCost: number | null; avgCostCite: unknown; sticker: unknown; distanceMiles: number | null; links: import("../types").SchoolLinks | null; social: unknown; profile: import("../types").ReportedAdmissionProfile | null; logistics: import("../types").ReportedLogistics | null; aid: import("../types").ReportedAid | null; testPolicy: unknown; cycleStartYear: number; editionIsLastCycle: boolean; cites: Record<string, unknown>;
  /** U3 (additive): public or private (a public university's EA stays beside a restrictive EA plan). */
  type?: import("../types").SchoolType | null;
  /** U3 (additive): C1 totals from the same CDS document as the ED counts (lib/early.ts sameDocumentTotals), for the ED advantage. */
  edTotals?: { applicants: number | null; admitted: number | null; enrolled: number | null } | null;
  /**
   * U2 addition (list-building.md "Suggested category"): the college's own SAT total and ACT composite middle 50%,
   * when it reports one, for `lib/planner/suggest.ts`'s position check. The citation lives in `cites` (`derived.sat_total`,
   * `admissions.act_composite_25_75`), never a separate field, per model.md's "add fields additively".
   */
  satRange?: [number, number] | null;
  actRange?: [number, number] | null;
  /** Federal application fee (U5, additive): shown with the apply task. */
  applicationFee?: number | null;
  /** Course plan (additive): the college gives credit for AP exams (`admissions.accepts_ap_credit`); cited at `cites["admissions.accepts_ap_credit"]` when true. */
  acceptsApCredit?: boolean | null;
  /**
   * Redesign (additive): the average unweighted first-year GPA (CDS C12, `reported.admission_profile.gpa`), only when
   * the college reports it on a 4.0 unweighted scale; else null. Cited at `cites["reported.admission_profile.gpa.average"]`.
   */
  gpaAverage: number | null;
  /** Redesign: the standing model's inputs for this college (lib/planner/standing.ts), built by planSchoolFor. */
  standing: import("./standing").StandingSchool;
  /**
   * Admission chances, next (carry-forward from wave 1, brief "U7 + U8"): exactly what `comparedWith`
   * (lib/chances/compared-with.ts) needs, so the row drawer can attach the ComparedWith panel (U8) from a plan row
   * without a second dataset read. Built by planSchoolFor from the same School.
   */
  poolSchool: import("../chances/pool-rate").PoolSchool;
}

/* ------------------------------------------------------------------ */
/* Additions (U1, beyond the brief's list; additive)                   */
/* ------------------------------------------------------------------ */

/** What a generator reads: a PlanContext without its tasks, stages, and viewer (generators/index.ts). Pure input. */
export type GeneratorInput = Pick<PlanContext, "list" | "items" | "schools" | "profile" | "cycle" | "grade" | "today" | "visits" | "offers" | "gradYear" | "season" | "estimates">;
/** One generator module's export: pure, no I/O, returns every task it wants to exist right now. */
export type Generator = (input: GeneratorInput) => GeneratedTask[];
