export interface StandingPanelSlotProps {
  /** The student record the page is about. */
  studentId: string;
  /** The college on the student's list (IPEDS unit id). */
  unitId: string;
  /** The list item, so the panel can name the list. */
  itemId: string;
}

/**
 * The slot for the per-college standing panel (specs/product/admin.md "A student's standing"). The student page
 * renders it once under every college on every list. It renders nothing yet: unit U7 (feature/admin-hidden) replaces
 * this body with the collapsed panel (the level and label, hidden odds, inputs used, notes that fired, ablations,
 * model version), computed on the server inside requireAdmin() with estimateWithDetail(); the page does not change.
 * It is a Server Component so the panel's private output never reaches a client bundle.
 */
export function StandingPanelSlot(props: StandingPanelSlotProps): null {
  void props;
  return null;
}
