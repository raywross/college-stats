import { Block } from "@/components/profile/Panel";
import { StandingCard } from "@/components/chances/StandingCard";
import { InfoTip } from "@/components/ui/info-tip";
import { shortName } from "@/lib/brand";
import { getData } from "@/lib/data";
import { estimateFactCites, majorUnitCites } from "@/lib/chances/fact-cites";
import { majorUnitsFor, universityStatement } from "@/lib/chances/major-admission";
import { noteText } from "@/lib/chances/notes";
import { majorFamilyName } from "@/lib/majors";
import type { School } from "@/lib/types";

/**
 * "Where you stand" on the admissions page (specs/product/chances-and-fit.md "Display"): the card's frame and the
 * citations it can need, resolved here because the page is static; the card itself fills in after mount from the
 * visitor's numbers (components/chances/StandingCard.tsx).
 */
export async function StandingSection({ school, id, className }: { school: School; id: string; className?: string }) {
  const { citeField } = await getData();
  const families = [...new Set(majorUnitsFor(school.unit_id).flatMap((u) => u.cip_families))]
    .sort()
    .map((family) => ({ family, name: majorFamilyName(family) }))
    .filter((f): f is { family: string; name: string } => f.name !== null);
  return (
    <Block
      id={id}
      className={className}
      title={
        <>
          {noteText({ key: "estimate.card_title", values: {} })} <InfoTip term="quads-estimate" />
        </>
      }
    >
      <StandingCard
        unitId={school.unit_id}
        college={shortName(school)}
        cites={estimateFactCites(school, citeField)}
        majorCites={majorUnitCites(school, citeField)}
        families={families}
        hasStatement={universityStatement(school.unit_id) !== null}
      />
    </Block>
  );
}
