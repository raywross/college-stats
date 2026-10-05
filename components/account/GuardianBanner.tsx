import { Eye, PencilLine } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * "Viewing as a guardian" (specs/product/accounts.md "Privacy model"): shown at the top of any page where a guardian
 * is looking at a student's information with their own session. Says whose it is, whether they can edit, and that
 * the student can see the visit (pages log it with openStudentAs() from lib/households.ts).
 *
 *   {access.relation === "guardian" && <GuardianBanner studentName={access.student.display_name} canEdit={access.canEdit} />}
 *
 * A server component (no client state), so it works in server and client trees alike.
 */
export function GuardianBanner({ studentName, canEdit, className }: { studentName: string | null; canEdit: boolean; className?: string }) {
  const given = studentName?.trim();
  const possessive = given ? `${given}’s` : "this student’s";
  const Icon = canEdit ? PencilLine : Eye;
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/8 px-4 py-3 text-sm", className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold">
          Viewing as a <Term term="guardian">guardian</Term>
        </span>
        <span className="text-muted-foreground">
          {" "}
          · {canEdit ? `You can edit ${possessive} information.` : `You can look but not change ${possessive} information.`} {given ?? "The student"} can see
          when you view it.
        </span>
      </p>
    </div>
  );
}
