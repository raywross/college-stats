/**
 * Builds one update-digest email (specs/product/follow-colleges.md#the-digest): groups one publish's emailable
 * changes for the colleges a user follows (those on their list with Updates on), in the site's topic order, cuts off
 * at 8 colleges, and renders both the HTML and a plain-text alternative. Pure: no Supabase, no Next.js/React import,
 * so app/api/cron/digests/route.ts
 * (which gathers the rows with the secret key) and tests/digest.test.mts can both call it directly under plain
 * `node --test` (no JSX transform is configured for that runner, hence plain string templates rather than a
 * react-dom/server-rendered emails/*.tsx component).
 *
 * One call = one user's digest for one publish. The cron route decides who gets one and records `digests`;
 * components/me/UpdatesSection.tsx reuses buildDigest to render a received digest with the exact same blocks.
 */
import { describeChange, EMAILED_KINDS, type StoredChange } from "./changes.ts";
import { NOTIFY_FIELDS } from "./fields.ts";

export const DIGEST_CUTOFF = 8;
/** Only a publish older than this gets a digest (follow-colleges.md#the-digest): revalidation has finished, and a same-day rollback sends nothing. */
export const DIGEST_MIN_AGE_HOURS = 24;
/** Never older than this, so turning email on after a quiet patch doesn't flood followers with a backlog. */
export const DIGEST_MAX_AGE_DAYS = 14;

export interface PublishRow {
  id: number;
  published_at: string;
}

/**
 * Which recorded publishes the cron job should consider right now: older than DIGEST_MIN_AGE_HOURS, and not more
 * than DIGEST_MAX_AGE_DAYS old (so a user with email just turned on, or a long gap in the cron running, never gets
 * a sudden pile of digests for every publish that happened while it was quiet). Oldest first, so a user's history
 * reads in order if more than one is eligible in the same run.
 */
export function eligiblePublishes(
  rows: readonly PublishRow[],
  now: Date,
  { minAgeHours = DIGEST_MIN_AGE_HOURS, maxAgeDays = DIGEST_MAX_AGE_DAYS }: { minAgeHours?: number; maxAgeDays?: number } = {},
): PublishRow[] {
  const minAgeMs = minAgeHours * 3_600_000;
  const maxAgeMs = maxAgeDays * 86_400_000;
  return rows
    .filter((r) => {
      const age = now.getTime() - Date.parse(r.published_at);
      return age >= minAgeMs && age <= maxAgeMs;
    })
    .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
}

/** One followed, changed college's raw changes for this publish, before filtering to emailable kinds. */
export interface DigestCollegeInput {
  unit_id: string;
  name: string;
  changes: readonly StoredChange[];
}

/**
 * The footer's "why you got this": every follow comes from a list with Updates on (household-hub.md "What goes"), so
 * there is one reason. (A guardian notified for a managed student's list hears the same line; naming whose list is
 * left for later, as the build brief decided.)
 */
export const DIGEST_REASON = "these colleges are on your list";

export interface DigestContext {
  /** Origin only, no trailing slash ("https://quad.example"). */
  siteUrl: string;
  unsubscribeToken: string;
}

/** One college as the digest will show it: changes filtered to emailable kinds, sorted, never empty. */
export interface DigestCollege {
  unit_id: string;
  name: string;
  changes: StoredChange[];
  href: string;
}

export interface BuiltDigest {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  /** Colleges shown in the body (at most the cutoff). */
  colleges: DigestCollege[];
  moreCount: number;
  reasons: string[];
  updatesHref: string;
  unsubscribeHref: string;
  /** Every college with at least one emailable change, including ones past the cutoff (for the digests row). */
  unitIds: string[];
  collegeCount: number;
  changeCount: number;
}

/** First-appearance order of NOTIFY_FIELDS' topics: the registry already groups fields by topic (name, admissions, demographics, cost, outcomes, academics). */
const FIELD_ORDER = new Map(NOTIFY_FIELDS.map((f, i) => [f, i]));

function byTopicOrder(a: StoredChange, b: StoredChange): number {
  return (FIELD_ORDER.get(a.field) ?? 999) - (FIELD_ORDER.get(b.field) ?? 999);
}

