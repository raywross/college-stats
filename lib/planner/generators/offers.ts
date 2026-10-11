/**
 * The `offers` generator (U7; specs/planner/offers.md "Recording decisions", "The choice", "After the choice").
 *
 * | Task             | When                                                      | Key                         |
 * |------------------|-----------------------------------------------------------|-----------------------------|
 * | add_offer        | a college said yes (kept while admitted; saving an offer ticks it) | `{item}:add_offer:-`  |
 * | deposit          | the student chose (enrolling + committed_on): by the reply date (C17) | `{chosen}:deposit:-` |
 * | withdraw         | each other admitted or pending college; after an ED admit, every other application, required | `{item}:withdraw:-` |
 * | waitlist_decide  | each waitlisted college (not after an ED admit: those are withdrawn) | `{item}:waitlist_decide:-` |
 * | summer           | the cycle file's `committed` entries, once committed_on is set | `{list}:summer:{entry key}` |
 * | summer (AP)      | "Send your AP scores for credit": the chosen college gives AP credit (`admissions.accepts_ap_credit`) and the student isn't known to have no AP course | `{chosen}:summer:send_ap_scores` |
 *
 * The reply-by and housing-deposit tasks are the college generator's (generators/college.ts): this module doesn't
 * emit them again; the store ticks the reply-by task when the student chooses. Withdraw tasks keep being generated
 * for a college once it's withdrawn, so ticking one (which sets withdrawn_on) doesn't orphan it. A guardian's own list
 * gets nothing here: offers and the choice are the student's. Pure; no I/O.
 */
import { applies } from "../cycle.ts";
import { taskKey } from "../tasks.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool, TaskKind } from "../types.ts";
import { cycleTask } from "./cycle.ts";
import { isLastCycle, resolveDay, shortDay, type CollegeDate } from "./college.ts";

const REPLY_FIELD = "reported.admissions_logistics.reply";

/** The college's reply date (C17) as the college generator resolves it: a fixed date, or May 1 for the May 1 rule. */
export function replyDate(school: PlanSchool): CollegeDate | null {
  const reply = school.logistics?.reply;
  if (!reply) return null;
  const cite = school.cites?.[REPLY_FIELD] as { cdsEdition?: unknown } | undefined;
  const edition = typeof cite?.cdsEdition === "string" ? cite.cdsEdition : (school.logistics?.edition ?? null);
  const date = reply.kind === "fixed_date" ? resolveDay(reply.date, school.cycleStartYear) : reply.kind === "may1_or_weeks" ? resolveDay({ month: 5, day: 1 }, school.cycleStartYear) : null;
  return date ? { date, field: REPLY_FIELD, edition } : null;
}

/** Applied somewhere and still waiting (deferred returns to applied): a pending application. */
export function isPending(item: Pick<PlanItem, "status" | "outcome">): boolean {
  return item.status === "applying" || item.status === "applied";
}

/** The chosen college: enrolling with a commit date. */
export function chosenItem(items: PlanItem[]): PlanItem | null {
  return items.find((i) => i.enrolling && i.committed_on !== null) ?? null;
}

/** Whether the choice was a binding early decision admit (ED I or ED II). */
export function isEdChoice(item: Pick<PlanItem, "round" | "outcome"> | null): boolean {
  return item !== null && item.outcome === "admitted" && (item.round === "ed" || item.round === "ed2");
}

function task(
  item: PlanItem,
  kind: TaskKind,
  offset: number,
  f: { title: string; detail: string | null; date: CollegeDate | null; dueOn?: string | null; assignee: GeneratedTask["assignee"] },
  school: PlanSchool | undefined,
): GeneratedTask {
  return {
    key: taskKey(item.id, kind),
    item_id: item.id,
    kind,
    title: f.title.slice(0, 200),
    detail: f.detail ? f.detail.slice(0, 1000) : null,
    due_on: f.date?.date ?? f.dueOn ?? null,
    window_start: null,
    window_end: null,
    assignee: f.assignee,
    source: f.date ? "college" : "stage",
    source_field: f.date?.field ?? null,
    source_edition: f.date?.edition ?? null,
    date_note: f.date && school && isLastCycle(f.date.edition, school) ? "last_cycle" : null,
    position: item.position * 10 + offset,
  };
}

/** Not known to have no AP course: a list with no AP rows that aren't merely planned says the student took none. */
function mayHaveAp(profile: GeneratorInput["profile"]): boolean {
  const courses = profile?.academics?.courses ?? [];
  return courses.length === 0 || courses.some((c) => c.kind === "ap" && c.status !== "planned");
}

