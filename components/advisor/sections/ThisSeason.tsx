import { SampleFrame, SplashSection } from "@/components/advisor/Frame";
import { SampleNow } from "@/components/advisor/SampleNow";
import type { SplashData } from "@/components/advisor/sample";

/** Three things, this season: the sample's Now cards for junior spring, each with its one line of why. */
export function ThisSeason({ data }: { data: SplashData }) {
  return (
    <SplashSection id="this-season" title="Three things, this season" line="Each one opens a guide made for that one job." flip>
      <SampleFrame badge={data.badge} label={`${data.badge}: the Next steps tab`}>
        <SampleNow heading={data.seasonHeading} moves={data.moves} />
      </SampleFrame>
    </SplashSection>
  );
}
