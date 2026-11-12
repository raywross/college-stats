/**
 * Notices (scripts/lib/college-reported/notices.mts; specs/college-reported-fall-figures.md Decisions 1, 5, 7, 9): which
 * links on a college's news listing announce figures for a term, the student-newspaper exclusion, a manual notice's
 * term, and what the extractor reads from a notice (phases.mts noticeInput: windowed around the term, or nothing when
 * the term isn't in the text). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isStudentPaper, manualNoticeSource, namesTerm, noticeLinksFromPage, noticeSource, termIn } from "../scripts/lib/college-reported/notices.mts";
import { noticeInput } from "../scripts/lib/college-reported/phases.mts";
import { tinyPdf } from "./helpers/tiny-pdf.mts";

const NEWS = "https://news.utexas.edu/topics/admissions/";

/** A news office listing with last year's and this year's census releases, unrelated stories, and a student paper. */
const LISTING = `
<ul>
  <li><a href="/2026/09/18/ut-austin-welcomes-record-class-of-2030/">UT Austin welcomes its largest first-year class</a></li>
  <li><a href="/2026/06/02/2026-commencement-speakers/">2026 commencement speakers announced</a></li>
  <li><a href="/2025/09/17/ut-enrolls-record-class-of-2029/">UT enrolls record Class of 2029</a></li>
  <li><a href="/2026/03/27/record-applications-for-fall-2026/">Record applications for fall 2026</a></li>
  <li><a href="https://www.dailytexanonline.com/2026/09/19/class-of-2030-by-the-numbers">Class of 2030 by the numbers</a></li>
  <li><a href="https://www.thecrimson.com/article/2026/3/27/admits-class-of-2030/">Harvard admits Class of 2030</a></li>
  <li><a href="/2026/10/01/new-dining-hall/">A new dining hall opens</a></li>
  <li><a href="/topics/admissions/">Admissions</a></li>
</ul>`;

test("noticeLinksFromPage: this year's announcements, newest first; last year's and unrelated stories left out", () => {
  const links = noticeLinksFromPage(LISTING, NEWS, "Fall 2026");
  assert.deepEqual(links.map((l) => l.url), [
    // Not a listed student-paper host, so the host list doesn't catch it (a person can drop it); newest by its URL date.
    "https://www.dailytexanonline.com/2026/09/19/class-of-2030-by-the-numbers",
    "https://news.utexas.edu/2026/09/18/ut-austin-welcomes-record-class-of-2030/",
    "https://news.utexas.edu/2026/03/27/record-applications-for-fall-2026/",
  ]);
  assert.equal(links[1].published, "2026-09-18", "the date from the URL");
  assert.ok(!links.some((l) => l.url.includes("class-of-2029")), "last year's release (Class of 2029) isn't a Fall 2026 notice");
  assert.ok(!links.some((l) => l.url.includes("commencement")), "the year alone, without an announcement phrase, isn't enough");
  assert.ok(!links.some((l) => l.url.includes("thecrimson.com")), "a student newspaper is never a source");

  // Fall 2025 finds last year's release instead.
  assert.deepEqual(noticeLinksFromPage(LISTING, NEWS, "Fall 2025").map((l) => l.url), ["https://news.utexas.edu/2025/09/17/ut-enrolls-record-class-of-2029/"]);
  // Links already on the recipe (or dropped) aren't offered again; the limit holds.
  const fresh = noticeLinksFromPage(LISTING, NEWS, "Fall 2026", { exclude: ["https://news.utexas.edu/2026/09/18/ut-austin-welcomes-record-class-of-2030/"], limit: 1 });
  assert.deepEqual(fresh.map((l) => l.url), ["https://www.dailytexanonline.com/2026/09/19/class-of-2030-by-the-numbers"]);
});

test("namesTerm: a specific token alone, or the year with an announcement phrase", () => {
  assert.equal(namesTerm("https://x.edu/admissions/fall-2026-first-year-profile", "Fall 2026"), true, "hyphenated in a URL");
  assert.equal(namesTerm("Welcome, Class of 2030", "Fall 2026"), true);
  assert.equal(namesTerm("https://x.edu/news/2026/03/admits-3000", "Fall 2026"), true, "the year and 'admits'");
  assert.equal(namesTerm("https://x.edu/news/2026/05/commencement", "Fall 2026"), false);
  assert.equal(namesTerm("Record applications for the Class of 2029", "Fall 2026"), false, "another class");
  assert.equal(namesTerm("Budget for 20261 records", "Fall 2026"), false, "not a year");
});

