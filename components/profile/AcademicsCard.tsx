import type { Profile } from "@/lib/profile-data";
import { CARD_TITLES } from "@/lib/profile-cards";
import { academicsTakeaway } from "@/lib/insights";
import { topEarningPrograms } from "@/lib/field-of-study";
import { moneyCompact, pct } from "@/lib/format";
import { MetricLabel } from "@/components/ui/info-tip";
import { CardHeadline, CardStat, CardStats, TopicCard } from "./TopicCard";

/**
 * Majors and faculty: students per faculty member with its percentile (the most popular major when no ratio is
 * reported), then the most popular major and its share, the top-earning major and its earnings, the full-time
 * faculty share, and instruction spending per student. No ten-year line: the faculty series are short.
 */
export async function AcademicsCard({ profile: p }: { profile: Profile }) {
  const { data, school, detail, ratio, ratioVs, fullTimeShare, majorsTop, finances } = p;
  const { citeField } = data;
  const top = majorsTop?.[0] ?? null;
  const topCited = citeField("academics.majors_top", school);
  const earning = topEarningPrograms(detail?.tables.programs?.rows, 1)[0] ?? null;
  const earningValue = earning ? (earning.earnings.y4 ?? earning.earnings.y1) : null;
  const instruction = finances?.instruction_per_student ?? null;
  const majorStat = top && (
    <CardStat
      label="Most popular major"
      term="first-major"
      cited={topCited}
      value={top.title}
      valueClassName="line-clamp-2 text-base leading-snug"
      sub={`${pct(top.share)} of ${topCited.year ?? "graduates"}`}
    />
  );

  return (
    <TopicCard topic="academics" unitId={school.unit_id} title={CARD_TITLES.academics} takeaway={academicsTakeaway(p)}>
      {ratio !== null ? (
        <CardHeadline
          value={`${ratio} to 1`}
          caption={
            <>
              <MetricLabel term="student-faculty-ratio" cited={citeField("academics.student_faculty_ratio", school)}>
                students per faculty member
              </MetricLabel>
              {ratioVs && (
                <>
                  {" "}
                  · {ratioVs.word} than at <b className="text-foreground">{pct(ratioVs.share)}</b> of colleges
                </>
              )}
            </>
          }
        />
      ) : (
        top && (
          <CardHeadline
            value={<span className="line-clamp-2 text-2xl leading-tight sm:text-3xl">{top.title}</span>}
            caption={
              <MetricLabel term="first-major" cited={topCited}>
                most popular major · {pct(top.share)} of {topCited.year ?? "graduates"}
              </MetricLabel>
            }
          />
        )
      )}

      {((ratio !== null && top) || earningValue !== null || fullTimeShare !== null || instruction !== null) && (
        <CardStats>
          {ratio !== null && majorStat}
          {earning && earningValue !== null && (
            <CardStat
              label="Top-earning major"
              term="field-of-study"
              cited={citeField("detail.programs", school)}
              value={earning.title}
              valueClassName="line-clamp-2 text-base leading-snug"
              sub={`${moneyCompact(earningValue)} ${earning.earnings.y4 !== null ? "four years" : "one year"} after completion`}
            />
          )}
          {fullTimeShare !== null && (
            <CardStat label="Full-time faculty" term="full-time-faculty" cited={citeField("academics.faculty.full_time_share", school)} value={pct(fullTimeShare)} sub="of faculty" />
          )}
          {instruction !== null && (
            <CardStat label="Instruction spending" term="instruction-expenses" cited={citeField("finances", school)} value={moneyCompact(instruction)} sub="per student a year" />
          )}
        </CardStats>
      )}
    </TopicCard>
  );
}
