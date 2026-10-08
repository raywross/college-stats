"use client";

import type { RowControlProps } from "@/components/planner/row/props";

/**
 * A list row's planner controls inside ListBoard's "More" (U7): the outcome picker with its date and the offer's net cost. Rendered by RowControls in the order
 * list → rounds → actions → apply → offers. A U1 stub until then: renders nothing.
 */
export default function OffersRowControls({ item, school, canEdit }: RowControlProps) {
  void item;
  void school;
  void canEdit;
  return null;
}
