"use client";

import type { ReactNode } from "react";
import { AdminForm, type AdminFormProps } from "@/components/admin/AdminForm";

/**
 * An action that needs a typed confirmation (specs/product/admin.md: Delete account, Delete now, remove a person,
 * delete a student record). The submit button stays disabled until the box holds `expected` (typedMatches in
 * lib/admin/console.ts: case and surrounding spaces don't matter); the Server Action compares it again, so a
 * forged form gets the same refusal.
 */
export function ConfirmTyped({
  expected,
  instruction,
  ...rest
}: Omit<AdminFormProps, "typed"> & {
  /** The word or address to type. */
  expected: string;
  instruction?: ReactNode;
}) {
  return <AdminForm {...rest} tone={rest.tone ?? "danger"} typed={{ expected, instruction }} />;
}
