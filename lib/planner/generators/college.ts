/**
 * The `college` generator (U5; specs/planner/timeline.md "Generators"): the six college tasks from the college's own
 * published dates, for the item's round.
 *
 * | Task               | From                                                                  | Due                                   |
 * |--------------------|-----------------------------------------------------------------------|---------------------------------------|
 * | apply              | C21/C22 closing for ED/EA/REA, C14 for RD, the C14 priority date for rolling | the date; the fee and waiver in the detail |
 * | decision_expected  | the round's notification date                                          | informational                         |
 * | aid_forms          | H8 forms, the earliest aid priority date                               | that date, else the application date  |
 * | reply_by           | C17 reply rule                                                         | once admitted                         |
 * | housing_deposit    | C17 housing deposit date, amount, refund rule                          | once enrolling                        |
 * | ed2_conditional    | the ED II college's closing date                                       | "only if {ED I college} isn't a yes"  |
 *
 * Nothing is generated without the data (the college view says so and offers the family's own date). Month/day dates
 * resolve against the student's cycle (lib/list-rules.ts deadlineFor's rule: July and later is the cycle's first year,
 * earlier months its second). Every task names the registered field path and the edition its date came from; a date
 * from an edition older than the student's cycle carries `date_note: "last_cycle"` ("confirm on the college's page").
 *
 * Keys: one per college and kind (`{item}:{kind}:-`), so a round change moves the apply and decision dates and keeps
 * the tick. Pure; no I/O.
 */
import { taskKey } from "../tasks.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool, TaskKind } from "../types.ts";
import type { ListRound } from "../../list-rules.ts";

type Day = { month: number | null; day: number | null } | null | undefined;

