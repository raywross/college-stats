import type { Dataset } from "@/lib/data";
import type { School } from "@/lib/types";
import { campusChips } from "@/lib/profile-cards";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { InfoTip } from "@/components/ui/info-tip";
import { Block } from "@/components/profile/Panel";
import { COMPARE_BLOCK_SCROLL } from "./CompareTopicPage";

/**
 * One chip row per college from `campusChips()` (lib/profile-cards.ts: setting, the live-on rule or no housing,
 * athletics level and conference, ROTC, study abroad, undergrad research), each chip cited to its own college
 * (a college's own setting or programs, not a dataset default). "Nothing reported" when a college has none.
 */
export function CampusChips({ schools, citeField }: { schools: School[]; citeField: Dataset["citeField"] }) {
  return (
    <Block id="campus" className={COMPARE_BLOCK_SCROLL} title="Campus">
      <div className="space-y-4">
        {schools.map((s, i) => {
          const chips = campusChips(s);
          return (
            <div key={s.unit_id} className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-start">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                {shortName(s)}
              </span>
              {chips.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {chips.map((c) => (
                    <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
                      {c.label}
                      <InfoTip term={c.term} cited={citeField(c.field, s)} />
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Nothing reported</span>
              )}
            </div>
          );
        })}
      </div>
    </Block>
  );
}
