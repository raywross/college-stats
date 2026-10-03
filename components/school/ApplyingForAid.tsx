import { ExternalLink } from "lucide-react";
import type { AidDay, H14Criterion, School } from "@/lib/types";
import type { SchoolDetail } from "@/lib/detail";
import { getData } from "@/lib/data";
import { H14_CRITERIA, formatAidDay, pastReplyDate, startYearOf } from "@/lib/cds/financial-aid";
import { MetricLabel, SourceTip, Term } from "@/components/ui/info-tip";
import { BLOCK_SCROLL } from "@/components/profile/Panel";

const CRITERIA: Record<H14Criterion, string> = {
  academics: "Academics",
  alumni_affiliation: "Alumni connection",
  art: "Art",
  athletics: "Athletics",
  job_skills: "Job skills",
  rotc: "ROTC",
  leadership: "Leadership",
  music_drama: "Music or drama",
  religious_affiliation: "Religious affiliation",
  state_residency: "State or district residency",
};

const day = (d: AidDay | "unstated" | null): string | null => (d && d !== "unstated" ? formatAidDay(d) : null);

/**
 * Cost page, "Applying for aid" (#apply-for-aid; specs/data-expansion/cds-financial-aid.md#display): the forms (H8),
 * how need is figured when the college says (H.102–H.104), the dates (H9–H11), what the college's own scholarships
 * consider (H14), and its policy note in its own words (H15). Every year comes from lineage.
 */
export async function ApplyingForAid({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const aid = school.reported?.aid;
  const rows = detail?.tables.cds_aid?.rows ?? null;
  const h14 = rows?.h14 ?? null;
  const h15 = rows?.h15?.display ? rows.h15 : null;
  if (!aid || (!aid.forms && !aid.methodology && !aid.dates && !h14 && !h15)) return null;
  const { citeField } = await getData();
  const formsCited = citeField("reported.aid.forms", school);
  const datesCited = citeField("reported.aid.dates", school);
  const cycle = (aid.forms ? formsCited : datesCited).year;
  const f = aid.forms;
  const d = aid.dates;

  const formNames = f ? [f.fafsa && "the FAFSA", f.css_profile && "the CSS Profile", f.own_form && "the college's own aid form", f.state_form && "a state aid form"].filter(Boolean) as string[] : [];
  const formsSentence =
    formNames.length === 1 ? `To apply for aid: ${formNames[0]}.` : formNames.length ? `To apply for aid: ${formNames.slice(0, -1).join(", ")} and ${formNames.at(-1)}.` : null;

  const dateParts: { label: string; value: string }[] = [];
  if (d) {
    if (day(d.priority)) dateParts.push({ label: "Priority date", value: day(d.priority)! });
    if (day(d.deadline)) dateParts.push({ label: "Deadline", value: day(d.deadline)! });
    else if (d.no_deadline) dateParts.push({ label: "Deadline", value: "none" });
    if (d.notify_by) dateParts.push({ label: "Aid offers", value: `about ${formatAidDay(d.notify_by)}` });
    else if (d.notify_rolling_from) dateParts.push({ label: "Aid offers", value: day(d.notify_rolling_from) ? `on a rolling basis from ${day(d.notify_rolling_from)}` : "on a rolling basis" });
    if (d.reply_by) dateParts.push({ label: "Reply by", value: formatAidDay(d.reply_by) });
    else if (d.reply_within_weeks !== null) dateParts.push({ label: "Reply", value: `within ${d.reply_within_weeks} week${d.reply_within_weeks === 1 ? "" : "s"}` });
  }
  const datesYear = datesCited.year;
  const stale = d && pastReplyDate(startYearOf(datesYear), d.reply_by);

  const method = aid.methodology;
  const methodSentence =
    method === "both"
      ? "Need is calculated with the college's own formula as well as the federal one."
      : method === "institutional"
        ? "Need is calculated with the college's own formula."
        : method === "federal"
          ? "Need is calculated with the federal formula."
          : null;

  const marked = h14 ? H14_CRITERIA.filter((c) => h14[c].non_need || h14[c].need) : [];

  return (
    <div id="apply-for-aid" className={`mt-6 rounded-3xl border bg-card p-4 sm:p-6 ${BLOCK_SCROLL}`}>
      <h3 className="font-display text-lg font-bold">Applying for aid</h3>
      {cycle && <p className="mb-4 text-xs text-muted-foreground">For {cycle.replace(/^Fall/, "fall")}.</p>}
      <div className="space-y-3 text-sm">
        {f && formsSentence && (
          <div>
            <MetricLabel term="css-profile" cited={formsCited}>
              <span>{formsSentence}</span>
            </MetricLabel>
            {f.noncustodial_profile && (
              <p className="mt-1 text-muted-foreground">
                If your parents are divorced or separated, the other parent also files the <Term term="noncustodial-profile">CSS Noncustodial Profile</Term>.
              </p>
            )}
            {f.business_farm_supplement && (
              <p className="mt-1 text-muted-foreground">
                Families who own a business or farm also file a <Term term="business-farm-supplement">Business/Farm Supplement</Term>.
              </p>
            )}
            {f.other && <p className="mt-1 text-muted-foreground">Also: {f.other}</p>}
          </div>
        )}
        {methodSentence && (
          <MetricLabel term="aid-methodology" cited={citeField("reported.aid.methodology", school)}>
            <span>{methodSentence}</span>
          </MetricLabel>
        )}
        {dateParts.length > 0 && (
          <div>
            <p className="flex flex-wrap items-center gap-x-1">
              {dateParts.map((p, i) => (
                <span key={p.label}>
                  {p.label}: <b>{p.value}</b>
                  {i < dateParts.length - 1 && <span className="text-muted-foreground"> · </span>}
                </span>
              ))}
              <SourceTip cited={datesCited} />
            </p>
            {stale && datesYear && <p className="mt-1 text-[11px] text-muted-foreground">Dates for {datesYear.replace(/^Fall/, "fall")}; the next cycle&apos;s are usually similar.</p>}
          </div>
        )}
      </div>

      {marked.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">What the college&apos;s own scholarships consider</p>
          <table className="w-full max-w-md text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <th className="pb-1.5 font-semibold" />
                <th className="pb-1.5 text-center font-semibold">
                  <Term term="merit-aid">Merit awards</Term>
                </th>
                <th className="pb-1.5 text-center font-semibold">
                  <Term term="need-based-aid">Need-based awards</Term>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {marked.map((c) => (
                <tr key={c}>
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    {CRITERIA[c]}
                  </th>
                  <td className="py-1.5 text-center">{h14![c].non_need ? <span aria-label="marked">✓</span> : <span className="sr-only">not marked</span>}</td>
                  <td className="py-1.5 text-center">{h14![c].need ? <span aria-label="marked">✓</span> : <span className="sr-only">not marked</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[11px] text-muted-foreground">A blank means the college didn&apos;t mark it, not that it never counts.</p>
        </div>
      )}

      {h15 && rows && (
        <div className="mt-5 text-sm">
          <p className="mb-1 font-medium">In the college&apos;s words:</p>
          <blockquote className="border-l-2 pl-3 text-muted-foreground italic">&ldquo;{h15.text}&rdquo;</blockquote>
          <a href={rows.document.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {school.name} Common Data Set <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      )}
    </div>
  );
}
