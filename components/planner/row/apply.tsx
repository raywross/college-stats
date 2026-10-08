"use client";

import type { RowControlProps } from "@/components/planner/row/props";

/**
 * A list row's planner controls inside ListBoard's "More" (U6): the Applied date, the platform, and the portal button. Rendered by RowControls in the order
 * list → rounds → actions → apply → offers. A U1 stub until then: renders nothing.
 */
export default function ApplyRowControls({ item, school, canEdit }: RowControlProps) {
  void item;
  void school;
  void canEdit;
  return null;
}
