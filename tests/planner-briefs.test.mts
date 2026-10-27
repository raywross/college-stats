/**
 * Next steps, bringing people back (specs/planner/next-steps/notifications.md; build-plan.md U6): the season brief's
 * schedule (one per turn, the late joiner, the February briefs), defaults by season, what Your week and the brief
 * carry (a skipped move never, a done move once, the parent's part first), no figure in any line, the header dot's
 * new-move rule, the digest's changed-college lines, and the brief's unsubscribe SQL. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRIEF_KEYS,
  briefDue,
  briefSentKey,
  changedCollegeMoves,
  currentBriefTurn,
  dueTomorrow,
  firstSundayOnOrAfter,
  parentSummaryOn,
  scrubNumbers,
  seasonBriefOn,
  yourWeekDefault,
  yourWeekOn,
  yourWeekTasks,
} from "../lib/planner/timeline.ts";
import { briefContent, briefSubject, buildSeasonBrief, firstClause } from "../lib/emails/season-brief.ts";
import { buildYourWeek } from "../lib/emails/your-week.ts";
import { buildParentSummary } from "../lib/emails/parent-summary.ts";
import { hasNewMove } from "../lib/planner/plan-frame.ts";
import { cycleFor, loadCycle } from "../lib/planner/cycle.ts";
import type { ImportanceFacts } from "../lib/planner/importance.ts";
import { SEASONS, type Season } from "../lib/planner/seasons.ts";
import type { PlanTask } from "../lib/planner/types.ts";

const ROOT = join(import.meta.dirname, "..");
const STUDENT = "44444444-4444-4444-8444-444444444444";
/** Class of 2028: junior year 2026–27 (junior spring Mar–May 2027), senior year 2027–28. */
const CLASS = 2028;

let n = 0;
const task = (over: Partial<PlanTask> = {}): PlanTask => ({
  id: `t${++n}`,
  list_id: "L",
  item_id: null,
  key: `L:playbook:k${n}`,
  kind: "playbook",
  title: "A move",
  detail: "Advisors place this here. More words.",
  due_on: null,
  window_start: null,
  window_end: null,
  assignee: "student",
  source: "season",
  source_field: null,
  source_edition: null,
  date_note: null,
  done_at: null,
  done_by: null,
  snoozed_until: null,
  dismissed: false,
  dismissed_at: null,
  dismissed_by: null,
  orphaned: false,
  position: n,
  created_by: null,
  created_at: "2026-09-01T00:00:00Z",
  season: "junior_spring",
  action: null,
  ...over,
});

const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
/** Any figure that isn't the day of a "Nov 1" date. */
const FIGURE = /(?<![A-Z][a-z]{2} )(?<![\d$.,])\$?\d[\d,.]*%?/;
/** The text's lines with the links taken out (a link carries ids, not content). */
const linesOf = (text: string) => text.split("\n").map((l) => l.replace(/https?:\/\/\S+/g, ""));

/* ------------------------------------------------------------------ */
/* The schedule                                                        */
/* ------------------------------------------------------------------ */

test("one brief per season turn: the scheduler run twice sends nothing the second time", () => {
  const sunday = firstSundayOnOrAfter("2027-03-01");
  assert.equal(dow(sunday), 0);
  const sent = new Set<string>();
  const first = briefDue(CLASS, sunday, sent);
  assert.ok(first);
  assert.equal(first.key, "junior_spring");
  assert.equal(first.cycleStart, 2026);
  sent.add(briefSentKey(first));
  assert.equal(briefDue(CLASS, sunday, sent), null, "same Sunday, already sent");
  assert.equal(briefDue(CLASS, "2027-04-18", sent), null, "a later Sunday in the same season");
  const next = briefDue(CLASS, firstSundayOnOrAfter("2027-06-01"), sent);
  assert.equal(next?.key, "summer_before_senior", "the next turn is its own brief");
});

test("the brief waits for the first Sunday on or after the season's start", () => {
  const start = "2027-03-01";
  const sunday = firstSundayOnOrAfter(start);
  if (sunday !== start) assert.equal(briefDue(CLASS, start, new Set()), null, "the season's first day isn't a Sunday: wait");
  assert.ok(briefDue(CLASS, sunday, new Set()));
  assert.equal(firstSundayOnOrAfter("2026-10-11"), "2026-10-11", "a Sunday is its own first Sunday");
});