/** "Send your AP scores to {college} for credit": after the scores are out (early July) and the college's credit policy is known. */
function sendApScores(chosen: PlanItem, name: string): GeneratedTask {
  return {
    key: taskKey(chosen.id, "summer", "send_ap_scores"),
    item_id: chosen.id,
    kind: "summer",
    title: `Send your AP scores to ${name} for credit`.slice(0, 200),
    detail: "Your scores come out in early July. Order the score report to the college from your College Board account, and check which scores earn credit or placement on the college's AP credit page.",
    due_on: null,
    window_start: null,
    window_end: null,
    assignee: "student",
    source: "college",
    source_field: "admissions.accepts_ap_credit",
    source_edition: null,
    date_note: null,
    position: chosen.position * 10 + 9,
  };
}

export function generate(input: GeneratorInput): GeneratedTask[] {
  if (input.list.student_id === null) return [];
  const out: GeneratedTask[] = [];
  const name = (i: PlanItem) => input.schools[i.unit_id]?.name ?? "the college";

  // Add the offer, for every college that said yes.
  for (const item of input.items) {
    if (item.outcome !== "admitted") continue;
    out.push(
      task(
        item,
        "add_offer",
        5,
        {
          title: "Add the aid offer",
          detail: "From the award letter or the aid portal: the cost, grants, work-study, and loans, so the offers line up side by side.",
          date: null,
          assignee: "either",
        },
        input.schools[item.unit_id],
      ),
    );
  }

  const chosen = chosenItem(input.items);
  if (!chosen) return out;
  const chosenSchool = input.schools[chosen.unit_id];
  const chosenName = name(chosen);
  const ed = isEdChoice(chosen);

  // Deposit at the chosen college, by its reply date.
  const reply = chosenSchool ? replyDate(chosenSchool) : null;
  out.push(
    task(
      chosen,
      "deposit",
      6,
      {
        title: `Pay the enrollment deposit at ${chosenName}`,
        detail: reply ? `By the reply date (${shortDay(reply.date)}), in the admitted-student portal.` : "In the admitted-student portal, by the reply date in the admission letter.",
        date: reply,
        dueOn: reply ? null : chosen.committed_on,
        assignee: "guardian",
      },
      chosenSchool,
    ),
  );

  // Withdraw the others, and decide on each wait list.
  for (const item of input.items) {
    if (item.id === chosen.id) continue;
    const school = input.schools[item.unit_id];
    const other = name(item);
    if (ed) {
      if (item.outcome === "denied" || !(isPending(item) || item.status === "decided")) continue;
      out.push(
        task(
          item,
          "withdraw",
          7,
          {
            title: `ED is binding: withdraw your application to ${other} now`,
            detail: `${chosenName} was an early decision admit, so every other application comes out: tell ${other} in its portal or by email.`,
            date: null,
            dueOn: chosen.committed_on,
            assignee: "student",
          },
          school,
        ),
      );
      continue;
    }
    if (item.outcome === "admitted") {
      const theirs = school ? replyDate(school) : null;
      out.push(
        task(
          item,
          "withdraw",
          7,
          { title: `Tell ${other} you won't attend`, detail: "It frees a place for someone on the wait list.", date: theirs, dueOn: theirs ? null : chosen.committed_on, assignee: "student" },
          school,
        ),
      );
    } else if (item.outcome === "waitlisted") {
      out.push(
        task(
          item,
          "waitlist_decide",
          8,
          {
            title: `Stay on ${other}'s wait list or withdraw?`,
            detail: `A wait-list offer may come after May 1; taking it would mean forfeiting the deposit at ${chosenName}. The college's wait-list history is beside it on the Offers stage.`,
            date: null,
            assignee: "student",
          },
          school,
        ),
      );
    } else if (isPending(item) && !item.outcome) {
      out.push(
        task(
          item,
          "withdraw",
          7,
          { title: `Withdraw your application to ${other}`, detail: "It frees a place for someone, and the college stops sending decisions you won't use.", date: null, dueOn: chosen.committed_on, assignee: "student" },
          school,
        ),
      );
    }
  }

  // Send the AP scores for credit (course-plan.md "Calendar"), when the chosen college awards it.
  if (chosenSchool?.acceptsApCredit === true && mayHaveAp(input.profile)) out.push(sendApScores(chosen, chosenName));

  // The summer list, from the cycle file.
  const facts = { items: input.items.filter((i) => !i.withdrawn_on), schools: input.schools, profile: input.profile };
  input.cycle.entries.forEach((entry, i) => {
    if (entry.applies !== "committed" || !applies(entry, facts)) return;
    const t = cycleTask(entry, input.list.id, 1000 + i);
    out.push({ ...t, key: taskKey(input.list.id, "summer", entry.key), kind: "summer", item_id: chosen.id, detail: entry.detail ? `${entry.detail}` : null });
  });
  return out;
}
