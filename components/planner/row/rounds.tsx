"use client";

import type { RowControlProps } from "@/components/planner/row/props";

/**
 * A list row's planner controls inside ListBoard's "More" (U3): the round picker limited to the rounds the college offers. Rendered by RowControls in the order
 * list → rounds → actions → apply → offers. A U1 stub until then: renders nothing.
 */
export default function RoundsRowControls({ item, school, canEdit }: RowControlProps) {
  void item;
  void school;
  void canEdit;
  return null;
}
