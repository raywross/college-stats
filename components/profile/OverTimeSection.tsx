import { getData } from "@/lib/data";
import { DOMAINS } from "@/lib/metrics";
import { historyYearLabel, type NationalHistory } from "@/lib/history";
import { BANDED, HISTORY_GROUPS } from "@/lib/profile-history";
import type { ProfileHistory } from "@/lib/profile-data";
import type { HistoryGroupKey } from "@/lib/history-groups";
import type { School } from "@/lib/types";
import { OverTime } from "@/components/history/OverTime";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";

/**
 * The "Over time" charts with everything they need from the server: the college's history, the national bands,
 * CPI, the latest and provisional years, a source line per chart group, and the domain colors. `initialGroup` is the
 * page's `?group=`, so the server HTML shows that group.
 */
export async function OverTimeSection({
  school,
  history: { history, files },
  initialGroup,
}: {
  school: School;
  history: ProfileHistory;
  initialGroup?: HistoryGroupKey;
}) {
  const { citeField } = await getData();
  const applicants = citeField("admissions.applicants", school);
  return (
    <OverTime
      initialGroup={initialGroup}
      isPublic={school.type === "public"}
      history={history}
      national={Object.fromEntries(BANDED.flatMap((k) => (files.national.series[k] ? [[k, files.national.series[k]]] : []))) as NationalHistory["series"]}
      cpi={files.cpi}
      latest={files.meta.latest}
      provisional={{
        fall: files.meta.provisional.adm ?? null,
        academic: files.meta.provisional.sfa ?? files.meta.provisional.prices ?? null,
        cohort: null,
      }}
      sources={{
        cost: <HistorySourceNote keys={HISTORY_GROUPS.cost} files={files} />,
        aid: <HistorySourceNote keys={HISTORY_GROUPS.aid} files={files} />,
        admissions: (
          <>
            {!applicants.isDefault && (
              <p className="mb-1.5">
                These charts use federal data every year, so they end at {historyYearLabel(files.meta.latest.fall, "fall").toLowerCase()}; the admissions
                figures on the Getting in page come from {applicants.label}
                {applicants.year ? `, ${applicants.year}` : ""}.
              </p>
            )}
            <HistorySourceNote keys={HISTORY_GROUPS.admissions} files={files} />
          </>
        ),
        scores: <HistorySourceNote keys={HISTORY_GROUPS.scores} files={files} />,
        students: <HistorySourceNote keys={HISTORY_GROUPS.students} files={files} />,
        outcomes: <HistorySourceNote keys={HISTORY_GROUPS.outcomes} files={files} />,
        academics: <HistorySourceNote keys={HISTORY_GROUPS.academics} files={files} />,
      }}
      colors={{
        value: DOMAINS.value.color,
        admissions: DOMAINS.admissions.color,
        scores: DOMAINS.scores.color,
        size: DOMAINS.size.color,
        diversity: DOMAINS.diversity.color,
      }}
    />
  );
}