test("student newspapers: the listed hosts, their subdomains, and any host with 'daily' and 'student'", () => {
  for (const u of [
    "https://www.thecrimson.com/article/2026/3/27/admits/",
    "https://cornellsun.com/2026/03/30/cornell-admits/",
    "https://www.cavalierdaily.com/article/2026/03/uva-admits",
    "https://huntnewsnu.com/2026/03/northeastern/",
    "https://dailybruin.com/2026/03/ucla-admits",
    "https://www.dailycal.org/2026/03/berkeley",
    "https://www.studlife.com/news/2026/03/washu",
    "https://dailystudentnews.example.edu/2026/admits",
  ])
    assert.equal(isStudentPaper(u), true, u);
  for (const u of ["https://news.harvard.edu/gazette/story/2026/03/admits/", "https://www.harvardmagazine.com/2026/03/admits", "https://news.virginia.edu/topic/admission", "not a url"])
    assert.equal(isStudentPaper(u), false, u);
});

test("notice sources: the term, the shape from the URL, how it was found; a manual entry's term from its note or URL", () => {
  assert.deepEqual(noticeSource({ url: "https://x.edu/2026/09/18/class.pdf", published: "2026-09-18" }, "Fall 2026", "season"), {
    kind: "notice",
    url: "https://x.edu/2026/09/18/class.pdf",
    format: "pdf",
    term: "Fall 2026",
    published: "2026-09-18",
    form: "pdf",
    found_by: "season",
  });
  const uc = manualNoticeSource({ url: "https://www.universityofcalifornia.edu/fall-2026-admissions.pdf", note: "UC system fact sheet, Fall 2026", added: "2026-11-11" });
  assert.equal(uc.term, "Fall 2026");
  assert.equal(uc.found_by, "manual");
  assert.equal(uc.form, "system-sheet");
  assert.equal(manualNoticeSource({ url: "https://x.edu/class-of-2030-profile", added: "2026-11-11" }).term, "Fall 2026", "from the URL");
  assert.equal(manualNoticeSource({ url: "https://x.edu/admissions/numbers", added: "2027-01-05" }).term, "Fall 2027", "else the year it was added");
  assert.equal(termIn("Class%20of%202030"), "Fall 2026");
  assert.equal(termIn("nothing here"), null);
});

const PAD = "Lorem ipsum dolor sit amet. ".repeat(4000); // ~112,000 characters: longer than the 60,000 window

test("noticeInput: an HTML notice is windowed around the first term token it contains; no token, no read", async () => {
  const html = `<html><body><p>${PAD}</p><h1>Meet the Class of 2030</h1><p>More than 82,000 students applied; 9,487 enrolled.</p><p>${PAD}</p></body></html>`;
  const got = await noticeInput(new TextEncoder().encode(html), "Fall 2026");
  assert.ok(got.text, "read");
  assert.ok(got.text!.length <= 60_000);
  assert.match(got.text!, /Class of 2030/);
  assert.match(got.text!, /More than 82,000 students applied/, "the window holds the figures after the term");
  assert.equal(got.noTerm, undefined);

  const old = `<html><body><h1>UT enrolls record Class of 2029</h1><p>9,200 first-year students enrolled in fall 2025.</p></body></html>`;
  assert.deepEqual(await noticeInput(new TextEncoder().encode(old), "Fall 2026"), { noTerm: true }, "a page that doesn't name the term isn't sent");
});

test("noticeInput: a PDF notice sends the pages naming the term; a PDF without it isn't read", async () => {
  const filler = { x: 40, y: 680, s: "This page is long enough to have a text layer of more than two hundred characters in all, so it is not read as a scanned page by the pipeline." };
  const pdf = tinyPdf([{ text: [{ x: 40, y: 700, s: "Fall 2026 first-year class: 54,919 applied, 2,328 admitted" }, filler] }]);
  const got = await noticeInput(pdf, "Fall 2026");
  assert.match(got.text ?? "", /--- Page 1 ---[\s\S]*54,919 applied/);
  const other = tinyPdf([{ text: [{ x: 40, y: 700, s: "Fall 2025 first-year class: 51,000 applied, and many more words to read on this page" }, { x: 40, y: 680, s: "This page is long enough to have a text layer of more than two hundred characters in all, so it is not scanned at all." }] }]);
  assert.deepEqual(await noticeInput(other, "Fall 2026"), { noTerm: true });
});
