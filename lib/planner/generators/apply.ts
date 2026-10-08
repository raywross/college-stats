/**
 * The `apply` generator (U6; specs/planner/applications.md "Sub-tasks"): the application sub-tasks (fee, test
 * scores, transcript, recommendations, supplements, submit, portal setup), the weekly portal check, and the
 * deferral and wait-list follow-ups. Pure; no I/O.
 *
 * Sub-tasks are generated once a college is `applying` or later (not `considering`); the transcript request is one
 * shared task by default (`transcript_shared !== false` on the item), or one per college when the student turned
 * that off. Common App colleges share the main personal essay (one shared `supplement` task). The portal check
 * (`portal_check`) runs weekly from `applied_on` until `complete_on`: each week is its own key (`{item}:portal_check:
 * {n}`), so a completed week's task is replaced by the next week's rather than reopened (timeline.md's merge never
 * resets `done_at`). Deferral (`continued_interest`, plus the ED II pointer only when an ED II college exists) and
 * wait-list tasks (`waitlist_accept`, `waitlist_deposit_elsewhere`, `continued_interest`) are generated only once the
 * outcome is recorded — nothing speculative (applications.md "Rules").
 */
import { addDays } from "../stage.ts";
import { taskKey } from "../tasks.ts";
import { testPolicyAnswer } from "../requirements.ts";
import { applyDate, feeDetail, ROUND_SHORT, shortDay } from "./college.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool, TaskKind } from "../types.ts";

const MAX_SUBITEMS = 12;

function sharedTask(listId: string, kind: TaskKind, suffix: string | null, fields: { title: string; detail: string | null; assignee: GeneratedTask["assignee"] }, position: number): GeneratedTask {
  return {
    key: taskKey(listId, kind, suffix),
    item_id: null,
    kind,
    title: fields.title.slice(0, 200),
    detail: fields.detail ? fields.detail.slice(0, 1000) : null,
    due_on: null,
    window_start: null,
    window_end: null,
    assignee: fields.assignee,
    source: "stage",
    source_field: null,
    source_edition: null,
    date_note: null,
    position,
  };
}

function itemTask(
  item: PlanItem,
  kind: TaskKind,
  suffix: string | number | null,
  fields: { title: string; detail: string | null; assignee: GeneratedTask["assignee"]; due_on?: string | null },
  offset: number,
): GeneratedTask {
  return {
    key: taskKey(item.id, kind, suffix),
    item_id: item.id,
    kind,
    title: fields.title.slice(0, 200),
    detail: fields.detail ? fields.detail.slice(0, 1000) : null,
    due_on: fields.due_on ?? null,
    window_start: null,
    window_end: null,
    assignee: fields.assignee,
    source: "stage",
    source_field: null,
    source_edition: null,
    date_note: null,
    position: item.position * 100 + offset,
  };
}