test("a late joiner gets the current season's brief on their first Sunday, nothing earlier", () => {
  // Joined in late April of junior spring: the junior-spring brief, never the fall or winter ones.
  const turn = briefDue(CLASS, "2027-04-25", new Set());
  assert.equal(turn?.key, "junior_spring");
  assert.equal(turn?.season, "junior_spring");
  // A missed turn isn't sent once the next has started.
  assert.equal(briefDue(CLASS, firstSundayOnOrAfter("2027-08-01"), new Set())?.key, "senior_fall");
});

test("the February briefs: freshman and sophomore year, the first Sunday on or after Feb 1", () => {
  // Class of 2030: freshman 2026–27, sophomore 2027–28.
  const sent = new Set<string>();
  const fall = briefDue(2030, firstSundayOnOrAfter("2026-08-01"), sent);
  assert.equal(fall?.key, "freshman");
  sent.add(briefSentKey(fall!));
  assert.equal(briefDue(2030, "2027-01-31", sent), null, "January: the August brief is the year's");
  const feb = briefDue(2030, firstSundayOnOrAfter("2027-02-01"), sent);
  assert.equal(feb?.key, "freshman_feb");
  assert.equal(feb?.season, "freshman");
  assert.equal(feb?.cycleStart, 2026);
  sent.add(briefSentKey(feb!));
  assert.equal(briefDue(2030, "2027-05-02", sent), null);
  assert.equal(currentBriefTurn(2030, "2028-02-06")?.key, "sophomore_feb");
  // No February brief in junior or senior year: junior winter's is the season's own.
  assert.equal(currentBriefTurn(CLASS, "2027-02-07")?.key, "junior_winter");
  assert.equal(BRIEF_KEYS.length, 12, "at most twelve briefs across high school");
  // Nothing after the summer after, nothing without a class year.
  assert.equal(currentBriefTurn(CLASS, "2028-08-06"), null);
  assert.equal(currentBriefTurn(null, "2027-03-07"), null);
});

test("defaults per season: Your week and the parent summary on from junior spring; the brief on unless turned off", () => {
  const on = new Set<Season>(["junior_spring", "summer_before_senior", "senior_fall", "senior_winter", "senior_spring", "summer_after"]);
  for (const s of SEASONS) {
    assert.equal(yourWeekDefault(s), on.has(s), `Your week, ${s}`);
    assert.equal(parentSummaryOn(null, s), on.has(s), `parent summary, ${s}`);
  }
  assert.equal(yourWeekOn(true, "freshman"), true, "a stored choice wins");
  assert.equal(parentSummaryOn(false, "senior_fall"), false);
  assert.equal(parentSummaryOn(true, "sophomore"), true);
  assert.equal(seasonBriefOn(null), true);
  assert.equal(seasonBriefOn(false), false);
  // The older Grade still reads the same.
  assert.equal(yourWeekDefault("earlier"), false);
});

/* ------------------------------------------------------------------ */
/* What the mail carries                                               */
/* ------------------------------------------------------------------ */

const TODAY = "2027-03-07";
/** R1b (specs/planner/record/ranking.md): a neutral facts fixture (no profile, no list deadlines) for `nowMoves`/
 *  `briefContent`'s importance sort; these tests only check which moves are present, never their relative order. */
const factsFor = (season: Season, today: string, gradYear: number | null = CLASS): ImportanceFacts => ({ season, today, gradYear, profile: null, cycle: loadCycle(cycleFor(gradYear ?? CLASS)), listDeadlines: [] });
const OPTS = { season: "junior_spring" as Season, gradYear: CLASS, today: TODAY, facts: factsFor("junior_spring", TODAY) };

