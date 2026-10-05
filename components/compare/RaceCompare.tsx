import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import { DEMOGRAPHIC_CATEGORIES } from "@/lib/metrics";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { StackedBar } from "@/components/charts/StackedBar";
import { InfoTip } from "@/components/ui/info-tip";
import { Block } from "@/components/profile/Panel";
import { COMPARE_BLOCK_SCROLL } from "./CompareTopicPage";

/**
 * Race and ethnicity, one `StackedBar` per college in slot order with one shared legend below (today's compare
 * block, moved here verbatim, except the per-college row: specs/compare-redesign.md#topic-pages). The name and bar
 * stay side by side at every width (never stacked, unlike today's single page) with a floor under the row's width,
 * so with four colleges at 390px the card scrolls sideways inside itself instead of shrinking the bars illegibly
 * thin (specs/compare-redesign.md open question 3, owner assumption 3).
 */
export function RaceCompare({ schools, cited }: { schools: School[]; cited: Cited }) {
  return (
    <Block
      id="race"
      className={COMPARE_BLOCK_SCROLL}
      title={
        <>
          Race &amp; ethnicity <InfoTip term="race-ethnicity" cited={cited} />
        </>
      }
    >
      <div className="max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4">
        <div className="space-y-5 max-sm:min-w-[26rem]">
          {schools.map((s, i) => (
            <div key={s.unit_id} className="grid grid-cols-[6rem_1fr] items-center gap-2 sm:grid-cols-[8rem_1fr]">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                {shortName(s)}
              </span>
              {s.demographics.racial_diversity ? (
                <StackedBar data={s.demographics.racial_diversity} height="h-6" showLegend={false} label={`${s.name} race and ethnicity`} />
              ) : (
                <span className="text-sm text-muted-foreground">Not reported</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-4 text-xs">
        {DEMOGRAPHIC_CATEGORIES.map((c) => (
          <li key={c.key} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
            {c.label}
          </li>
        ))}
      </ul>
    </Block>
  );
}
