/**
 * The essay reviewer's guidance corpus (specs/product/essays/reviewer.md "The guidance corpus"): reads a fixed list of
 * public, institutional pages on writing college essays and keeps short excerpts from each, with the page and the date,
 * in data/reference/essay-guidance/sources.json. The synthesis (guidance.md beside it) is written by hand from these
 * excerpts and reviewed by the owner; this script never writes it.
 *
 *   npm run research-essay-guidance              # fetch every source, write sources.json
 *   npm run research-essay-guidance -- --dry-run # fetch and report, write nothing
 *   npm run research-essay-guidance -- --only unc-run-ons,mit-essays   # refresh some sources, keep the rest
 *
 * Every page goes through PoliteHttp (robots.txt honored, the honest user agent, one request a second per host, never
 * retried past a refusal). A page that robots.txt disallows, that refuses us, or that no longer says what we kept is
 * listed under `refused` and its earlier excerpts (if any) are kept with their old date. Each page's text is kept in
 * .cache/essay-guidance/ (git-ignored) by sha so a reviewer can read what the excerpts came from.
 *
 * Excerpts: whole sentences of the page, picked by the source's `pick` anchors (short phrases that must appear on the
 * page) in page order, at most MAX_WORDS_PER_SOURCE words per source. Fair use: short excerpts, cited by organization
 * and URL, from public guidance pages only; no commercial coaching sites and no student essays.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEntities, detectFormat, htmlToText, pdfPages } from "./lib/college-reported/documents.mts";
import { cacheDocument, isBlocked, PoliteHttp, sha256, USER_AGENT } from "./lib/college-reported/http.mts";

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

/** The reviewer's eight categories and the five questions of approach (reviewer.md). */
export const TOPICS = [
  "mechanics",
  "prompt",
  "specific",
  "structure",
  "voice",
  "care",
  "showcase",
  "interest",
  "supplements",
  "depth",
  "short-answers",
] as const;
export type Topic = (typeof TOPICS)[number];

export const MAX_WORDS_PER_SOURCE = 300;

export interface SourceSpec {
  /** Stable id for --only and the log. */
  id: string;
  organization: string;
  url: string;
  half: "craft" | "approach";
  topics: Topic[];
  /** Phrases that pick the sentences to keep (case and spacing ignored); each must be on the page. */
  pick: string[];
  /** The title to record when the page has none to read (a PDF). */
  title?: string;
}

export interface GuidanceSource {
  id: string;
  organization: string;
  title: string;
  url: string;
  retrieved: string;
  half: "craft" | "approach";
  topics: Topic[];
  excerpts: string[];
}

export interface Refusal {
  id: string;
  organization: string;
  url: string;
  reason: string;
  checked: string;
}

export interface GuidanceFile {
  user_agent: string;
  note: string;
  sources: GuidanceSource[];
  refused: Refusal[];
}

