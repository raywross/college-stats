import { SampleFrame, SplashSection } from "@/components/advisor/Frame";
import { SampleCalendar } from "@/components/advisor/SampleCalendar";
import type { SplashData } from "@/components/advisor/sample";

/** Never miss a date: one month of the calendar, round colors and the visit lane, and the day-before text. */
export function NeverMissADate({ data }: { data: SplashData }) {
  return (
    <SplashSection id="never-miss-a-date" title="Never miss a date" line="Every deadline, test date, and visit on one calendar, and a text the day before.">
      <SampleFrame badge={data.badge} label={`${data.badge}: the Calendar tab`}>
        <SampleCalendar calendar={data.calendar} />
      </SampleFrame>
    </SplashSection>
  );
}
