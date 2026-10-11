"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearLocalPlan, getLocalPlan } from "@/lib/planner/local-plan";
import { importLocalPlan } from "@/lib/planner/local-plan-import";

/**
 * The signed-out plan's import trigger (specs/planner/redesign/page.md "Signed out" step 3): on the first signed-in
 * `/plan` open after sign-up, whatever colleges, Dream, and student-picked groups/rounds the visitor left in
 * `localStorage` move onto their real list, then the local copy is cleared so this never runs twice. Silent when
 * there's nothing local to import (the common case). Numbers import separately, through the existing
 * `ImportLocalProfile` (components/me/ImportLocalProfile.tsx); this only moves colleges. One line in
 * `components/planner/PlanFrame.tsx` renders this for the signed-in student's own view.
 */
export function ImportLocalPlan({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const router = useRouter();
  const ran = useRef(false);
  const [imported, setImported] = useState<number | null>(null);

  useEffect(() => {
    if (ran.current || !canEdit || !studentId) return;
    const local = getLocalPlan();
    if (local.unitIds.length === 0) return;
    ran.current = true;
    (async () => {
      const result = await importLocalPlan(studentId, local);
      clearLocalPlan();
      if (result.ok && result.imported > 0) {
        setImported(result.imported);
        router.refresh();
      }
    })();
  }, [canEdit, studentId, router]);

  if (imported === null) return null;
  return (
    <p className="rounded-2xl border border-dashed bg-pop/10 p-3 text-sm text-muted-foreground">
      Added {imported} college{imported === 1 ? "" : "s"} from what you started before signing in.
    </p>
  );
}
