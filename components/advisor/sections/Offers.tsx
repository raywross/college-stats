import { SampleFrame, SplashSection } from "@/components/advisor/Frame";
import { OffersTable } from "@/components/planner/OffersTable";
import type { SplashData } from "@/components/advisor/sample";

/** Offers, side by side: the real `OffersTable` for the sample's two letters, read-only (no edit sheet), four-year total included. */
export function Offers({ data }: { data: SplashData }) {
  return (
    <SplashSection id="offers" title="Offers, side by side" line="Real offers, loans kept apart, the way the federal College Financing Plan lays them out.">
      <SampleFrame badge={data.badge} label={`${data.badge}: the Offers tab`}>
        <OffersTable columns={data.offers} fallbacks={{}} />
      </SampleFrame>
    </SplashSection>
  );
}
