/**
 * The console's own glossary (specs/product/admin-redesign.md "Info icons and the Help page"). Every panel title, page
 * title, and status chip that isn't plain English carries a `help` key from here: the (i) icon beside it
 * (components/admin/HelpTip.tsx) shows `title`, `short`, and `do` ("What you can do here"), with "More" opening
 * /admin/help#<key>, which lists every entry by door with its `long` text. The public glossary (lib/glossary.ts) stays
 * separate: these are the console's words, for admins.
 *
 * Pure (no imports but a type), so pages, client components, and tests share it. Keys are kebab-case; each unit of a
 * build adds the entries its screens need. tests/admin-console.test.mts holds every `<Panel` and `<PageHeader` under
 * app/admin to a key that exists here.
 */

/** The door a help entry belongs to on /admin/help (the same four keys as lib/admin/console.ts `AdminDoorKey`). */
export type HelpDoor = "steward" | "people" | "data" | "more";

export interface HelpEntry {
  /** The word or the panel's name, as the pop-over's title. */
  title: string;
  /** Two or three sentences: what it is, where it comes from. */
  short: string;
  /** The longer note on /admin/help. */
  long?: string;
  /** What the admin can do here, one sentence ("What you can do here"). */
  do?: string;
  /** The spec section for the curious: "specs/...md#anchor", linked on GitHub. */
  see?: string;
  /** Where /admin/help lists it; entries without one are listed under "Everywhere". */
  door?: HelpDoor;
}