/** Appends utm_source=digest, the digest's only link tracking (follow-colleges.md: no pixels, no click tracking beyond this). */
export function utmDigest(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}utm_source=digest`;
}

function subjectFor(colleges: readonly { name: string }[]): string {
  if (colleges.length === 1) return `${colleges[0].name}: new figures are in`;
  return `Updates for ${colleges.length} of your colleges`;
}


/** Same sentence shown on the profile's What changed panel, with its source line appended. */
function describeLine(change: StoredChange): string {
  const line = describeChange(change);
  return change.source ? `${line} (${change.source})` : line;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const COLORS = { text: "#1c1f26", muted: "#6b7280", border: "#e4e4e7", bg: "#ffffff", card: "#fafafa", link: "#5b4bda" };

/** The digest's HTML, light colors only (email clients disagree on dark mode), no tracking pixel, table-free. */
export function renderDigestHtml(d: Pick<BuiltDigest, "colleges" | "moreCount" | "updatesHref" | "unsubscribeHref" | "reasons"> & { dataHref: string }): string {
  const cards = d.colleges
    .map(
      (c) => `
    <div style="border:1px solid ${COLORS.border};border-radius:16px;padding:16px 18px;margin-bottom:14px;background:${COLORS.card};">
      <a href="${escapeHtml(c.href)}" style="color:${COLORS.text};font-weight:700;font-size:16px;text-decoration:none;">${escapeHtml(c.name)}</a>
      <ul style="margin:10px 0 0;padding-left:20px;">
        ${c.changes
          .map(
            (change) =>
              `<li style="margin-bottom:6px;">${escapeHtml(describeChange(change))}${
                change.source ? `<div style="color:${COLORS.muted};font-size:12px;margin-top:1px;">${escapeHtml(change.source)}</div>` : ""
              }</li>`,
          )
          .join("")}
      </ul>
    </div>`,
    )
    .join("");
  const more =
    d.moreCount > 0
      ? `<p style="margin:0 0 20px;">…and ${d.moreCount} more on your <a href="${escapeHtml(d.updatesHref)}" style="color:${COLORS.link};">updates page</a>.</p>`
      : "";
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:${COLORS.bg};">
    <div style="font-family:Arial,Helvetica,sans-serif;color:${COLORS.text};font-size:14px;line-height:1.55;max-width:600px;margin:0 auto;padding:24px 20px;">
      ${cards}
      ${more}
      <hr style="border:none;border-top:1px solid ${COLORS.border};margin:20px 0 16px;" />
      <p style="color:${COLORS.muted};font-size:12px;margin:0 0 8px;">
        You got this because ${escapeHtml(d.reasons.join(" and "))}. Figures here are usually a year or more behind a college's current class — see the
        <a href="${escapeHtml(d.dataHref)}" style="color:${COLORS.link};">Data page</a>.
      </p>
      <p style="color:${COLORS.muted};font-size:12px;margin:0;">
        <a href="${escapeHtml(d.updatesHref)}" style="color:${COLORS.link};">All your updates</a> ·
        <a href="${escapeHtml(d.unsubscribeHref)}" style="color:${COLORS.link};">Unsubscribe</a>
      </p>
    </div>
  </body>
</html>`;
}

/** The plain-text alternative, same content and order as the HTML. */
export function renderDigestText(d: Pick<BuiltDigest, "colleges" | "moreCount" | "updatesHref" | "unsubscribeHref" | "reasons"> & { dataHref: string }): string {
  const lines: string[] = [];
  for (const college of d.colleges) {
    lines.push(college.name, college.href, "");
    for (const change of college.changes) lines.push(`- ${describeLine(change)}`);
    lines.push("");
  }
  if (d.moreCount > 0) lines.push(`…and ${d.moreCount} more on your updates page: ${d.updatesHref}`, "");
  lines.push(`You got this because ${d.reasons.join(" and ")}. Figures here are usually a year or more behind a college's current class: ${d.dataHref}`, "");
  lines.push(`All your updates: ${d.updatesHref}`, `Unsubscribe: ${d.unsubscribeHref}`);
  return lines.join("\n");
}

/**
 * Builds one user's digest for one publish, or null when none of the input colleges has an emailable change (the
 * cron route shouldn't send or record anything then; /me/updates shows nothing for that publish either).
 */
export function buildDigest(colleges: readonly DigestCollegeInput[], ctx: DigestContext, { cutoff = DIGEST_CUTOFF }: { cutoff?: number } = {}): BuiltDigest | null {
  const prepared = colleges
    .map((c) => ({ ...c, changes: [...c.changes].filter((ch) => EMAILED_KINDS.has(ch.kind)).sort(byTopicOrder) }))
    .filter((c) => c.changes.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!prepared.length) return null;

  const shown = prepared.slice(0, cutoff);
  const moreCount = prepared.length - shown.length;
  const updatesHref = utmDigest(`${ctx.siteUrl}/me/updates`);
  const unsubscribeHref = utmDigest(`${ctx.siteUrl}/unsubscribe/${ctx.unsubscribeToken}`);
  const dataHref = utmDigest(`${ctx.siteUrl}/data`);
  const reasons = [DIGEST_REASON];

  const emailColleges: DigestCollege[] = shown.map((c) => ({
    unit_id: c.unit_id,
    name: c.name,
    changes: c.changes,
    href: utmDigest(`${ctx.siteUrl}/schools/${c.unit_id}`),
  }));

  const shared = { colleges: emailColleges, moreCount, updatesHref, unsubscribeHref, reasons, dataHref };

  return {
    subject: subjectFor(prepared),
    html: renderDigestHtml(shared),
    text: renderDigestText(shared),
    headers: {
      "List-Unsubscribe": `<${unsubscribeHref}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    colleges: emailColleges,
    moreCount,
    reasons,
    updatesHref,
    unsubscribeHref,
    unitIds: prepared.map((c) => c.unit_id),
    collegeCount: prepared.length,
    changeCount: prepared.reduce((n, c) => n + c.changes.length, 0),
  };
}
