import { Eye, PencilLine } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/** Who is looking: a parent in the household, or a counselor the student (or a parent) granted access. */
export type ViewerBannerRelation = "guardian" | "counselor";

/**
 * The banner's sentence after "Viewing as a …", in plain words (specs/product/accounts.md "Privacy model";
 * specs/product/counselor-portal.md "A student"): whether the viewer can edit, and that the student sees the visit.
 * The same words for a parent and a counselor; only the role word before it differs.
 */
export function viewerBannerLine(studentName: string | null, canEdit: boolean): string {
  const given = studentName?.trim() || null;
  const possessive = given ? `${given}’s` : "this student’s";
  const can = canEdit ? `You can edit ${possessive} information.` : `You can look but not change ${possessive} information.`;
  return `${can} ${given ?? "The student"} can see when you view it.`;
}

/**
 * "Viewing as a guardian" / "Viewing as a counselor": shown at the top of any page where someone other than the
 * student is looking at the student's information with their own session. Says whose it is, whether they can edit,
 * and that the student can see the visit (pages log it with openStudentAs() from lib/households.ts, or
 * scheduleStudentReadLog()).
 *
 *   {access.relation !== "self" && <ViewerBanner relation={access.relation} studentName={access.student.display_name} canEdit={access.canEdit} />}
 *
 * A server component (no client state), so it works in server and client trees alike. GuardianBanner is this with
 * `relation="guardian"`, kept so older imports work.
 */
export function ViewerBanner({ relation, studentName, canEdit, className }: { relation: ViewerBannerRelation; studentName: string | null; canEdit: boolean; className?: string }) {
  const Icon = canEdit ? PencilLine : Eye;
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/8 px-4 py-3 text-sm", className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold">
          {/* The counselor's glossary entry (`counselor-access`) lands with the portal's glossary unit; until then the
              word is plain. */}
          Viewing as a {relation === "guardian" ? <Term term="guardian">guardian</Term> : "counselor"}
        </span>
        <span className="text-muted-foreground"> · {viewerBannerLine(studentName, canEdit)}</span>
      </p>
    </div>
  );
}
