"use client";

import type { RowControlProps } from "@/components/planner/row/props";
import ListRowControls from "@/components/planner/row/list";
import RoundsRowControls from "@/components/planner/row/rounds";
import ActionsRowControls from "@/components/planner/row/actions";
import ApplyRowControls from "@/components/planner/row/apply";
import OffersRowControls from "@/components/planner/row/offers";

/**
 * A list row's stage controls, inside ListBoard's "More" (specs/planner/model.md "Where it lives": "a family that
 * lives on the List tab never has to open Plan"). Each stage unit fills its own `row/*` module; they render in stage
 * order list → rounds → actions → apply → offers, and a module with nothing to show renders null. ListPage builds one
 * per row on the server and hands it to ListBoard's `rowExtras` slot.
 */
export function RowControls(props: RowControlProps) {
  return (
    <div className="space-y-3 empty:hidden" data-planner-row>
      <ListRowControls {...props} />
      <RoundsRowControls {...props} />
      <ActionsRowControls {...props} />
      <ApplyRowControls {...props} />
      <OffersRowControls {...props} />
    </div>
  );
}
