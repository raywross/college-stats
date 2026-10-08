"use client";

import type { RowControlProps } from "@/components/planner/row/props";

/**
 * A list row's planner controls inside ListBoard's "More" (U4): follow, request information, and Log a visit. Rendered by RowControls in the order
 * list → rounds → actions → apply → offers. A U1 stub until then: renders nothing.
 */
export default function ActionsRowControls({ item, school, canEdit }: RowControlProps) {
  void item;
  void school;
  void canEdit;
  return null;
}
