import { Landmark } from "lucide-react";
import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import { WITHHELD_TEXT, ZERO_TEXT, countDisplay, countText, longDate, smallCount } from "@/lib/lgbtq";
import { num, pctSmart } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * LGBTQ+ life, phase 1 (specs/lgbtq-life.md): the federal another-gender counts under the spec's display rules (blank,
 * 0, and a count each mean something different; under 10 is "fewer than 10"), and, at public colleges in a state with
 * one, the state law. Describes; never ranks or compares. Hidden when there's nothing to show.
 */
export function LgbtqLife({
  school,
  citedGender,
  citedAdmissions,
  citedLaw,
}: {
  school: School;
  /** citeField("lgbtq.gender", school) */
  citedGender: Cited;
  /** citeField("lgbtq.admissions", school) */
  citedAdmissions: Cited;
  /** citeField("lgbtq.state_law", school) */
  citedLaw: Cited;
}) {
  const g = school.lgbtq?.gender ?? null;
  const a = school.lgbtq?.admissions ?? null;
  const law = school.lgbtq?.state_law ?? null;
  if (!g && !law) return null;
  const another = g ? countDisplay(g.status, g.another, g.undergrads) : null;
  const unknown = g ? smallCount(g.unknown) : null;
  // Applicants: shown when the college reported them or withheld them; "not collected" is already said above.
  const showAdmissions = a && a.status !== "not_collected";
  const admissionsZero = a?.status === "reported" && !a.applicants && !a.admitted && !a.enrolled;
  const year = (c: Cited) => (c.year ? `, ${c.year.toLowerCase()}` : "");

  return (
    <div id="lgbtq" className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-5 font-display text-lg font-bold">LGBTQ+ life</h3>
      {g && another && (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Undergraduates of another gender{year(citedGender)} <InfoTip term="another-gender" cited={citedGender} />
            </p>
            {another.kind === "count" ? (
              <>
                <p className="mt-2 font-display text-3xl font-extrabold">{num(another.count)}</p>
                {another.share !== null && <p className="mt-1 text-sm">{pctSmart(another.share)} of all undergraduates</p>}
              </>
            ) : (
              <p className="mt-2 text-sm font-semibold">{countText(another, "undergraduates")}</p>
            )}
            {unknown !== null && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                Gender unknown: {unknown} <InfoTip term="gender-unknown" cited={citedGender} />
              </p>
            )}
          </div>
          {showAdmissions && (
            <div>
              <p className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                First-year applicants of another gender{year(citedAdmissions)} <InfoTip term="another-gender" cited={citedAdmissions} />
              </p>
              <p className="mt-2 text-sm">
                {a.status === "withheld"
                  ? WITHHELD_TEXT
                  : admissionsZero
                    ? ZERO_TEXT
                    : [
                        ["applied", a.applicants],
                        ["admitted", a.admitted],
                        ["enrolled", a.enrolled],
                      ]
                        .filter(([, n]) => n !== null)
                        .map(([label, n]) => `${smallCount(n as number)} ${label}`)
                        .join(" · ")}
              </p>
            </div>
          )}
        </div>
      )}
      {g && (
        <p className="mt-4 text-xs text-muted-foreground">
          All undergraduates whose college records hold a gender other than man or woman. It doesn&apos;t count transgender
          students overall or describe sexual orientation, and colleges record it so differently that numbers can&apos;t be
          compared between colleges. The federal survey has since stopped asking for it.
        </p>
      )}
      {law && (
        <div className={g ? "mt-5 border-t pt-4" : ""}>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Landmark className="size-4" style={{ color: DOMAINS.size.color }} aria-hidden /> State law for public colleges{" "}
            <InfoTip term="state-law-public-colleges" cited={citedLaw} />
          </p>
          <p className="mt-2 text-sm">{law.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <a href={law.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-primary">
              {law.statute}
            </a>{" "}
            ({law.name}), in effect since {longDate(law.effective)}.
          </p>
        </div>
      )}
    </div>
  );
}