/** The send-scores sub-task's title: the policy decides the wording (applications.md "Sub-tasks", #2). */
function sendScoresTitle(school: PlanSchool): string {
  switch (testPolicyAnswer(school.testPolicy)) {
    case "required":
      return "Send your test scores";
    case "required-some":
      return "Check whether you must send scores";
    case "recommended":
    case "considered":
      return "Decide whether to send your test scores";
    case "not-considered":
      return "No test scores to send: this college is test-blind";
    default:
      return "Confirm this college's test policy";
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

export function generate(input: GeneratorInput): GeneratedTask[] {
  const out: GeneratedTask[] = [];
  const live = input.items.filter((i) => !i.withdrawn_on);
  const inProgress = live.filter((i) => i.status !== "considering");

  // Transcript: one shared task by default, across every college that hasn't switched to its own (applications.md
  // "Open questions" #2: shared by default, "per college" as a switch).
  const sharedTranscript = inProgress.filter((i) => i.transcript_shared !== false);
  if (sharedTranscript.length > 0) {
    out.push(
      sharedTask(
        input.list.id,
        "transcript",
        null,
        {
          title: "Ask the high school to send transcripts",
          detail: `Shared across ${sharedTranscript.length} college${sharedTranscript.length === 1 ? "" : "s"}; a college you asked to request separately shows its own card instead.`,
          assignee: "guardian",
        },
        0,
      ),
    );
  }

  // Common App colleges share the main personal essay (applications.md "Display").
  const commonApp = inProgress.filter((i) => i.application_platform === "common_app");
  if (commonApp.length > 0) {
    out.push(
      sharedTask(
        input.list.id,
        "supplement",
        "essay",
        {
          title: "Write the Common App personal essay",
          detail: `Shared across ${commonApp.length} Common App college${commonApp.length === 1 ? "" : "s"}.`,
          assignee: "student",
        },
        1,
      ),
    );
  }

  for (const item of inProgress) {
    const school = input.schools[item.unit_id];
    if (!school) continue;
    let offset = 0;

    // 1. Fee or waiver.
    const fee = feeDetail(school);
    const waiverEligible = input.profile?.basics.feeWaiverEligible === true;
    out.push(
      itemTask(
        item,
        "fee",
        null,
        {
          title: waiverEligible ? "Apply for a fee waiver" : "Pay the application fee",
          detail: [fee, waiverEligible ? "You said you're eligible for a waiver." : null].filter((p): p is string => Boolean(p)).join(" ") || null,
          assignee: "either",
        },
        offset++,
      ),
    );

    // 2. Test scores: send or don't.
    out.push(itemTask(item, "send_scores", null, { title: sendScoresTitle(school), detail: null, assignee: "student" }, offset++));

    // 3. Transcript, per college only when the student turned the shared default off.
    if (item.transcript_shared === false) {
      out.push(itemTask(item, "transcript", null, { title: `Ask the high school to send a transcript to ${school.name}`, detail: null, assignee: "guardian" }, offset++));
    }

    // 4. Recommendations, the student's own count.
    const recs = Math.min(item.recommendations_count ?? 0, MAX_SUBITEMS);
    for (let n = 1; n <= recs; n++) {
      out.push(itemTask(item, "recommendation", n, { title: `Recommendation ${n} of ${recs}`, detail: "Ask, then confirm it's submitted. Names stay in your own notes.", assignee: "student" }, offset++));
    }

    // 5. Supplements, the student's own count (the Common App essay above is shared, not counted here).
    const supps = Math.min(item.supplements_count ?? 0, MAX_SUBITEMS);
    for (let n = 1; n <= supps; n++) {
      out.push(itemTask(item, "supplement", n, { title: `Supplement ${n} of ${supps}`, detail: null, assignee: "student" }, offset++));
    }

    // 6. Submit (ties to applied_on: store-apply.ts markApplied ticks the matching apply task, not this one).
    out.push(itemTask(item, "submit", null, { title: "Submit the application", detail: null, assignee: "student" }, offset++));

    // 8. Portal set up, then checked weekly until complete.
    out.push(itemTask(item, "portal_setup", null, { title: `Set up ${school.name}'s applicant portal`, detail: "A link only; the site never stores a login.", assignee: "student" }, offset++));

    if (item.applied_on && !item.complete_on) {
      const weekIndex = Math.max(0, Math.floor(daysBetween(item.applied_on, input.today) / 7));
      out.push(
        itemTask(
          item,
          "portal_check",
          weekIndex,
          {
            title: `Check ${school.name}'s portal`,
            detail: "Confirm what's showing is complete; the site never logs in for you.",
            assignee: "student",
            due_on: addDays(item.applied_on, (weekIndex + 1) * 7),
          },
          offset++,
        ),
      );
    }

    // Deferred: the follow-ups, only once the outcome is recorded (applications.md "Status per college").
    if (item.outcome === "deferred") {
      out.push(
        itemTask(
          item,
          "continued_interest",
          null,
          {
            title: `Send ${school.name} a short update if they accept one`,
            detail: "A letter of continued interest: new grades, an award, or why you're still in. Optional unless the college asks for one.",
            assignee: "student",
          },
          offset++,
        ),
      );
      if (item.round === "ed") {
        const ed2 = live.find((i) => i.id !== item.id && i.round === "ed2");
        if (ed2) {
          const ed2School = input.schools[ed2.unit_id];
          const ed2Apply = ed2School ? applyDate(ed2School, "ed2") : null;
          const where = ed2School ? `${ed2School.name}${ed2Apply ? `, due ${shortDay(ed2Apply.date)}` : ""}` : `your ${ROUND_SHORT.ed2} college`;
          out.push(
            itemTask(
              item,
              "continued_interest",
              "ed2",
              { title: `You're released from the ED commitment; ED II at ${where}`, detail: null, assignee: "student" },
              offset++,
            ),
          );
        }
      }
    }

    // Waitlisted: the follow-ups, only once recorded.
    if (item.outcome === "waitlisted") {
      out.push(
        itemTask(item, "waitlist_accept", null, { title: `Accept your place on ${school.name}'s wait list`, detail: "By the date in the letter; add your own date once you know it.", assignee: "student" }, offset++),
      );
      out.push(
        itemTask(item, "waitlist_deposit_elsewhere", null, { title: "Deposit somewhere else by May 1", detail: "A wait list is not an offer: hold your place at a college that admitted you.", assignee: "either" }, offset++),
      );
      out.push(
        itemTask(
          item,
          "continued_interest",
          "waitlist",
          { title: `Send ${school.name} a short update if they accept one`, detail: "A letter of continued interest can help off a wait list.", assignee: "student" },
          offset++,
        ),
      );
    }
  }
  return out;
}