test("a skipped (dismissed) move is never in a brief or a week", () => {
  const skipped = task({ title: "Skipped move", dismissed: true });
  const kept = task({ title: "Kept move" });
  const week = yourWeekTasks([skipped, kept], OPTS);
  const all = [...week.moves, ...week.fresh, ...week.week, ...week.done];
  assert.ok(all.some((t) => t.id === kept.id));
  assert.ok(!all.some((t) => t.id === skipped.id));
  for (const role of ["student", "guardian"] as const) {
    const c = briefContent([skipped, { ...kept, assignee: role === "guardian" ? "guardian" : "student" }], {}, { role, key: "junior_spring", ...OPTS, studentId: STUDENT, firstName: "Maya" });
    const built = buildSeasonBrief(c, { siteUrl: "https://q.example", unsubscribeToken: "t".repeat(40) });
    assert.doesNotMatch(built.text, /Skipped move/, role);
    assert.match(built.text, /Kept move/, role);
  }
});

test("a done move appears once as done in the next Your week, then not", () => {
  const done = task({ title: "Registered for the SAT", done_at: "2027-03-03T15:00:00Z" });
  const open = task({ title: "Open move" });
  const thisSunday = yourWeekTasks([done, open], OPTS);
  assert.deepEqual(thisSunday.done.map((t) => t.id), [done.id]);
  const built = buildYourWeek({
    firstName: "Maya",
    moves: thisSunday.moves.map((t) => ({ title: t.title, when: "this season", who: null, why: firstClause(t.detail) })),
    week: [],
    overdue: null,
    done: thisSunday.done.map((t) => scrubNumbers(t.title)),
    siteUrl: "https://q.example",
    planPath: "/household/s1/plan",
    unsubscribeToken: "t".repeat(40),
  })!;
  assert.match(built.text, /Done: Registered for the SAT/);
  assert.match(built.text, /- Open move: this season\. Advisors place this here/);
  const nextSunday = yourWeekTasks([done, open], { ...OPTS, today: "2027-03-14" });
  assert.deepEqual(nextSunday.done, [], "a week later it's gone");
  // A done move done on the Sunday of the previous run isn't counted twice.
  const edge = task({ done_at: "2027-02-28T10:00:00Z" });
  assert.deepEqual(yourWeekTasks([edge], OPTS).done, []);
});

test("Your week leads with the Now list's first three moves, dated first, then the week without repeats", () => {
  const undated = [task({ title: "U1" }), task({ title: "U2" }), task({ title: "U3" })];
  const soon = task({ title: "Dated soon", due_on: "2027-03-10", source: "cycle", season: null });
  const week = yourWeekTasks([...undated, soon], OPTS);
  assert.equal(week.moves.length, 3);
  assert.equal(week.moves[0].id, soon.id, "dated first");
  assert.ok(!week.week.some((t) => t.id === soon.id), "the week doesn't repeat a move");
  // A new interest move is a line in the next week, never instant.
  const fresh = task({ kind: "show_interest", title: "Show interest", source: "college", created_at: "2027-03-05T00:00:00Z", season: null });
  const withFresh = yourWeekTasks([...undated, task({ title: "U4" }), fresh, soon], OPTS);
  assert.ok(withFresh.moves.some((t) => t.id === fresh.id) || withFresh.fresh.some((t) => t.id === fresh.id));
});

test("no figure in any line: a planted 'SAT 1400' title is scrubbed from the brief, the week, and the summary", () => {
  const planted = task({ title: "Retake the SAT for 1400", detail: "A 1400 opens 30% more colleges. Then more." });
  const c = briefContent([planted], {}, { role: "student", key: "junior_spring", ...OPTS, studentId: STUDENT, firstName: "Maya" });
  const built = buildSeasonBrief(c, { siteUrl: "https://q.example", unsubscribeToken: "t".repeat(40) });
  for (const l of [built.subject, ...linesOf(built.text)]) assert.doesNotMatch(l, FIGURE, l);
  assert.match(built.text, /Retake the SAT for/);
  // The guard catches a figure when scrubbing is skipped (the planted bad case).
  const unscrubbed = buildSeasonBrief({ ...c, moves: [{ ...c.moves[0], title: planted.title }] }, { siteUrl: "https://q.example", unsubscribeToken: "t".repeat(40) });
  assert.ok(linesOf(unscrubbed.text).some((l) => FIGURE.test(l)), "the figure check fails on an unscrubbed title");
  // Every brief turn's fixed text is figure-free too.
  for (const key of BRIEF_KEYS) {
    const season = key === "freshman_feb" ? "freshman" : key === "sophomore_feb" ? "sophomore" : key;
    const b = buildSeasonBrief(briefContent([], {}, { role: "guardian", key, season, gradYear: CLASS, today: TODAY, studentId: STUDENT, firstName: null, facts: factsFor(season, TODAY) }), {
      siteUrl: "https://q.example",
      unsubscribeToken: "t".repeat(40),
    });
    for (const l of [b.subject, ...linesOf(b.text)]) assert.doesNotMatch(l, FIGURE, `${key}: ${l}`);
  }
  // The parent summary, built the way the job builds it (outsideTitle scrubs).
  const summary = buildParentSummary({
    guardianFirstName: null,
    students: [{ studentId: "s", firstName: "Maya", summary: "Building the list", yourPart: [], childMoves: [scrubNumbers(planted.title)], stuckSignals: [], tickedThisWeek: [] }],
    siteUrl: "https://q.example",
    unsubscribeToken: "t".repeat(40),
  })!;
  for (const l of linesOf(summary.text)) assert.doesNotMatch(l, FIGURE, l);
});

