import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { coreCurriculum, listPhrase, offeredPrograms } from "@/lib/cds/academics-display";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";
import { Block } from "@/components/profile/Panel";

const chip = "inline-flex items-center rounded-full border bg-surface-2 px-3 py-1 text-xs font-medium";

/**
 * Programs & curriculum (specs/data-expansion/cds-academics.md): a chip for every program the college marked in its
 * Common Data Set (E1), joined by the federal study-abroad and undergraduate-research flags (IPEDS IC), each group
 * cited to its own source; then the required core (E3), or "Open curriculum" when the section was read and nothing was
 * checked. Only offered facts: a program not marked is simply not shown, never "not offered" (blank ≠ no).
 */
export function ProgramChips({ school, cite, id }: { school: School; cite: (path: FieldPath, school?: School) => Cited; id?: string }) {
  const cds = offeredPrograms(school);
  const federal = school.campus?.programs;
  const fed = [federal?.study_abroad ? "Study abroad" : null, federal?.undergrad_research ? "Undergraduate research" : null].filter((x): x is string => !!x);
  const core = coreCurriculum(school);
  if (!cds.length && !core) return null;
  return (
    <Block id={id} title="Programs & curriculum">
      {(cds.length > 0 || fed.length > 0) && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Programs offered">
          {cds.map((p) => (
            <li key={p.key} className={chip}>
              {p.label}
            </li>
          ))}
          {cds.length > 0 && (
            <li className="inline-flex">
              <SourceTip cited={cite("reported.academics.programs", school)} />
            </li>
          )}
          {fed.map((label) => (
            <li key={label} className={chip}>
              {label}
            </li>
          ))}
          {fed.length > 0 && (
            <li className="inline-flex">
              <SourceTip cited={cite("campus.programs", school)} />
            </li>
          )}
        </ul>
      )}
      {core && (
        <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          {core.kind === "open" ? (
            <>
              <span className="font-semibold">Open curriculum</span> — no college-wide required core.{" "}
              <InfoTip term="open-curriculum" cited={cite("reported.academics.core_curriculum", school)} />
            </>
          ) : (
            <>
              <span>
                <span className="font-semibold">Requires coursework in</span> {listPhrase(core.areas)}.
              </span>
              <InfoTip term="required-core" cited={cite("reported.academics.core_curriculum", school)} />
            </>
          )}
        </p>
      )}
    </Block>
  );
}
