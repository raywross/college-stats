import { SampleFrame, SplashSection } from "@/components/advisor/Frame";
import { SampleParent } from "@/components/advisor/SampleParent";
import type { SplashData } from "@/components/advisor/sample";

/**
 * For parents: the season's whole list as a parent sees it. The spec's "the family price covers every child" waits for
 * the trial (build order step 3); until then the line says the household holds every child.
 */
export function ForParents({ data }: { data: SplashData }) {
  return (
    <SplashSection id="for-parents" title="For parents" line="Parents see the same advisor the student does, and one household holds every child." flip>
      <SampleFrame badge={data.badge} label={`${data.badge}: a parent's view`}>
        <SampleParent parent={data.parent} heading={data.seasonHeading} />
      </SampleFrame>
    </SplashSection>
  );
}