/* ------------------------------------------------------------------ */
/* Excerpts (pure)                                                     */
/* ------------------------------------------------------------------ */

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Lines rejoined where a page (or a PDF's layout) broke a sentence across them: a line that doesn't end a sentence is
 * joined to the next line when that one starts in lowercase or continues a quotation or parenthesis, or, in a PDF
 * (`wrapped`), whenever it isn't a new list item.
 */
export function rejoinLines(text: string, wrapped = false): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const prev = out[out.length - 1];
    // In a PDF a short line followed by a capital is a heading ("RUN-ON SENTENCES"), not a wrapped sentence.
    const continues = wrapped ? !/^[-*]\s/.test(line) && (/^[a-z(“"‘]/.test(line) || wordCount(prev ?? "") > 4) : /^[a-z(“"‘]/.test(line);
    if (prev && line && !/[.!?:;”"’)]$/.test(prev) && !prev.startsWith("## ") && continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

/** A sentence ends at . ! or ? (and any closing quote), but not after a title or a Latin abbreviation. */
const SENTENCE_END = /(?<!\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e)\.)(?<=[.!?][”"’')]?)\s+(?=[“"‘(]?[A-Z0-9])/;

/** The page's sentences in order: headings dropped, list items and lines kept whole, lines split at sentence ends. */
export function sentences(text: string, wrapped = false): string[] {
  const out: string[] = [];
  for (const raw of rejoinLines(text.replace(/•/g, "\n- "), wrapped)) {
    const line = raw.replace(/^[-*•]\s+/, "").trim();
    // A heading is dropped, unless it is really a paragraph some pages wrap in a heading tag (Tufts' blog does).
    if (!line || (line.startsWith("## ") && wordCount(line) < 15)) continue;
    for (const s of line.replace(/^## /, "").split(SENTENCE_END)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * The sentences that contain one of `pick`, in page order, each kept once, stopping before the total passes `maxWords`.
 * `missing` lists the anchors found in no sentence (the page changed, or the anchor spans two sentences).
 */
export function selectExcerpts(text: string, pick: string[], maxWords = MAX_WORDS_PER_SOURCE, wrapped = false): { excerpts: string[]; missing: string[] } {
  const all = sentences(text, wrapped);
  const anchors = pick.map(norm);
  const found = new Set<number>();
  const excerpts: string[] = [];
  let words = 0;
  for (const s of all) {
    const n = norm(s);
    const hits = anchors.map((a, i) => (n.includes(a) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) continue;
    hits.forEach((i) => found.add(i));
    if (excerpts.includes(s)) continue;
    const w = wordCount(s);
    if (words + w > maxWords) continue;
    excerpts.push(s);
    words += w;
  }
  return { excerpts, missing: pick.filter((_, i) => !found.has(i)) };
}

/** The page's title: its <title>, else its first <h1>, with the site's name after a separator dropped. */
export function pageTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) return null;
  const t = decodeEntities(m[1].replace(/<[^>]+>/g, " ").replace(/&middot;/g, "·")).replace(/\s+/g, " ").trim();
  return t.split(/\s+[|–—·-]\s+/)[0].trim() || null;
}

/* ------------------------------------------------------------------ */
/* The sources                                                         */
/* ------------------------------------------------------------------ */

const src = (id: string, organization: string, url: string, half: SourceSpec["half"], topics: Topic[], pick: string[], title?: string): SourceSpec => ({ id, organization, url, half, topics, pick, ...(title ? { title } : {}) });

const PURDUE = "Purdue OWL (Purdue University Writing Lab)";
const UNC = "The Writing Center, University of North Carolina at Chapel Hill";
const WISC = "The Writing Center, University of Wisconsin–Madison";
const COALITION = "Coalition for College";
const GT = "Georgia Tech Undergraduate Admission";
const TUFTS = "Tufts University Admissions";

/**
 * The source list (reviewer.md "The guidance corpus"). Public, institutional, and nonprofit pages only: writing
 * centers, admissions offices, the application platforms, NACAC. No commercial coaching sites, no student essays (a
 * page that quotes an essay is kept only for the office's own advice, and the picks avoid the quoted essay).
 * Pages that refused us or render no readable text stay listed so each run records them under `refused`. The Common
 * App is not on the list: its terms allow linking only to its homepage (tests/common-app-guards.test.mts), and its
 * essay pages render by script, so the platforms' guidance comes from the Coalition and from colleges' pages on the
 * Common App essay (Georgia Tech's).
 */
export const SOURCES: SourceSpec[] = [
  /* ---------------- The craft: writing centers ---------------- */
  src("purdue-run-ons", PURDUE, "https://owl.purdue.edu/owl/general_writing/punctuation/independent_and_dependent_clauses/runonsentences.html", "craft", ["mechanics"], [
    "Run-ons, comma splices, and fused sentences are all names given",
    "Join the two independent clauses with one of the coordinating conjunctions",
    "When you do not have a connecting word",
    "run-ons and fused sentences are terms describing",
  ]),
  src("purdue-commas", PURDUE, "https://owl.purdue.edu/owl/general_writing/punctuation/commas/extended_rules_for_commas.html", "craft", ["mechanics"], [
    "Use commas to separate independent clauses when they are joined",
    "Use commas after introductory",
    "Use a pair of commas in the middle of a sentence to set off",
  ]),
  src("purdue-conciseness", PURDUE, "https://owl.purdue.edu/owl/general_writing/academic_writing/conciseness/index.html", "craft", ["voice", "mechanics"], [
    "The goal of concise writing is to use the most effective words",
    "Concise writing does not always have the fewest words",
    "Words and phrases should be deliberately chosen",
    "As a general rule, more specific words lead to more concise writing",
    "Check every word to make sure that it is providing something",
  ]),
  src("purdue-clarity", PURDUE, "https://owl.purdue.edu/owl/general_writing/mechanics/sentence_clarity.html", "craft", ["mechanics", "voice"], [
    "Avoid interrupting the main clause with a phrase",
    "Sentences in active voice are usually easier to understand",
    "put them in parallel form",
    "Use verbs when possible rather than noun forms",
    "Use affirmative forms rather than several negatives",
  ]),
  src("purdue-application-essays", PURDUE, "https://owl.purdue.edu/owl/general_writing/undergraduate_applications/undergraduate_application_timeline/advice_for_writing_application_essays.html", "craft", ["prompt", "specific", "structure", "supplements"], [
    "Don't use boilerplate essays",
    "resist the urge to reuse the exact same essay",
    "You can, of course, adapt the same essay for similar prompts",
    "begin by reading the prompts and questions carefully",
    "rough draft that is about one thing",
    "does it seem like anyone could have written this",
    "Successful essays relate an experience or analyze a pattern",
    "you must elaborate by including evidence",
    "you don’t necessarily need to have something life-changing",
    "Ask yourself if the essay answers the prompt",
    "don’t spend too much time editing early on",
    "Working on lower-order concerns can give you the impression",
  ]),
  src("purdue-admissions-handout", PURDUE, "https://owl.purdue.edu/owl/general_writing/undergraduate_applications/undergraduate_application_timeline/documents/admissions_essay_handout.pdf", "craft", ["showcase", "specific", "structure", "voice"], [
    "provide them with new information that is not readily found",
    "talking about too many things with such a limited word count",
    "Don’t tell them you’re resourceful",
    "make sure you are highlighting your special skills",
    "Gimmicks, cliches, and humor are all risks",
    "use your conclusion to do more than summarize",
  ], "Admissions Application Essay: Writing your Way to College (handout)"),
  src("purdue-personal-statement", PURDUE, "https://owl.purdue.edu/owl/job_search_writing/preparing_an_application/writing_the_personal_statement/index.html", "craft", ["prompt", "specific", "structure", "care"], [
    "Don't be tempted to use the same statement for all applications",
    "be sure your answer fits the question being asked",
    "Think in terms of showing or demonstrating through concrete experience",
    "unless you can back it up with specific reasons",
    "The lead or opening paragraph is generally the most important",
    "What details of your life (personal or family problems",
  ]),
  src("purdue-revising", PURDUE, "https://owl.purdue.edu/owl/general_writing/the_writing_process/proofreading/steps_for_revising.html", "craft", ["mechanics", "structure"], [
    "Read your paper out loud and listen for awkward pauses",
    "Cut out extra words, vagueness, and misused words",
    "If you think something is wrong, you should make a note of it",
    "pretend that you are reviewing someone else's work",
  ]),
  src("unc-fragments-run-ons", UNC, "https://writingcenter.unc.edu/tips-and-tools/fragments-and-run-ons/", "craft", ["mechanics"], [
    "A sentence fragment is an incomplete sentence",
    "every dependent clause needs to be attached to an independent clause",
    "You are making a run-on when you put two complete sentences",
    "You CANNOT simply add a comma between the two sentences",
    "You can fix a comma splice the same way you fix a run-on",
    "writers tend to be either comma splicers or run-on artists",
  ]),
  src("unc-commas", UNC, "https://writingcenter.unc.edu/tips-and-tools/commas/", "craft", ["mechanics"], [
    "using a comma alone causes a",
    "Some readers (especially professors) will think of this as a serious error",
    "Read what comes after FANBOYS all by itself",
  ]),
  src("unc-application-essays", UNC, "https://writingcenter.unc.edu/tips-and-tools/application-essays/", "craft", ["prompt", "specific", "voice", "showcase", "short-answers", "care"], [
    "One of the basic tasks of the application essay is to follow the directions",
    "Make sure you follow page and word limits exactly",
    "Find the most relevant, memorable, concrete statements",
    "Eliminate any generalizations or platitudes",
    "replace the generalizations with examples as you revise",
    "you may find yourself writing a good, specific sentence right after a general",
    "Applications that have several short-answer essays require even more detail",
    "Get straight to the point in every case",
    "Don’t waste space with information you have provided in the rest of the application",
    "The voice you use in your essay should be yours",
    "be careful not to let your drama turn into melodrama",
    "Don’t invent drama where there isn’t any",
    "issues that might be controversial for your reader",
    "Do address any information about yourself and your application that needs to be explained",
  ]),
  src("unc-introductions", UNC, "https://writingcenter.unc.edu/tips-and-tools/introductions/", "craft", ["structure"], [
    "this kind of weaker introduction contains several sentences that are vague",
    "it can be easy to stop at JUST restating the question",
    "This kind of introduction generally makes broad, sweeping statements",
    "Try writing your introduction last",
  ]),
  src("unc-conclusions", UNC, "https://writingcenter.unc.edu/tips-and-tools/conclusions/", "craft", ["structure"], [
    "don’t simply repeat things that were in your paper",
    "This conclusion just restates the thesis",
    "It does not push the ideas forward",
    "yourself “So What?” as you develop your ideas",
  ]),
  src("unc-paragraphs", UNC, "https://writingcenter.unc.edu/tips-and-tools/paragraphs/", "craft", ["structure"], [
    "Paragraphs are the building blocks of papers",
    "a paragraph is a sentence or group of sentences that support one main idea",
    "All of the sentences in a single paragraph should be related to a single controlling idea",
  ]),
  src("unc-word-choice", UNC, "https://writingcenter.unc.edu/tips-and-tools/word-choice/", "craft", ["voice"], [
    "Be careful when using the thesaurus",
    "Don’t try to impress your reader or sound unduly authoritative",
    "The main way to avoid clichés is first to recognize them",
    "you are probably being redundant",
  ]),
  src("unc-style", UNC, "https://writingcenter.unc.edu/tips-and-tools/style/", "craft", ["voice"], [
    "your goal in academic writing is not to sound intelligent",
    "don’t blindly accept the recommendations of your word processing program’s thesaurus",
    "it’s often okay to repeat the same word(s)",
  ]),
  src("unc-conciseness", UNC, "https://writingcenter.unc.edu/tips-and-tools/conciseness-handout/", "craft", ["voice", "mechanics"], [
    "Common examples of redundant pairs include",
    "can be replaced with if",
  ]),
  src("unc-proofreading", UNC, "https://writingcenter.unc.edu/tips-and-tools/editing-and-proofreading/", "craft", ["mechanics"], [
    "Don’t rely entirely on spelling checkers",
    "spell checkers will not catch misspellings that form another valid word",
    "Read the paper backwards",
    "Try to keep the editing and proofreading processes separate",
    "you don’t want careless errors distracting your reader",
  ]),
  src("wisc-active-voice", WISC, "https://writing.wisc.edu/handbook/grammarandstyle/ccs_activevoice/", "craft", ["voice", "mechanics"], [
    "Generally, try to use the active voice whenever possible",
    "Passive voice sentences often use more words",
    "There are sometimes good reasons to use the passive voice",
  ]),
  src("wisc-program-statements", WISC, "https://writing.wisc.edu/handbook/professionalwriting/writing-personal-statements-for-academic-programs/", "craft", ["interest", "specific", "structure"], [
    "it is key to familiarize yourself with the program’s website",
    "You do not need to narrate all these experiences",
    "pick the most essential elements of your story to share",
    "instead of enumerating a series of past experiences",
    "when you narrate your life story, you will reflect on what you have learned",
  ]),
  src("uvu-comma-splices", "Writing Center, Utah Valley University", "https://www.uvu.edu/writingcenter/handouts/comma-splices.html", "craft", ["mechanics"], [
    "A comma splice occurs when two sentences or independent clauses are joined together by a comma",
    "Sentences or independent clauses must be separated by punctuation other than a comma",
    "Both comma splices and run-ons are fixed using the same methods",
  ]),
  src("wfu-run-ons", "Writing Center, Wake Forest University", "https://prod.wp.cdn.aws.wfu.edu/sites/579/2026/08/Run-Ons-and-Comma-Splices.pdf", "craft", ["mechanics"], [
    "A run-on sentence occurs when two independent clauses are mistakenly combined",
    "a sentence can become a run-on if it has a coordinating conjunction but no comma",
    "The sentence doesn't have to be long to be a run-on",
    "If the two thoughts are not very closely tied together, then use a period instead",
  ], "Run-Ons and Comma Splices (handout)"),
  src("harvard-wc-introductions", "Harvard College Writing Center", "https://writingcenter.fas.harvard.edu/introductions", "craft", ["structure"], ["introduction"]),
  src("harvard-wc-conclusions", "Harvard College Writing Center", "https://writingcenter.fas.harvard.edu/conclusions", "craft", ["structure"], ["conclusion"]),
  src("harvard-wc-revising", "Harvard College Writing Center", "https://writingcenter.fas.harvard.edu/revising-draft", "craft", ["structure"], ["revis"]),

  /* ---------------- The craft: admissions offices on the writing ---------------- */
  src("mit-essays", "MIT Admissions", "https://mitadmissions.org/apply/firstyear/essays-activities-academics/", "craft", ["voice", "short-answers"], [
    "Remember that this is not a writing test",
    "Be honest, be open, be authentic",
    "if you’re thinking too much",
    "we’re looking for responses of approximately 100–200 words each",
    "There is only space for 40 to 50 words each",
  ]),
  src("mit-word-count", "MIT Admissions", "https://mitadmissions.org/help/faq/essays-word-count/", "craft", ["prompt", "mechanics"], [
    "We require applicants to follow the word limits provided on the application",
    "Your information will not be saved if the responses are too long",
  ]),
  src("yale-essays", "Yale Undergraduate Admissions", "https://admissions.yale.edu/essays", "craft", ["voice", "showcase", "short-answers"], [
    "We know that no one can fit an entire life story",
    "Pick topics that will give us an idea of who you are",
    "We have read wonderful essays on common topics and weak essays on highly unusual ones",
    "Your perspective – the lens through which you view your topic",
    "Share your essays with at least one or two people who know you well",
    "your essays should retain your own voice",
    "in no more than 200 characters",
  ]),
  src("tufts-essay-tips", TUFTS, "https://admissions.tufts.edu/blogs/inside-admissions/post/essay-writing-tips/", "craft", ["prompt", "specific", "voice", "short-answers"], [
    "The word limits for these essays often land at less than 300 words",
    "the prompts simply serve as a frame for the reader",
    "be sure to include specifics and details",
    "Be sure to ask someone to look over and check your essays for spelling",
    "Letting many people read and edit your essay might result in your voice",
  ]),
  src("tufts-four-tips", TUFTS, "https://admissions.tufts.edu/blogs/inside-admissions/post/the-only-four-college-essay-writing-tips-youll-ever-need/", "craft", ["specific", "voice", "showcase", "depth"], [
    "Often your instinct is to write about something else",
    "You may use these people or experiences as launching pads to discuss yourself",
    "you have two options when exploring a topic in your college essay: go broad or go deep",
    "By focusing on details, you set yourself apart",
    "Telling me that your friends would describe you as silly and outgoing is, unfortunately, not enough",
    "when you have many different people giving you feedback, you often lose your voice",
    "Then show your essays to two people",
  ]),
  src("uc-piq", "University of California Admissions", "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/personal-insight-questions.html", "craft", ["prompt", "specific", "mechanics", "short-answers", "showcase", "care"], [
    "Each response is limited to a maximum of 350 words",
    "All are given equal consideration in the application review process",
    "There is no right or wrong way to answer these questions",
    "Making a list of accomplishments, activities, awards or work will lessen the impact",
    "Expand on a topic by using specific, concrete examples",
    "Although you will not be evaluated on grammar, spelling or sentence structure",
    "Grammatical and spelling errors can be distracting to the reader",
    "Your answers should reflect your own ideas and be written by you alone",
    "If you choose to write about educational barriers you've faced",
    "This shouldn't be an essay, but rather a place to note unusual circumstances",
  ]),
  src("uva-dean-tips", "University of Virginia College of Arts & Sciences", "https://as.virginia.edu/news/uva-admission-essays-are-posted-learn-how-write-your-best-one", "craft", ["voice", "structure", "prompt"], [
    "I think that it helps us get insight into the personality, voice and style of the student",
    "The topic is just a vehicle that the student uses",
    "Don’t feel limited to the formulaic way that most students are taught to write for class",
    "essays shouldn’t read like they were done by committee",
    "When you submit it, it should feel good to you, and it should sound like you",
  ]),
  src("vanderbilt-personal-essay", "Vanderbilt University Undergraduate Admissions", "https://admissions.vanderbilt.edu/vandybloggers/2013/09/how-to-write-your-personal-essay/", "craft", ["voice", "showcase", "mechanics", "care"], [
    "it is rarely if ever a “make or break” component of your application",
    "we don’t really care that much what you write about, as long as you’re writing about you",
    "Don’t try to guess what the reader wants to hear",
    "Feel free to be funny or creative – but don’t overreach",
    "Do not use this space to summarize your extracurricular involvement",
    "a 45-year-old lawyer writes quite differently from an 18-year-old student",
    "keep an eagle eye out for spelling and grammatical errors",
    "you don’t have to include anything about yourself that you don’t feel comfortable sharing",
  ]),
  src("gt-personal-essays", GT, "https://admission.gatech.edu/first-year/personal-essays", "craft", ["prompt", "showcase", "mechanics", "care"], [
    "Demonstrate authenticity & self-awareness",
    "Deepen our understanding of you or your interests",
    "Answer the chosen prompt completely and thoughtfully",
    "Sometimes cutting and pasting can change punctuation marks",
    "If you start to focus on what you think we want to hear, pause",
    "The Responsibilities and Circumstances section and the Additional Information section",
    "all admission staff are mandatory reporters",
  ]),
  src("coalition-revising", COALITION, "https://www.coalitionforcollegeaccess.org/mycoalition-counselor-all/revising-college-essays-t3dkj", "craft", ["mechanics", "voice", "structure"], [
    "Be sure to use your own judgment when accepting these recommendations",
    "eliminating the uniqueness of your own voice",
    "If the reader struggles with a sentence or section",
    "Finally, ask them what the point or moral of the essay is",
    "If you ask too many people for feedback",
    "don’t obsess over any one word or sentence",
  ]),
  src("coalition-ai-essay", COALITION, "https://www.coalitionforcollegeaccess.org/mycoalition-counselor-all/ai-and-the-college-essay", "craft", ["voice"], [
    "The essay isn’t about writing perfectly",
    "some colleges have specific AI policies",
    "Admissions counselors generally agree that AI can be used as a support tool",
    "Create personal stories or reflections you didn’t experience",
    "Essays that sound generic or disconnected from the rest of an application often raise concerns",
  ]),
  src("coalition-jhu-pro-tips", `${COALITION} (from Johns Hopkins University Admissions)`, "https://www.coalitionforcollegeaccess.org/mycoalition-counselor-all/pro-tips-on-writing-your-personal-statement", "craft", ["prompt", "showcase", "voice", "mechanics"], [
    "The essays reveal how you learn, what you value, or how you approach challenges",
    "make sure your essay answers what is being asked",
    "Instead of listing all of your extracurricular involvements again",
    "Your essay works together with all parts of your application",
    "Spell-check doesn’t catch everything",
  ]),
  src("uchicago-essays", "University of Chicago College Admissions", "https://collegeadmissions.uchicago.edu/apply/essay/", "craft", ["prompt", "voice"], ["approached with utter seriousness, complete fancy"]),

  /* ---------------- The approach: how offices read, what to show ---------------- */
  src("nacac-guide-essays", "National Association for College Admission Counseling (NACAC)", "https://www.nacacnet.org/wp-content/uploads/2022/10/NACAC-GCAP-2022-Report-1022_1.pdf", "approach", ["showcase", "supplements", "interest", "short-answers"], [
    "their primary purpose is to tell the admission committee something in depth about you",
    "it should not be tailored to specific colleges",
    "Avoid the temptation to talk about every activity or experience",
    "It should not serve as a narrative resumé",
    "but that does not mean they should be taken any less seriously",
    "Avoid talking about the general criteria that may have initially put the college on your radar",
    "This essay should be so specific and tailored to the individual school",
    "The specificity, care, and intentionality that goes into your response",
    "optional is rarely ever authentically optional",
  ], "Guide to the College Admission Process (2022), chapters 3 and 6"),
  src("mit-what-we-look-for", "MIT Admissions", "https://mitadmissions.org/apply/process/what-we-look-for/", "approach", ["showcase", "depth"], [
    "it’s really the match between the applicant and the Institute",
    "there are many ways to make an impact",
    "We don’t expect applicants to do a million things",
    "Put your heart into a few things that you truly care about right now",
    "is not a trick question",
  ]),
  src("yale-what-we-look-for", "Yale Undergraduate Admissions", "https://admissions.yale.edu/what-yale-looks-for", "approach", ["showcase", "voice"], [
    "The Yale application tries to get at the personal side of the applicant",
    "write openly and honestly about activities, interests, or experiences",
    "If an essay doesn’t sound like the person who writes it",
    "we read essays very carefully and try to get a full sense of the real person",
  ]),
  src("princeton-helpful-tips", "Princeton University Admission", "https://admission.princeton.edu/apply/before-you-apply/helpful-tips", "approach", ["showcase", "interest", "voice"], [
    "we will want to know more than just the statistics in your file",
    "Tell us how you would seize the academic and nonacademic opportunities at Princeton",
    "This is your opportunity to display your best writing",
    "it is extremely important that the essays be your own work",
  ]),
  src("coalition-harvard-what-colleges-look-for", `${COALITION} (from Harvard College Admissions)`, "https://www.coalitionforcollegeaccess.org/mycoalition-counselor-all/harvard-what-colleges-are-looking-for", "approach", ["showcase", "depth"], [
    "Many selective colleges practice an admissions process that looks at the applicant as a whole person",
    "Describing how you have spent your time over the past four years",
    "we look at students’ essays and recommendations from their teachers and guidance counselors",
    "Personal essays and recommendations that paint a picture of your personal qualities",
  ]),
  src("coalition-getting-started", COALITION, "https://www.coalitionforcollegeaccess.org/mycoalition-counselor-all/getting-started-on-your-college-essay", "approach", ["showcase"], [
    "The point of brainstorming is to think of lots of ideas",
    "there is never a particular story or topic that we’re looking for",
    "write about whatever feels true to you",
  ]),
  src("coalition-why-this-college", COALITION, "https://www.coalitionforcollegeaccess.org/mycoalition-counselor-all/answering-why-this-college-essay-questions", "approach", ["interest"], [
    "Admissions counselors aren’t looking for perfect answers or praise about the institution",
    "Clear connections between you and the college",
    "This isn’t about naming everything the college offers",
    "Start by reflecting on what you want from college",
    "Choose a few meaningful examples and explain how they connect to your goals",
    "List facts without explaining why they matter",
    "Use generic language that could apply to many colleges",
    "Focus only on rankings, location, or prestige",
    "If your essay could be reused for another school",
  ]),
  src("coalition-demonstrated-interest", COALITION, "https://www.coalitionforcollegeaccess.org/mycoalition-counselor-all/demonstrated-interest-what-it-means-and-why-it-matters", "approach", ["interest"], [
    "Demonstrated interest refers to how a student engages with a college",
    "Not all colleges will track or use demonstrated interest",
    "Each college will define and measure demonstrated interest differently",
    "Many colleges are transparent about whether they consider demonstrated interest",
    "Students are not expected to attend every event",
  ]),
  src("coalition-supplemental-essays", COALITION, "https://www.coalitionforcollegeaccess.org/mycoalition-counselor-all/standout-supplemental-essays", "approach", ["supplements", "interest"], [
    "The \"Why Us?\" prompts and short-answer questions are critical components",
  ]),
  src("tufts-supplement", TUFTS, "https://admissions.tufts.edu/blogs/inside-admissions/post/application-checklist-the-supplement", "approach", ["supplements", "interest", "showcase"], [
    "The best thing that you can do for yourself as you plan your essays is to have each one touch upon a different part",
    "use the various essays to highlight each individual piece",
    "Part of what we do when reading a Why Tufts is to see whether or not you’ve done your homework",
    "Tell us about an academic program or research project or club",
    "If you are fiercely passionate about something and haven’t told us about it yet",
  ]),
  src("tufts-supplement-advice", TUFTS, "https://admissions.tufts.edu/blogs/inside-admissions/post/essay-advice-the-ghost-of-my-supplement-past/", "approach", ["interest", "showcase"], [
    "If you can replace the word Tufts with any other school",
    "be specific, make sure the focus is on you",
    "Its okay to not have the most sophisticated intellectual topics",
  ]),
  src("jhu-supplemental-essay", "Johns Hopkins University Undergraduate Admissions", "https://apply.jhu.edu/hopkins-insider/advice-for-crafting-your-supplemental-essay/", "approach", ["supplements", "interest", "prompt", "structure"], [
    "Because the supplemental essay is school-specific",
    "It’s different from the personal statement",
    "take a close look at what the prompt is asking",
    "Small, one-time moments can be impactful too",
    "Focus on the process, rather than the outcome",
    "You don’t need to be the hero of the story",
  ]),
  src("jhu-application-resources", "Johns Hopkins University Undergraduate Admissions (Hopkins Insider, a student contributor)", "https://apply.jhu.edu/hopkins-insider/application-resources-and-suggestions/", "approach", ["interest"], [
    "look through the student organizations available on campus",
    "I would suggest looking at the catalogue",
    "Every university has its own unique programs and experiences",
    "some aspect of campus stood out to you, feel free to mention it",
  ]),
  src("gt-supplemental-essays", GT, "https://sites.gatech.edu/admission-blog/2019/07/12/will-saying-im-a-blueberry-get-me-into-college-supplemental-essays-101/", "approach", ["supplements", "interest", "short-answers", "mechanics"], [
    "Not all colleges or universities have supplemental questions, but if they do, you should take them seriously",
    "What have I not had a chance to say?",
    "The purpose of this question is to understand how you think",
    "Scanning the college website to glean some key words or phrases",
    "real research starts with curiosity",
    "If you use the name of the college, university or institute in the supplemental essay, get the name right",
    "proof this writing piece as thoroughly as your main essay",
  ]),
  src("gt-asking-why", GT, "https://sites.gatech.edu/admission-blog/2024/10/07/preparing-your-college-application-you-are-asking-the-wrong-questions/", "approach", ["showcase", "depth", "interest"], [
    "Why is this school good… for you?",
    "Instead of thinking of a checklist of accomplishments for your college application",
    "would you rather share with me a task list",
  ]),
  src("gt-completing-application", GT, "https://sites.gatech.edu/admission-blog/2026/10/06/coffee-conversations-and-completing-your-college-application/", "approach", ["showcase"], [
    "Tell me something I might not already know about you",
    "That is my purpose when I read an essay",
    "If there is something that just doesn’t fit with the rest of the conversation",
  ]),
  src("nyu-activities", "NYU Admissions", "https://meet.nyu.edu/advice/tips-for-writing-a-winning-activities-section/", "approach", ["short-answers", "depth", "mechanics"], [
    "Rank your activities in order of their importance to you",
    "Don’t just showcase what seems most glamorous or exciting",
    "Your activity descriptions should look like very well-composed tweets",
    "There’s nothing more confusing than a beautifully composed essay right next to an activities section littered with errors",
    "you should only be using them if they are universal",
  ]),
  src("ut-short-answers", "The University of Texas at Austin Admissions", "https://admissions.utexas.edu/apply/application-materials/essays-and-short-answers/", "approach", ["short-answers", "supplements"], [
    "They allow students to share their stories, interests and additional information",
    "It can be one you’ve already written",
    "Answers are limited to no more than 40 lines, or about 250-300 words per prompt",
    "The statement of purpose is not meant to be a listing of accomplishments",
  ]),
  src("rice-supplement", "Rice University Admission", "https://admission.rice.edu/apply/first-year-domestic-applicants", "approach", ["interest", "supplements"], [
    "This is your chance to tell us why you are interested in Rice",
  ]),
  src("bowdoin-supplement", "Bowdoin College Admissions", "https://www.bowdoin.edu/admissions/apply/index.html", "approach", ["voice", "care"], [
    "The strongest applications are personal and genuine",
    "Read our guidance on the use of AI in your application",
  ], "Apply: the Bowdoin Supplement"),
  src("uva-notes-from-peabody", "University of Virginia Office of Undergraduate Admission (Notes from Peabody)", "https://uvaadmission.blogspot.com/", "approach", ["voice"], ["essay"]),
  src("umich-essays", "University of Michigan Undergraduate Admissions", "https://admissions.umich.edu/apply/first-year-applicants/essays", "approach", ["interest"], ["essay"]),
];

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

const ROOT = join(import.meta.dirname, "..");
export const OUT_DIR = join(ROOT, "data", "reference", "essay-guidance");
export const SOURCES_PATH = join(OUT_DIR, "sources.json");
const CACHE = join(ROOT, ".cache", "essay-guidance");

async function main() {
  const args = process.argv.slice(2);
  const DRY_RUN = args.includes("--dry-run");
  const onlyAt = args.indexOf("--only");
  const only = onlyAt >= 0 ? new Set((args[onlyAt + 1] ?? "").split(",").filter(Boolean)) : null;
  const today = new Date().toISOString().slice(0, 10);
  const http = new PoliteHttp({
    fetch: (input, init) => globalThis.fetch(input, init),
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    minDelayMs: 1000,
    log: (m) => console.log(m),
    timeoutMs: 60_000,
    maxBytes: 20 * 1024 * 1024,
  });

  const previous: GuidanceFile | null = existsSync(SOURCES_PATH) ? JSON.parse(readFileSync(SOURCES_PATH, "utf8")) : null;
  const prevById = new Map((previous?.sources ?? []).map((s) => [s.id, s]));
  const ids = new Set<string>();
  for (const s of SOURCES) {
    if (ids.has(s.id)) throw new Error(`duplicate source id ${s.id}`);
    ids.add(s.id);
  }

  const kept: GuidanceSource[] = [];
  const refused: Refusal[] = [];
  const refuse = (s: SourceSpec, reason: string) => {
    console.log(`  ✗ ${s.id}: ${reason}`);
    refused.push({ id: s.id, organization: s.organization, url: s.url, reason, checked: today });
    const old = prevById.get(s.id);
    if (old) kept.push(old);
  };

  // One request at a time per host (PoliteHttp paces); different hosts run together.
  const jobs = SOURCES.map(async (s) => {
    if (only && !only.has(s.id)) {
      const old = prevById.get(s.id);
      if (old) kept.push(old);
      const oldRefusal = previous?.refused.find((r) => r.id === s.id);
      if (oldRefusal) refused.push(oldRefusal);
      return;
    }
    let res: Response | null;
    try {
      res = await http.get(s.url);
    } catch (err) {
      return refuse(s, `network: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res) return refuse(s, "robots.txt disallows it");
    if (isBlocked(res)) return refuse(s, `refused (HTTP ${res.status})`);
    if (!res.ok) return refuse(s, `HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const hash = sha256(bytes);
    cacheDocument(CACHE, hash, bytes);
    const format = detectFormat(bytes, res.headers.get("content-type"), s.url);
    let text: string;
    let title: string | null = null;
    const wrapped = format === "pdf";
    if (wrapped) text = (await pdfPages(bytes)).join("\n");
    else {
      const html = new TextDecoder().decode(bytes);
      title = pageTitle(html);
      text = htmlToText(html);
    }
    mkdirSync(join(CACHE, "text"), { recursive: true });
    writeFileSync(join(CACHE, "text", `${s.id}.txt`), `${s.url}\n${hash}\n\n${text}\n`);
    const { excerpts, missing } = selectExcerpts(text, s.pick, MAX_WORDS_PER_SOURCE, wrapped);
    if (!excerpts.length && text.length < 500) return refuse(s, `the page has almost no text without a browser (${text.length} characters read; it renders by script)`);
    if (!excerpts.length) return refuse(s, `none of the picked sentences are on the page (${text.length} characters read)`);
    if (missing.length) console.log(`  ! ${s.id}: not on the page: ${missing.map((m) => JSON.stringify(m)).join(", ")}`);
    console.log(`  ✓ ${s.id}: ${excerpts.length} excerpts, ${excerpts.reduce((n, e) => n + wordCount(e), 0)} words`);
    kept.push({ id: s.id, organization: s.organization, title: s.title ?? title ?? s.organization, url: s.url, retrieved: today, half: s.half, topics: s.topics, excerpts });
  });
  await Promise.all(jobs);

  const order = new Map(SOURCES.map((s, i) => [s.id, i]));
  kept.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  refused.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const craft = kept.filter((s) => s.half === "craft").length;
  console.log(`essay guidance: ${kept.length} sources (${craft} craft, ${kept.length - craft} approach); ${refused.length} refused or changed`);
  for (const b of http.blockedSeen()) console.log(`  blocked: ${b.host} ${b.status} ${b.url}`);

  const file: GuidanceFile = {
    user_agent: USER_AGENT,
    note: "Short excerpts from public guidance pages, kept for the essay reviewer's guidance (guidance.md). Fair use: at most 300 words per source, cited by organization and url. No student essays. Refresh: npm run research-essay-guidance.",
    sources: kept,
    refused,
  };
  if (DRY_RUN) console.log("--dry-run: nothing written");
  else {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(SOURCES_PATH, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`wrote ${SOURCES_PATH}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`research-essay-guidance: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
