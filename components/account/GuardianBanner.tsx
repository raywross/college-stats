import { ViewerBanner } from "@/components/account/ViewerBanner";

/**
 * "Viewing as a guardian" (specs/product/accounts.md "Privacy model"): ViewerBanner with `relation="guardian"`, kept
 * so older imports work. New code renders ViewerBanner with the access's relation, which covers a counselor too.
 */
export function GuardianBanner({ studentName, canEdit, className }: { studentName: string | null; canEdit: boolean; className?: string }) {
  return <ViewerBanner relation="guardian" studentName={studentName} canEdit={canEdit} className={className} />;
}
