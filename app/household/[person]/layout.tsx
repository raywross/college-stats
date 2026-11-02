import type { ReactNode } from "react";
import { CaseloadStrip } from "@/components/account/CaseloadStrip";
import { authConfigured, getUser } from "@/lib/auth";
import { personPage } from "@/lib/households";

/**
 * A person's pages for a counselor (specs/product/counselor-portal.md "A student"; household-hub.md "A person's
 * page"): when the person is a student the viewer reaches through a counselor grant, the strip of just that student
 * with "Caseload" back to `/org` goes above the page, in place of the family's people strip (which the hub's layout,
 * app/household/layout.tsx, leaves out for a counselor without a household). For everyone else this adds nothing.
 * personPage() is memoized per request, so the page's own lookup costs nothing more.
 */
export default async function PersonLayout({ children, params }: { children: ReactNode; params: Promise<{ person: string }> }) {
  if (!authConfigured()) return children;
  const { person: id } = await params;
  let person: Awaited<ReturnType<typeof personPage>> = null;
  try {
    if (!(await getUser())) return children;
    person = await personPage(id);
  } catch {
    // The page reads the same person and shows the setup or error state itself.
    return children;
  }
  if (person?.kind !== "student" || person.access.relation !== "counselor") return children;
  const { student } = person.access;
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <CaseloadStrip studentId={student.id} name={student.display_name} gradYear={student.grad_year} />
      </div>
      {children}
    </div>
  );
}
