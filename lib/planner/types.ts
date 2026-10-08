/**
 * The planner's shared shapes (specs/planner/model.md; the build brief's "Types"). Every row type the planner tables
 * hold (supabase/migrations/20261008120000_planner.sql) and the PlanContext that PlanPage computes once and passes to
 * each stage panel. Types only: safe to import from server code, client components, and tests.
 */

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type StageState = "done" | "open" | "not_yet";
export type Assignee = "student" | "guardian" | "either";
export type TaskSource = "college" | "cycle" | "stage" | "own";
export type TaskKind =
  | "apply" | "decision_expected" | "aid_forms" | "reply_by" | "housing_deposit" | "ed2_conditional"   // college (U5)
  | "cycle"                                                                                            // cycle file entries; key = entry key (U5)
  | "decide_rounds"                                                                                    // U3
  | "follow" | "request_info" | "write_visit_notes"                                                    // U4
  | "fee" | "send_scores" | "transcript" | "recommendation" | "supplement" | "submit" | "portal_setup" | "portal_check"
  | "continued_interest" | "waitlist_accept" | "waitlist_deposit_elsewhere"                            // U6
  | "add_offer" | "deposit" | "withdraw" | "waitlist_decide" | "summer"                                // U7
  | "own";
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
}
export type GeneratedTask = Omit<PlanTask, "id" | "list_id" | "done_at" | "done_by" | "snoozed_until" | "dismissed" | "orphaned" | "created_by" | "created_at"> & { key: string };
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
export interface PlanItemColumns { dream: boolean; priority: number | null; followed_networks: SocialNetwork[]; info_requested_on: string | null; application_platform: "common_app" | "coalition" | "own" | "uc" | "apply_texas" | "other" | null; applied_on: string | null; complete_on: string | null; portal_url: string | null; committed_on: string | null; withdrawn_on: string | null; recommendations_count: number | null; supplements_count: number | null; transcript_shared: boolean }
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
  stages: Record<Stage, { state: StageState; count: string }>;
  current: Stage;
}
/** The college facts stages read, cut from School on the server with citations already resolved
 *  (`citeField` → the serializable Citation the InfoTip takes). U1 defines and fills it; add fields additively. */
export interface PlanSchool { unit_id: string; name: string; city: string | null; state: string | null; brand?: unknown; admitRate: number | null; admitRateCite: unknown; avgCost: number | null; avgCostCite: unknown; sticker: unknown; distanceMiles: number | null; links: import("../types").SchoolLinks | null; social: unknown; profile: import("../types").ReportedAdmissionProfile | null; logistics: import("../types").ReportedLogistics | null; aid: import("../types").ReportedAid | null; testPolicy: unknown; cycleStartYear: number; editionIsLastCycle: boolean; cites: Record<string, unknown> }

/* ------------------------------------------------------------------ */
/* Additions (U1, beyond the brief's list; additive)                   */
/* ------------------------------------------------------------------ */

/** What a generator reads: a PlanContext without its tasks, stages, and viewer (generators/index.ts). Pure input. */
export type GeneratorInput = Pick<PlanContext, "list" | "items" | "schools" | "profile" | "cycle" | "grade" | "today" | "visits" | "offers">;
/** One generator module's export: pure, no I/O, returns every task it wants to exist right now. */
export type Generator = (input: GeneratorInput) => GeneratedTask[];