test("the parent's brief leads with their part, then the child's top three as read-only lines", () => {
  const mine = task({ title: "Run the net price calculators", assignee: "guardian" });
  const theirs = [task({ title: "Child one" }), task({ title: "Child two" }), task({ title: "Child three" }), task({ title: "Child four" })];
  const c = briefContent([...theirs, mine], {}, { role: "guardian", key: "junior_spring", ...OPTS, studentId: STUDENT, firstName: "Maya" });
  assert.deepEqual(c.moves.map((m) => m.title), ["Run the net price calculators"]);
  assert.deepEqual(c.childMoves, ["Child one", "Child two", "Child three"]);
  const built = buildSeasonBrief(c, { siteUrl: "https://q.example", unsubscribeToken: "t".repeat(40) });
  assert.equal(built.subject, "Maya's junior spring: your part");
  assert.ok(built.text.indexOf("Your part") < built.text.indexOf("Maya's next steps"));
  assert.ok(built.text.indexOf("Run the net price") < built.text.indexOf("Child one"));
  assert.doesNotMatch(built.text, /Child four/);
  // The child's lines carry no link: only the guardian's own part does.
  const childLine = built.text.split("\n").find((l) => l.includes("Child one"))!;
  assert.doesNotMatch(childLine, /https?:/);
  // The student's brief: the moves with links to their cards, the season's lead, next season, the unsubscribe.
  const student = buildSeasonBrief(briefContent([...theirs, mine], {}, { role: "student", key: "junior_spring", ...OPTS, studentId: STUDENT, firstName: "Maya" }), {
    siteUrl: "https://q.example",
    unsubscribeToken: "t".repeat(40),
  });
  assert.equal(student.subject, "Junior spring for Maya");
  assert.match(student.text, /The season advisors call pivotal/);
  assert.match(student.text, new RegExp(`/advisor\\?for=${STUDENT}&tab=next&move=${theirs[0].id}`));
  assert.match(student.text, /Next: the summer before senior year/);
  assert.match(student.unsubscribeHref, /\/unsubscribe\/t+\/season-brief/);
  assert.equal(student.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(briefSubject({ role: "student", key: "freshman_feb", firstName: null }), "Freshman-year February: your advisor");
});

test("the February brief: the course-plan move and the PSAT result line", () => {
  const course = task({ key: "L:playbook:freshman_choose_courses", title: "Choose next year's courses", season: "freshman" });
  const other = task({ title: "Something else", season: "freshman" });
  const c = briefContent([course, other], {}, { role: "student", key: "freshman_feb", season: "freshman", gradYear: 2030, today: "2027-02-07", studentId: STUDENT, firstName: "Ana", facts: factsFor("freshman", "2027-02-07", 2030) });
  assert.deepEqual(c.moves.map((m) => m.title), ["Choose next year's courses"]);
  assert.equal(c.notes.length, 1);
  assert.match(c.notes[0], /PSAT/);
  assert.match(c.lead, /February/);
});

test("firstClause: the why up to its first sentence end", () => {
  assert.equal(firstClause("Spring dates fill up, and registration closes weeks before each one."), "Spring dates fill up, and registration closes weeks before each one");
  assert.equal(firstClause("A practice run on the real format. Only the junior-year PSAT counts."), "A practice run on the real format");
  assert.equal(firstClause(null), null);
});

/* ------------------------------------------------------------------ */
/* The dot, the digest, the day-before text                            */
/* ------------------------------------------------------------------ */

test("the dot lights on a new move and clears on open", () => {
  const old = task({ created_at: "2027-03-01T10:00:00Z" });
  assert.equal(hasNewMove([old], null, TODAY), true, "never opened: an open move is new");
  assert.equal(hasNewMove([old], "2027-03-02T09:00:00Z", TODAY), false, "opened since: cleared");
  const added = task({ created_at: "2027-03-05T10:00:00Z" });
  assert.equal(hasNewMove([old, added], "2027-03-02T09:00:00Z", TODAY), true, "a move added after the open lights it");
  assert.equal(hasNewMove([{ ...added, dismissed: true }], "2027-03-02T09:00:00Z", TODAY), false, "a skipped move doesn't");
  assert.equal(hasNewMove([{ ...added, done_at: "2027-03-06T00:00:00Z" }], "2027-03-02T09:00:00Z", TODAY), false, "nor a done one");
});

test("the digest: a move a college's change created or closed is a line for that college", () => {
  const units = { iA: "100", iB: "200" };
  const created = task({ item_id: "iA", source: "college", season: null, created_at: "2027-03-05T12:00:00Z" });
  const closed = task({ item_id: "iA", source: "college", season: null, orphaned: true });
  const otherCollege = task({ item_id: "iB", source: "college", season: null, created_at: "2027-03-05T12:00:00Z" });
  const before = task({ item_id: "iA", source: "college", season: null, created_at: "2027-02-01T00:00:00Z" });
  const out = changedCollegeMoves([created, closed, otherCollege, before], units, new Set(["100"]), "2027-03-05T00:00:00Z", TODAY);
  assert.deepEqual(out.map((o) => [o.task.id, o.closed]).sort(), [[created.id, false], [closed.id, true]].sort());
});

test("the day-before text covers the ED decide dates", () => {
  const ed = task({ kind: "ed_decide", due_on: "2027-03-08", source: "college", season: null });
  assert.deepEqual(dueTomorrow([ed], TODAY).map((t) => t.id), [ed.id]);
});

/* ------------------------------------------------------------------ */
/* The SQL                                                             */
/* ------------------------------------------------------------------ */

test("the season brief migration: the unsubscribe function and the sent table, service role only", () => {
  const sql = readFileSync(join(ROOT, "supabase", "migrations", "20261014130000_season_brief.sql"), "utf8").replace(/--.*$/gm, "");
  assert.match(sql, /create function public\.unsubscribe_season_brief_by_token\(p_token text\) returns boolean\s+language plpgsql security definer set search_path = ''/);
  assert.match(sql, /if p_token is null or length\(p_token\) < 32 then\s+return false;/);
  assert.match(sql, /update public\.notification_prefs set season_brief = false, updated = now\(\) where unsubscribe_token = p_token;/);
  assert.match(sql, /revoke execute on function public\.unsubscribe_season_brief_by_token\(text\) from public;/);
  assert.match(sql, /grant execute on function public\.unsubscribe_season_brief_by_token\(text\) to anon, authenticated, service_role;/);
  const table = /create table public\.season_briefs_sent \(([\s\S]*?)\n\);/.exec(sql);
  assert.ok(table, "season_briefs_sent");
  for (const col of [/user_id\s+uuid not null references auth\.users/, /student_id\s+uuid not null references public\.students/, /season\s+text not null/, /cycle_start int not null/, /sent_at\s+timestamptz/]) {
    assert.match(table[1], col);
  }
  assert.match(table[1], /primary key \(user_id, student_id, season, cycle_start\)/);
  const keys = [.../check \(season in \(([^)]*)\)\)/.exec(table[1])![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, [...BRIEF_KEYS], "the check lists every brief turn");
  assert.match(sql, /alter table public\.season_briefs_sent enable row level security;/);
  assert.match(sql, /revoke all on public\.season_briefs_sent from anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/, "no policy: service role only");
  // The unsubscribe route calls it.
  const route = readFileSync(join(ROOT, "app", "unsubscribe", "[token]", "season-brief", "route.ts"), "utf8");
  assert.match(route, /rpc\("unsubscribe_season_brief_by_token"/);
});
