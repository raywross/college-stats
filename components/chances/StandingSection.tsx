import { Block } from "@/components/profile/Panel";
import { StandingCard } from "@/components/chances/StandingCard";
import { InfoTip } from "@/components/ui/info-tip";
import { shortName } from "@/lib/brand";
import { getData } from "@/lib/data";
import { estimateFactCites, majorUnitCites } from "@/lib/chances/fact-cites";
import { asCiteRef } from "@/lib/cite-origin";
import { majorUnitsFor } from "@/lib/chances/major-admission";
import { slimPoolSchool } from "@/lib/chances/pool-rate";
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
  // The "Who you're compared with" panel (pool-explainer.md) is built client-side from the student's own numbers,
  // so it needs the college's own published rates: a serializable slice of School, nothing the method computes.
  // Only the lineage records the pool reads (round 5: the whole lineage was most of the admissions page's payload).
  const poolSchool = slimPoolSchool(school);
  // Every fact's citation as a reference the ⓘ fetches on open (round 4; specs/data-lineage.md "Citations on the plan"),
  // except where /api/cite would answer differently (the GPA fields, a live-edited college: `asCiteRef`, round 5). The
  // major units' citations stay whole: each carries its own unit's page and quote, which the API (one citation per
  // college and path) doesn't know.
  const factCites = Object.fromEntries(Object.entries(estimateFactCites(school, citeField)).map(([path, cited]) => [path, asCiteRef(cited)]));
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
        cites={factCites}
        majorCites={majorUnitCites(school, citeField)}
        families={families}
        poolSchool={poolSchool}
      />
    </Block>
  );
}