export const HELP = {
  /* ---------------------------------------------------------------- */
  /* Steward                                                          */
  /* ---------------------------------------------------------------- */
  inbox: {
    title: "Inbox",
    short: "The console's home: what needs a person, in order of consequence, then what the Steward did, then how things are.",
    long: "Needs you lists decisions waiting, open proposals (systemic first), To do rows by reach, jobs whose last run failed, accounts being deleted inside the 30 days, invitations waiting past a week, and held changes. Each row has one action. The Steward did lists its last runs. How things are is six tiles, each a link into its door.",
    do: "Open the row's action; the rest of the page is for reading.",
    see: "specs/product/admin-redesign.md#the-home-steward--inbox",
    door: "steward",
  },
  "needs-you": {
    title: "Needs you",
    short: "Everything that waits on a person, the most consequential first, then the oldest.",
    long: "Read from what exists: the Steward's decisions, proposals and To do rows; each job's last run; accounts being deleted; invitations nobody accepted; held changes. Nothing here is computed by a model.",
    do: "Press the row's button to open the page where it is decided.",
    door: "steward",
  },
  "steward-did": {
    title: "The Steward did",
    short: "The Steward's last run of each kind, with what it spent and what it wrote.",
    do: "Open Runs for every run and the week's spending.",
    door: "steward",
  },
  "how-things-are": {
    title: "How things are",
    short: "Six numbers that say whether the site is healthy: the live version, the review queue, data health, jobs, people, and the Steward's spending.",
    do: "Each tile opens the screen it comes from.",
    door: "steward",
  },
  steward: {
    title: "The Data Steward",
    short: "An agent that reads the review queue, checks values against the colleges' own documents, and writes findings, proposals, To do rows, decisions, and audits for a person. It changes nothing on the site by itself.",
    long: "It runs after each college-reported run that read something, weekly for an audit, and when an admin asks. Every run stops at its budget and at $40 a week in all.",
    see: "specs/product/data-steward.md",
    door: "steward",
  },
  finding: {
    title: "Finding",
    short: "Something the Steward found: a group of held values that share a cause, with its guess at why and what it checked.",
    long: "A finding is one cause (a college, an edition, and a field code, or a pattern across colleges) and every review item it covers. Its kind says what sort of problem it is: a wrong value, a systemic reader problem, a document nobody has, or a policy question.",
    do: "Leave it with a reason, or ask the Steward to look again.",
    see: "specs/product/data-steward.md",
    door: "steward",
  },
  cause: {
    title: "Cause",
    short: "What a group of held values has in common: the college, the Common Data Set edition, and the field code, or a pattern the Steward named.",
    long: "Under Details the cause's key is shown as the code stores it (unit|edition|code); on screen it is the college's name, the edition, and the field's name.",
    door: "steward",
  },
  proposal: {
    title: "Proposal",
    short: "A change the Steward wants to make, with its evidence. Nothing happens until a person approves it.",
    long: "A value proposal sets one college's values from a document; a systemic proposal changes how a reader or a check works for every college. Systemic proposals come first.",
    do: "Approve, decline, or ask the Steward a question about it.",
    door: "steward",
  },
  "proposal-value": {
    title: "Value proposal",
    short: "Sets specific values at specific colleges, each row quoting the document it was read from.",
    do: "Tick the rows you agree with and approve them.",
    door: "steward",
  },
  "proposal-systemic": {
    title: "Systemic proposal",
    short: "Changes a reader or a check for every college at once, with a sample of what it would publish and how to undo it.",
    do: "Read the sample and the undo note before you approve.",
    door: "steward",
  },
  "to-do": {
    title: "To do",
    short: "Documents only a person can fetch: a site that blocks robots, a login wall, a file nobody has found yet. Highest reach first.",
    do: "Mark Found with the document's address, No document, or Done.",
    door: "steward",
  },
  reach: {
    title: "Reach",
    short: "How many colleges or schools a document covers, and how many families want it; the To do list is sorted by it.",
    door: "steward",
  },
  decision: {
    title: "Decision",
    short: "A policy question the Steward can't answer by itself, with its recommendation and what each answer changes.",
    do: "Pick an answer; the Steward follows it from its next run.",
    door: "steward",
  },
  audit: {
    title: "Audit",
    short: "The weekly check of values already published: a sample of one check family read again against the documents, and how many were wrong.",
    do: "Open a college's Review page to fix what an audit found.",
    door: "steward",
  },
  "steward-runs": {
    title: "Steward runs",
    short: "Every run of the Steward: what kind, what it cost against its budget, and what it wrote.",
    long: "A run groups the queue and checks causes; an audit reads published values again; apply and answer runs carry out an approved proposal or answer a question. The week's total is held to $40.",
    door: "steward",
  },
  job: {
    title: "Job",
    short: "A batch task the site runs on a schedule or by hand: an email digest, a data pipeline, the publisher.",
    long: "Vercel jobs are routes Vercel Cron calls; GitHub jobs are workflows in GitHub Actions. Each job's page has its schedule, its history, and Run now when the console can start it.",
    do: "Open a job for its history, or start it with Run now.",
    see: "specs/product/admin-jobs.md",
    door: "steward",
  },
  "jobs-status": {
    title: "Status of the last runs",
    short: "How every job's last run ended, counted: failed, running, never run, nothing to do, succeeded. A job whose last run failed is named here.",
    do: "Open a failed job for its run and the Steward's reading of it.",
    see: "specs/product/admin-jobs.md",
    door: "steward",
  },
  "all-jobs": {
    title: "All jobs",
    short: "Every job in one table, failed last runs first, then running, never run, nothing to do, succeeded.",
    do: "Open a job for its schedule, history, and Run now.",
    see: "specs/product/admin-jobs.md",
    door: "steward",
  },
  "jobs-scheduled": {
    title: "Scheduled",
    short: "The jobs that run on a schedule (Vercel Cron or a GitHub workflow's timer), soonest next run first.",
    do: "Check that each next run is when you expect; open a job for its history.",
    see: "specs/product/admin-jobs.md",
    door: "steward",
  },
  "jobs-by-hand": {
    title: "Run by hand",
    short: "Workflows with no schedule: they run only when a person starts them, with Run now on the job's page or on GitHub.",
    do: "Open a job to start it.",
    see: "specs/product/admin-jobs.md",
    door: "steward",
  },
  "job-history": {
    title: "History",
    short: "This job's last runs, newest first: when each started, how long it took, how it ended, and what started it.",
    do: "Open a run for what it did and the Steward's reading of it.",
    see: "specs/product/admin-jobs.md",
    door: "steward",
  },
  run: {
    title: "Run",
    short: "One firing of a job: when it started, how long it took, how it ended, and what it wrote.",
    door: "steward",
  },
  trigger: {
    title: "Trigger",
    short: "What started a run: its schedule, a person (by hand or from the console), or another workflow finishing.",
    door: "steward",
  },
  "housekeeping-run": {
    title: "Housekeeping run",
    short: "A frequent firing that usually does nothing, like the half-hourly collect that exits when no batch is open. Hidden from a job's history unless you ask.",
    door: "steward",
  },
  "run-now": {
    title: "Run now",
    short: "Starts the job's workflow on GitHub with the inputs you fill in. Logged before it is sent.",
    long: "When a run of the same workflow is already queued or running, the form is replaced by a link to that run, so two runs never overlap. A full college-reported run shows what the last one cost.",
    do: "Fill the inputs and press the button; the run appears in History within a minute.",
    door: "steward",
  },
  review: {
    title: "Job review",
    short: "After every job's run, the Steward reads its record (how it ended, how long it took, what it did and wrote) and compares it with what the job is expected to do.",
    long: "A Vercel job's run is reviewed from its recorded row; a GitHub job's from the workflow run, its steps, and the changes it wrote. A run that looks wrong gets a one-sentence note from a small model (at most $0.10 a run and $3 a week) and a finding under Findings, kind Job. The half-hourly collect that finds nothing isn't reviewed.",
    do: "Open a flagged or failed run for the reasons; the Inbox lists them under Needs you.",
    see: "specs/product/admin-redesign.md#what-the-steward-reviews-after-this-spec",
    door: "steward",
  },
  verdict: {
    title: "The Steward's reading",
    short: "What the Steward made of a run: Looked fine, Flagged (it ran but something is off: too long, did nothing it should have, a held change), or Failed.",
    do: "A flagged or failed run's note says what to look at first.",
    door: "steward",
  },
  repair: {
    title: "Repair",
    short: "The one fix the Steward may make itself: start a failed job again (only a job safe to repeat, once a day), ask the publisher for a version when a change wasn't published, or leave a finding on a held change.",
    long: "Never the college-reported pipeline, which spends money, and never anything else: every other change is a proposal for you. Each repair is noted on the Steward's change and shown with the run.",
    door: "steward",
  },
  expectation: {
    title: "What the Steward expects",
    short: "How a good run of this job looks: how long it usually takes, what a scheduled run should show work in, whether it writes a change, and when doing nothing is right.",
    do: "If a job's normal changed, the expectations are changed in the code, beside the job's schedule.",
    door: "steward",
  },
  "pull-requests": {
    title: "Pull requests",
    short: "Code changes are reviewed on GitHub, not in the console. Data arrives without a pull request.",
    door: "steward",
  },

  /* ---------------------------------------------------------------- */
  /* People                                                           */
  /* ---------------------------------------------------------------- */
  people: {
    title: "People",
    short: "Every account and student record, searchable by name, email, or id. Opening a student's data is logged, and the student sees “Quad support viewed your information”.",
    do: "Search, then open a person or a student record.",
    see: "specs/product/admin.md",
    door: "people",
  },
  person: {
    title: "A person",
    short: "One account: its sign-in, its households, its student records, and every action an admin can take on it.",
    door: "people",
  },
  household: {
    title: "Household",
    short: "A family: its members as the family sees them, and invitations still waiting.",
    do: "Rename it, add or remove someone, cancel an invitation, or close it.",
    door: "people",
  },
  organization: {
    title: "Organization",
    short: "A counselor or a school running a caseload of students, with its members, its join code, and the asks it sent.",
    see: "specs/product/counselor-portal.md",
    door: "people",
  },
  "student-record": {
    title: "Student record",
    short: "A student's numbers, list, and plan. It belongs to the student's account, or to a parent until the student has one.",
    door: "people",
  },
  seat: {
    title: "Seat",
    short: "A place in a household. Every member and every unexpired invitation takes one; a household has six.",
    door: "people",
  },
  "managed-record": {
    title: "Managed record",
    short: "A student record a parent made for a student who has no account yet. It is handed over when the student accepts an invitation.",
    door: "people",
  },
  "role-hint": {
    title: "Role hint",
    short: "What a person said they are when they signed up (student, parent, counselor). It shapes the words they see, not what they can do.",
    door: "people",
  },
  "join-code": {
    title: "Join code",
    short: "The code a student types to join an organization's caseload. Never a secret on its own: joining is the student's choice.",
    door: "people",
  },
  ask: {
    title: "Ask",
    short: "A counselor's request to a student for something missing (a score, a list). Limited to one open ask per section and three a week.",
    door: "people",
  },
  "second-factor": {
    title: "Second factor",
    short: "The 6-digit code from an authenticator app the console asks for at each sign-in, because it can read every family's information.",
    long: "To replace the authenticator app, remove the factor from the account in the Supabase dashboard (Authentication, Users, the admin's row, Multi-factor), then open the console again and set up the new one.",
    do: "Replace your authenticator with the Supabase step written here.",
    door: "people",
  },
  paused: {
    title: "Paused",
    short: "A deactivated account: the person can't sign in until an admin reactivates it. Nothing is deleted.",
    door: "people",
  },
  deleting: {
    title: "Being deleted",
    short: "An account deleted by its owner or an admin. It is removed for good 30 days later unless it is restored first.",
    do: "Restore it from the person's page before the date.",
    door: "people",
  },
  invitation: {
    title: "Invitation",
    short: "An email asking someone to join a household. It holds a seat until it is accepted, cancelled, or expires.",
    door: "people",
  },
  "access-log": {
    title: "Who viewed their data",
    short: "Every time an admin opened this person's or this student's data. The family sees a line saying “Quad support viewed your information”.",
    door: "people",
  },
  "views-log": {
    title: "Views",
    short: "Which colleges' pages this person or college was viewed on, counted from the site's own events.",
    door: "people",
  },

  /* ---------------------------------------------------------------- */
  /* Data                                                             */
  /* ---------------------------------------------------------------- */
  data: {
    title: "Data",
    short: "What the site holds, including what it hides: colleges, their health, selectivity, essays, the reference documents, every change, and the published versions.",
    door: "data",
  },
  "published-version": {
    title: "Published version",
    short: "One composed copy of the whole college dataset. Visitors see the live version; each publish makes a new one from every change applied so far.",
    long: "A published version is what the code calls a snapshot. Making an earlier version live undoes a whole publish at once; to undo one change instead, use Undo this change on the change's page.",
    do: "Publish now, or make an earlier version the live one.",
    see: "specs/data-platform/publish.md",
    door: "data",
  },
  "live-version": {
    title: "Live version",
    short: "The published version each copy of the site serves right now, read from the site itself.",
    door: "data",
  },
  "publish-now": {
    title: "Publish now",
    short: "Composes a new published version from every change applied so far and makes it live. A held change stops every publish.",
    door: "data",
  },
  change: {
    title: "Change",
    short: "A set of edits to the data, from a pipeline run or a person, recorded with what it touched. The next publish carries every applied change.",
    long: "A change is what the code calls a change set. Its report lists the counts and checks the run wrote. Undo this change restores the documents it touched to their earlier versions.",
    do: "Open a change for its report and the documents it touched; undo it there.",
    see: "specs/data-platform/change-sets.md",
    door: "data",
  },
  held: {
    title: "Held",
    short: "Kept back for a person. A held change stops every publish until it is released or undone; a held value waits on the college's Review page.",
    do: "Open the change, read its report, and release it or undo it.",
    door: "data",
  },
  "undo-change": {
    title: "Undo this change",
    short: "Restores every document the change touched to the version before it. The next publish carries the undo.",
    long: "To undo a whole publish rather than one change, make an earlier published version live instead.",
    door: "data",
  },
  "make-live": {
    title: "Make this the live version",
    short: "Points the site back at an earlier published version, at once. The changes since it stay recorded and come back with the next publish.",
    long: "To undo one change rather than a whole publish, use Undo this change on the change's page.",
    door: "data",
  },
  "review-item": {
    title: "Review item",
    short: "A value the automatic checks held back for a person: what the document says, which check it failed, and the Steward's reading.",
    do: "Accept the value, reject it, or leave it for later on the college's Review page.",
    door: "data",
  },
  "review-page": {
    title: "A college's Review page",
    short: "Everything pending for one college: its To do rows, its held values, and the Steward's proposal rows, grouped by field.",
    do: "Accept, reject, or leave each row; approve or decline a proposal's rows.",
    door: "data",
  },
  edition: {
    title: "Edition",
    short: "The year a Common Data Set describes, written as its two academic years. A value is read from one edition of one college's document.",
    door: "data",
  },
  "field-code": {
    title: "Field code",
    short: "The Common Data Set's own number for a question, like C7 (the factors in an admission decision). The console names the field beside the code.",
    door: "data",
  },
  "hidden-value": {
    title: "Hidden value",
    short: "A value the site computes or stores but never shows a visitor: a derived field, the inputs to a model, a value held back.",
    door: "data",
  },
  colleges: {
    title: "Colleges",
    short: "Every college in the dataset: its page as an admin sees it, with the hidden values, its data health, its selectivity, and its edits.",
    do: "Search for a college, or open one of the most viewed.",
    door: "data",
  },
  college: {
    title: "A college",
    short: "One college as the console sees it: what the site shows, what it hides, how fresh its data is, and what is pending.",
    door: "data",
  },
  "edit-field": {
    title: "Edit",
    short: "An admin's edit to one field of a college, with a note saying why. It is a change like any other, and the next publish carries it.",
    door: "data",
  },
  "college-gpa": {
    title: "GPA",
    short: "The GPA figures the site holds for this college and what the admission estimate reads from them. Hidden from visitors, who see only the reported average.",
    door: "data",
  },
  "follower-emails": {
    title: "Follower emails",
    short: "When a publish changes a college's public selectivity tier, the families following it hear about it in the update email. A method change never sends one.",
    door: "data",
  },
  "selectivity-pool": {
    title: "Selectivity pool",
    short: "Which applicants a selectivity score describes: all applicants, in-state, or out-of-state. A public college can sit in a different tier for each.",
    door: "data",
  },
  percentile: {
    title: "Percentile",
    short: "The share of reporting colleges this one is harder to get into than.",
    door: "data",
  },
  reading: {
    title: "Reading",
    short: "How far a college's value sits from the reporters' mean, in standard deviations.",
    door: "data",
  },
  evidence: {
    title: "Evidence",
    short: "How much of a selectivity score rests on reported values; a college with few reported values is pulled toward the middle.",
    door: "data",
  },
  "data-health": {
    title: "Data health",
    short: "How fresh each college's data is: every input it needs, the year it describes, and whether it is current.",
    long: "Fresh: it describes the current cycle. Watch: one cycle old. Stale: older than that. Failing: the last read failed or the value is missing.",
    do: "Filter by status or group, then open a college.",
    see: "specs/product/admin-health-views.md",
    door: "data",
  },
  "health-fresh": { title: "Fresh", short: "Describes the current cycle.", door: "data" },
  "health-watch": { title: "Watch", short: "One cycle old: due for a new read soon.", door: "data" },
  "health-stale": { title: "Stale", short: "Older than one cycle: the site shows an old value.", door: "data" },
  "health-failing": { title: "Failing", short: "The last read failed, or the value is missing where the site needs one.", door: "data" },
  "core-input": {
    title: "Core input",
    short: "A fact the admission estimate can't do without, like the admit rate or the test-score middle.",
    door: "data",
  },
  "supporting-input": {
    title: "Supporting input",
    short: "A fact the admission estimate uses when it has it, and does without when it doesn't.",
    door: "data",
  },
  sources: {
    title: "Sources",
    short: "Every file the dataset is built from, with the year it describes and when it was published, then each college's own documents.",
    door: "data",
  },
  selectivity: {
    title: "Selectivity",
    short: "How each college's selectivity tier moved over recent publishes, the biggest movers, and the tier counts per pool.",
    door: "data",
  },
  essays: {
    title: "Essays",
    short: "The essay questions each college asks, read from its site or by hand from the application form, and the ones held for a person.",
    door: "data",
  },
  "hand-read": {
    title: "Hand read",
    short: "A person read a college's questions inside the application form and typed them in. A hand read wins over anything read from the college's site.",
    door: "data",
  },
  cycle: {
    title: "Cycle",
    short: "The application year the questions or dates belong to, written as its two academic years. A new cycle opens each August.",
    door: "data",
  },
  "reference-document": {
    title: "Reference document",
    short: "A small table the site reads at run time (aid policies, state laws, the release calendar). Every save is a new version you can restore.",
    do: "Edit it, check it, save it; restore an earlier version if needed.",
    door: "data",
  },
  "high-school": {
    title: "A high school",
    short: "One high school's record as the site holds it, with the courses the plan lists and the ones below the line.",
    door: "data",
  },
  /* Added by Unit 4 (Data): the words the Data screens still used without an explanation. */
  "selectivity-tier": {
    title: "Selectivity tier",
    short: "How hard a college is to get into, from Ultra selective to Open, worked out from its admit rate, test scores, yield, retention, and graduation rate. Visitors see the tier; the score and its parts stay here.",
    long: "The panel leads with the tier and the reported figures that weigh most in it. Details holds the score for each pool, every input's percentile and reading, the weights, and the cutoffs.",
    do: "Read why a college sits in its tier; open Details for the arithmetic.",
    see: "specs/chances/selectivity-index.md",
    door: "data",
  },
  hysteresis: {
    title: "Hysteresis",
    short: "A stored tier moves only when the score crosses the cutoff by a few points, so a college sitting on a line doesn't flip between tiers with every publish.",
    long: "When the score alone reads another tier but hasn't crossed by the margin, the panel says the tier was kept from the last publish.",
    door: "data",
  },
  "top-band": {
    title: "Top band",
    short: "The highest scorers within Ultra selective, kept apart so the tier isn't one undifferentiated group. A college enters at a fixed score and leaves only a few points below it.",
    door: "data",
  },
  "selectivity-movers": {
    title: "Movers",
    short: "The colleges whose score moved most in the latest publish, and whether their tier changed with it.",
    do: "Open a college to see why it moved.",
    door: "data",
  },
  "tier-counts": {
    title: "Tier counts",
    short: "How many colleges sit in each tier after each publish, for every pool. A jump in one tier usually means new figures or a method change.",
    door: "data",
  },
  "method-log": {
    title: "Method log",
    short: "Each change to how selectivity is worked out, with the day it took effect. A method change moves tiers without sending follower emails.",
    door: "data",
  },
  documents: {
    title: "Documents",
    short: "The college's Common Data Set files on record, newest edition first: when each was pulled and from where, how its edition was decided, who read it, and how many of its items carry a check failure.",
    long: "One card per file. The full address, the address it led to, the file's fingerprint (sha256), its size, and each read are under Details. When two files claim one edition, the two are compared side by side above the cards.",
    do: "Open Details to see where a file came from; when two files collide, keep one.",
    see: "specs/product/document-collisions.md#the-college-pages-documents-panel",
    door: "data",
  },
  "document-collision": {
    title: "Two files, one edition",
    short: "Two files claim the same edition of this college's Common Data Set, or a Steward refile would move a file into an edition that already has one. Only one file can be read for an edition.",
    long: "The two files are shown side by side: their facts first (when and where each was pulled, how its edition was decided, who read it), then the items whose values differ, then how many agree. A link with ?compare=<a>,<b> opens any two of the college's files this way.",
    do: "Read the facts and what differs, then press Keep this file under the one to read.",
    see: "specs/product/document-collisions.md#what-a-collision-is",
    door: "data",
  },
  "keep-file": {
    title: "Keep this file",
    short: "Keeps one file and drops the other from this college: the dropped file's queue items go, its address is listed so discovery won't fetch it again, and its bytes stay in the archive. The kept file stays as it is.",
    long: "One change, written at once and published with the next publish. A Steward refile proposal that names either file is declined, and the collision finding is settled. Type keep to confirm.",
    do: "Type keep and press Keep this file.",
    see: "specs/product/document-collisions.md#keep-this-file-the-server-action",
    door: "data",
  },
  "pulled-from": {
    title: "Pulled from",
    short: "Where the file's bytes were fetched, and when. The college's own site is usually the better source; a copy on a file-sharing host may be an older or a different file.",
    door: "data",
  },
  "filed-by": {
    title: "Filed as",
    short: "The edition the file is filed under, and how that was decided: the file states it (its cover, its items, the workbook, its name), it was assumed (the file states none, so it was filed under the edition current when pulled), or a person set it.",
    do: "An assumed edition is the weaker claim when two files collide.",
    door: "data",
  },
  "change-report": {
    title: "A change's report",
    short: "What the run wrote about itself: its counts (colleges attempted, documents read, cost) and its checks (passed or failed), listed in words. The run's own text is under Details.",
    do: "Read the counts and the checks before you release or undo the change.",
    door: "data",
  },
  "change-actions": {
    title: "A change's actions",
    short: "Hold keeps the change and every later one from publishing. Publish anyway releases a held change and publishes. Undo this change writes a new change that puts back what this one changed.",
    long: "To undo a whole publish at once rather than one change, make an earlier published version live on Published versions.",
    door: "data",
  },
  "documents-touched": {
    title: "Documents touched",
    short: "Every document this change wrote, by what it holds. Open one to see its before and after, line by line.",
    door: "data",
  },
  "reference-versions": {
    title: "A document's versions",
    short: "Every saved version of this reference document, newest first, each with the change that wrote it. Restore version N saves that version again as the newest.",
    door: "data",
  },
  "reference-form": {
    title: "The document as a form",
    short: "One field per part of the document, with the checker's problems beside the part they name. Edit as text shows the whole document as JSON instead.",
    do: "Edit a field, then Save document; the checker runs before anything is saved.",
    door: "data",
  },
  "course-counts": {
    title: "Courses students list",
    short: "How many different students at a school list each AP or IB course. The plan suggests a course once enough students list it; below that line a course is never shown, and no count names a student.",
    door: "data",
  },
  "course-offering": {
    title: "What the course plan reads",
    short: "The school's own course list when it publishes one, or else the courses its students list, with where each came from.",
    door: "data",
  },
  "health-sources": {
    title: "Published files",
    short: "Each file the dataset is built from, with the year it describes, when it was published, and whether a newer one is out.",
    door: "data",
  },

  "estimate-inputs": {
    title: "Estimate inputs",
    short: "Every fact the admission estimate reads for this college: the core ones first with their status, then the supporting ones, each with its value, source, and dates. Which facts, never how they are combined.",
    do: "Find a stale or failing input and open its source.",
    see: "specs/product/admin-health-views.md",
    door: "data",
  },
  "estimate-inputs-counts": {
    title: "Colleges by the health of the estimate's inputs",
    short: "How many colleges have every core estimate input fresh, and per core input how many are fresh, watch, stale, or failing. The counts cover every college, not the filtered rows.",
    do: "Press a number to filter the table to it.",
    see: "specs/product/admin-health-views.md",
    door: "data",
  },
  "data-health-counts": {
    title: "Colleges by data health",
    short: "How many colleges are at each status overall, and per group of data. The counts cover every college, not the filtered rows.",
    do: "Press a number to filter the table to it.",
    see: "specs/product/admin-health-views.md",
    door: "data",
  },
  "college-documents": {
    title: "Each college's documents",
    short: "When we last received each group of a college's own data (its Common Data Set, its site's pages), and what decided each status.",
    do: "Filter by status or group, then open a college.",
    see: "specs/product/admin-health-views.md",
    door: "data",
  },
  "visit-events": {
    title: "Visit events",
    short: "Whether the nightly read of campus visit events is working: the last seven nights, the hosts by status, and the newest run's data check.",
    do: "If the last run is old or hosts are failing, open the job that reads them.",
    see: "specs/product/visit-events.md",
    door: "data",
  },

  /* ---------------------------------------------------------------- */
  /* More                                                             */
  /* ---------------------------------------------------------------- */
  admins: {
    title: "Admins",
    short: "Who can open the console. Every admin passes a second factor at each sign-in.",
    do: "Make someone an admin, or revoke one.",
    door: "more",
  },
  settings: {
    title: "Settings",
    short: "Site-wide switches, saved in the database and in effect at once.",
    door: "more",
  },
  "test-date": {
    title: "Test date",
    short: "Makes the advisor act as if today were another date, for this copy of the site, to test what a student sees in another season.",
    door: "more",
  },
  "all-moves": {
    title: "All moves",
    short: "When on, Next steps lists every move by season, for testing; students see the usual short list when off.",
    door: "more",
  },
  log: {
    title: "Log",
    short: "Every admin action, newest first: who did it, to what, and when. The log holds no token, link, or password.",
    do: "Filter by action, admin, or target.",
    door: "more",
  },
  help: {
    title: "Help",
    short: "Every word the console uses, by door, with what it means and what you can do.",
    door: "more",
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpKey = keyof typeof HELP;

/** Whether a string is a help key (the grep test and /admin/help's anchors use it). */
export function isHelpKey(key: string): key is HelpKey {
  return Object.prototype.hasOwnProperty.call(HELP, key);
}

/** The entry for a key; HelpEntry so the optional fields read as optional. */
export function helpEntry(key: HelpKey): HelpEntry {
  return HELP[key];
}

export const HELP_DOOR_ORDER: readonly (HelpDoor | "general")[] = ["steward", "people", "data", "more", "general"];
export const HELP_DOOR_LABEL: Readonly<Record<HelpDoor | "general", string>> = { steward: "Steward", people: "People", data: "Data", more: "More", general: "Everywhere" };

/** Every entry grouped for /admin/help, each group in the order written. */
export function helpByDoor(): { door: HelpDoor | "general"; label: string; entries: { key: HelpKey; entry: HelpEntry }[] }[] {
  const all = (Object.keys(HELP) as HelpKey[]).map((key) => ({ key, entry: helpEntry(key) }));
  return HELP_DOOR_ORDER.map((door) => ({
    door,
    label: HELP_DOOR_LABEL[door],
    entries: all.filter(({ entry }) => (entry.door ?? "general") === door),
  })).filter((g) => g.entries.length > 0);
}

/** GitHub's link for a `see` path ("specs/x.md#anchor"); the repository is the console's (lib/github-app.ts default). */
export function seeHref(see: string, repo: string): string {
  return `https://github.com/${repo}/blob/main/${see}`;
}
