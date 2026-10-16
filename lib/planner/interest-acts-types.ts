/**
 * The act-tracking vocabulary (specs/planner/v3/guides/show-interest.md; build-plan.md "Act tracking"): the acts a
 * guide's button can record and the states a recorded act moves through. Types only (plus the two lists), so the
 * migration's test (tests/planner-plan-v3-migration.test.mts) can hold the table's check lists equal to them and U4's
 * `lib/planner/interest-acts.ts` can import them without pulling in anything else.
 */
import type { SocialNetwork } from "./types.ts";

export const INTEREST_ACTS = ["tour", "info_session", "open_house", "fair", "event", "info_request", "mailing_list", "follow", "test_register"] as const;
export type InterestAct = (typeof INTEREST_ACTS)[number];

export const ACT_STATUSES = ["pending", "confirmed", "declined", "expired"] as const;
export type ActStatus = (typeof ACT_STATUSES)[number];

export const ACT_RESOLVED_VIA = ["prompt", "email", "manual"] as const;
export type ActResolvedVia = (typeof ACT_RESOLVED_VIA)[number];

/** One `plan_interest_acts` row (supabase/migrations/20261016120000_plan_v3.sql). */
export interface InterestActRow {
  id: string;
  /** The list item (college); null for a test registration. */
  item_id: string | null;
  user_id: string;
  act: InterestAct;
  network: SocialNetwork | null;
  url: string;
  event_id: string | null;
  event_starts_at: string | null;
  event_place: string | null;
  event_title: string | null;
  clicked_at: string;
  prompted_at: string | null;
  emailed_at: string | null;
  status: ActStatus;
  resolved_at: string | null;
  resolved_via: ActResolvedVia | null;
  visit_id: string | null;
  confirm_token: string;
}
