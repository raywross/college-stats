"use client";

import type { RowControlProps } from "@/components/planner/row/props";
import { OutcomePicker } from "@/components/planner/OutcomePicker";
import { Term } from "@/components/ui/info-tip";
import { usd } from "@/lib/planner/offers";

/**
 * A list row's offers controls inside ListBoard's "More" (U7; specs/planner/offers.md "Display", "List row"): the
 * outcome picker with its date, once the student has applied (or is applying), and "Offer: $X net" once an offer is
 * entered (the gift total when the letter stated no cost). Rendered last by RowControls.
 */
export default function OffersRowControls({ item, school, canEdit, today, offer }: RowControlProps) {
  if (item.status === "considering" && !item.outcome) return null;
  return (
    <div className="space-y-1.5">
      <OutcomePicker itemId={item.id} outcome={item.outcome} decisionDate={item.decision_date} today={today} canEdit={canEdit && !item.withdrawn_on} collegeName={school.name} compact />
      {offer && (
        <p className="text-xs font-semibold">
          {offer.net !== null ? (
            <>
              Offer: {usd(offer.net)} <Term term="net-cost">net</Term>
            </>
          ) : (
            <>
              Offer: {usd(offer.gift)} in <Term term="gift-aid">gift aid</Term>
            </>
          )}
        </p>
      )}
    </div>
  );
}