/** Short round names for titles ("Apply (ED I)"). */
export const ROUND_SHORT: Record<ListRound, string> = {
  ed: "ED I",
  ed2: "ED II",
  ea: "EA",
  rea: "REA",
  rd: "RD",
  rolling: "rolling",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 1": a date without its year, for text that is stored (a title shouldn't change when the calendar year does). */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** A month/day with no year as a date in the cycle that starts in `startYear` (July on: that year; before: the next). */
export function resolveDay(md: Day, startYear: number): string | null {
  if (!md || md.month == null || md.day == null) return null;
  if (md.month < 1 || md.month > 12 || md.day < 1 || md.day > 31) return null;
  const year = md.month >= 7 ? startYear : startYear + 1;
  const iso = `${year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** A college's dated fact: the date, the field path it came from, and that field's edition. */
export interface CollegeDate {
  date: string;
  field: string;
  edition: string | null;
}

/** The edition behind a field: the resolved citation's CDS edition, else the block's own edition. */
function editionFor(school: PlanSchool, field: string, fallback: string | null | undefined): string | null {
  const cite = school.cites?.[field] as { cdsEdition?: unknown } | undefined;
  if (cite && typeof cite.cdsEdition === "string") return cite.cdsEdition;
  return fallback ?? null;
}

/** Whether an edition ("2025-26" or "2025–26") describes a cycle before the student's. */
export function isLastCycle(edition: string | null, school: Pick<PlanSchool, "cycleStartYear" | "editionIsLastCycle">): boolean {
  const y = edition?.match(/\d{4}/);
  return y ? Number(y[0]) < school.cycleStartYear : school.editionIsLastCycle;
}

function dated(school: PlanSchool, md: Day, field: string, blockEdition: string | null | undefined): CollegeDate | null {
  const date = resolveDay(md, school.cycleStartYear);
  return date ? { date, field, edition: editionFor(school, field, blockEdition) } : null;
}

const ED_FIRST = "reported.admission_profile.early_decision.first";
const ED_OTHER = "reported.admission_profile.early_decision.other";
const EA = "reported.admission_profile.early_action";
const LOGISTICS = "reported.admissions_logistics";

/** The application date for a round (null round: the regular round), from the college's own record. */
export function applyDate(school: PlanSchool, round: ListRound | null): CollegeDate | null {
  const ed = school.profile?.early_decision;
  const ea = school.profile?.early_action;
  const lg = school.logistics;
  const edEdition = lg?.edition;
  switch (round) {
    case "ed":
      return ed?.offered ? dated(school, ed.first?.closing, `${ED_FIRST}.closing`, edEdition) : null;
    case "ed2":
      return ed?.offered ? dated(school, ed.other?.closing, `${ED_OTHER}.closing`, edEdition) : null;
    case "ea":
    case "rea":
      return ea?.offered ? dated(school, ea.closing, `${EA}.closing`, edEdition) : null;
    case "rolling":
      return dated(school, lg?.priority_date, `${LOGISTICS}.priority_date`, lg?.edition);
    default:
      return dated(school, lg?.regular_closing, `${LOGISTICS}.regular_closing`, lg?.edition);
  }
}

/** When the round's decision is expected, from the college's own record; rolling has none. */
export function decisionDate(school: PlanSchool, round: ListRound | null): CollegeDate | null {
  const ed = school.profile?.early_decision;
  const ea = school.profile?.early_action;
  const lg = school.logistics;
  switch (round) {
    case "ed":
      return ed?.offered ? dated(school, ed.first?.notification, `${ED_FIRST}.notification`, lg?.edition) : null;
    case "ed2":
      return ed?.offered ? dated(school, ed.other?.notification, `${ED_OTHER}.notification`, lg?.edition) : null;
    case "ea":
    case "rea":
      return ea?.offered ? dated(school, ea.notification, `${EA}.notification`, lg?.edition) : null;
    case "rolling":
      return null;
    default: {
      const n = lg?.notification;
      if (!n || n.kind === "rolling") return null;
      return dated(school, n.by_date ?? n.other_date, `${LOGISTICS}.notification`, lg?.edition);
    }
  }
}

const FORM_NAMES: [keyof NonNullable<NonNullable<PlanSchool["aid"]>["forms"]>, string][] = [
  ["fafsa", "FAFSA"],
  ["css_profile", "CSS Profile"],
  ["noncustodial_profile", "Noncustodial CSS Profile"],
  ["own_form", "the college's own aid form"],
  ["state_form", "the state aid form"],
  ["business_farm_supplement", "Business/Farm Supplement"],
];

/** The aid forms a college lists (H8), by name; empty when it published none (never "nothing required"). */
export function aidFormNames(school: PlanSchool): string[] {
  const forms = school.aid?.forms;
  if (!forms) return [];
  const names = FORM_NAMES.filter(([k]) => forms[k] === true).map(([, n]) => n);
  if (typeof forms.other === "string" && forms.other.trim()) names.push(forms.other.trim());
  return names;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** The apply task's detail: the fee and the waiver (C13 and the federal fee). Null when neither is published. */
export function feeDetail(school: PlanSchool): string | null {
  const parts: string[] = [];
  const fee = school.applicationFee;
  if (typeof fee === "number") parts.push(fee === 0 ? "No application fee" : `${money(fee)} application fee`);
  const waiver = school.logistics?.fee?.waiver;
  if (waiver === true) parts.push(parts.length ? "fee waivers offered" : "Fee waivers offered");
  else if (waiver === false) parts.push(parts.length ? "no fee waivers" : "No fee waivers");
  return parts.length ? `${parts.join("; ")}.` : null;
}

function task(
  item: PlanItem,
  kind: TaskKind,
  offset: number,
  fields: { title: string; detail: string | null; date: CollegeDate | null; assignee: GeneratedTask["assignee"]; field?: string; edition?: string | null },
  school: PlanSchool,
): GeneratedTask {
  const edition = fields.date?.edition ?? fields.edition ?? null;
  return {
    key: taskKey(item.id, kind),
    item_id: item.id,
    kind,
    title: fields.title.slice(0, 200),
    detail: fields.detail ? fields.detail.slice(0, 1000) : null,
    due_on: fields.date?.date ?? null,
    window_start: null,
    window_end: null,
    assignee: fields.assignee,
    source: "college",
    source_field: fields.date?.field ?? fields.field ?? null,
    source_edition: edition,
    date_note: fields.date && isLastCycle(edition, school) ? "last_cycle" : null,
    position: item.position * 10 + offset,
  };
}

export function generate(input: GeneratorInput): GeneratedTask[] {
  const out: GeneratedTask[] = [];
  const live = input.items.filter((i) => !i.withdrawn_on);
  const edItem = live.find((i) => i.round === "ed");

  for (const item of live) {
    const school = input.schools[item.unit_id];
    if (!school) continue;
    const round = item.round;
    const roundLabel = round ? ` (${ROUND_SHORT[round]})` : "";
    const apply = applyDate(school, round);

    // 1. Apply, or for an ED II college beside an ED I one, the conditional application.
    if (round === "ed2" && edItem && edItem.id !== item.id) {
      if (apply) {
        const edSchool = input.schools[edItem.unit_id];
        const edName = edSchool?.name ?? "your ED I college";
        const expected = edSchool ? decisionDate(edSchool, "ed") : null;
        const title = `Apply ED II, only if ${edName} isn't a yes${expected ? ` (expected ${shortDay(expected.date)})` : ""}`;
        const said =
          edItem.outcome === "admitted"
            ? `${edName} said yes, so you won't need this one.`
            : edItem.outcome
              ? `${edName} didn't say yes, so this one is on.`
              : "If ED I is deferred or denied, this is your binding second choice.";
        const fee = feeDetail(school);
        out.push(task(item, "ed2_conditional", 0, { title, detail: fee ? `${said} ${fee}` : said, date: apply, assignee: "student" }, school));
      }
    } else if (apply) {
      out.push(task(item, "apply", 0, { title: `Apply${roundLabel}`, detail: feeDetail(school), date: apply, assignee: "student" }, school));
    }

    // 2. Decision expected.
    const decision = decisionDate(school, round);
    if (decision) {
      out.push(
        task(
          item,
          "decision_expected",
          1,
          { title: `Decision expected${roundLabel}`, detail: "When it comes, record it on the list: an admit opens the offer steps.", date: decision, assignee: "either" },
          school,
        ),
      );
    }

    // 3. Aid forms: the forms the college lists, by its priority date (else its deadline, else the application date).
    const forms = aidFormNames(school);
    const dates = school.aid?.dates;
    const aidEdition = school.aid?.edition ?? null;
    const priority = dates && typeof dates.priority === "object" ? dated(school, dates.priority, "reported.aid.dates", aidEdition) : null;
    const deadline = dates && typeof dates.deadline === "object" ? dated(school, dates.deadline, "reported.aid.dates", aidEdition) : null;
    const aidDate = [priority, deadline].filter((d): d is CollegeDate => d !== null).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    if (forms.length || aidDate) {
      const title = forms.length ? `Aid forms: ${forms.join(", ")}` : "Aid forms (the college's aid page lists them)";
      const detail = aidDate
        ? priority
          ? "By the college's priority date: aid can run out after it."
          : "By the college's aid deadline."
        : apply
          ? "The college lists no aid date; send them with the application."
          : null;
      out.push(
        task(
          item,
          "aid_forms",
          2,
          { title, detail, date: aidDate ?? apply, assignee: "guardian", field: "reported.aid.forms", edition: aidEdition },
          school,
        ),
      );
    }

    // 4. Reply by, once admitted (C17).
    const reply = school.logistics?.reply;
    if (item.outcome === "admitted" && reply) {
      let date: CollegeDate | null = null;
      let detail = "Deposit at one college, or decline, by this date.";
      const field = `${LOGISTICS}.reply`;
      const edition = editionFor(school, field, school.logistics?.edition);
      if (reply.kind === "fixed_date") {
        const d = resolveDay(reply.date, school.cycleStartYear);
        date = d ? { date: d, field, edition } : null;
      } else if (reply.kind === "may1_or_weeks") {
        const d = resolveDay({ month: 5, day: 1 }, school.cycleStartYear);
        date = d ? { date: d, field, edition } : null;
        if (reply.weeks) detail = `May 1, or ${reply.weeks} weeks after the admit if that's later. ${detail}`;
      }
      if (date) out.push(task(item, "reply_by", 3, { title: "Reply to the offer", detail, date, assignee: "either" }, school));
    }

    // 5. Housing deposit, once enrolling (C17).
    const housing = school.logistics?.housing_deposit;
    if (item.enrolling && housing?.due) {
      const date = dated(school, housing.due, `${LOGISTICS}.housing_deposit`, school.logistics?.edition);
      if (date) {
        const parts: string[] = [];
        if (typeof housing.amount === "number") parts.push(`${money(housing.amount)} deposit`);
        if (housing.refundable === "full") parts.push("refundable");
        else if (housing.refundable === "partial") parts.push("partly refundable");
        else if (housing.refundable === "no") parts.push("not refundable");
        const detail = parts.length ? `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : null;
        out.push(task(item, "housing_deposit", 4, { title: "Housing deposit", detail, date, assignee: "guardian" }, school));
      }
    }
  }
  return out;
}
