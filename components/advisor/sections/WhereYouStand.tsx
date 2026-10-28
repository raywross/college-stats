import { SampleFrame, SplashSection } from "@/components/advisor/Frame";
import { SampleList } from "@/components/advisor/SampleList";
import type { SplashData } from "@/components/advisor/sample";

/** Where you stand: the sample's five colleges, one per level, and the season's shape line. Levels, never a percentage. */
export function WhereYouStand({ data }: { data: SplashData }) {
  return (
    <SplashSection id="where-you-stand" title="Where you stand" line="Quad reads what each college publishes about who it admits, and says who you're compared with. Never a percentage.">
      <SampleFrame badge={data.badge} label={`${data.badge}: the Colleges tab`}>
        <p className="mb-3 px-1 text-sm font-semibold">{data.shapeLine}</p>
        <SampleList colleges={data.colleges} />
      </SampleFrame>
    </SplashSection>
  );
}
