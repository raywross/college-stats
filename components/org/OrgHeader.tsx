import Link from "next/link";
import { cn } from "@/lib/utils";
import { ORG_KIND_LABEL, type OrgKind } from "@/lib/org-rules";

/**
 * The portal's header (specs/product/counselor-portal.md "The counselor's pages"): the organization's name and kind,
 * then two pills, Caseload and Members. A student's page passes `active="caseload"` (it lives under the caseload).
 */
export function OrgHeader({ name, kind, active }: { name: string; kind: OrgKind; active: "caseload" | "members" }) {
  const pill = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors",
        on ? "bg-foreground text-background" : "border hover:bg-muted",
      )}
    >
      {label}
    </Link>
  );
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-extrabold tracking-tight break-words sm:text-3xl">{name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{ORG_KIND_LABEL[kind]}</p>
      </div>
      <nav aria-label="Organization" className="flex gap-2">
        {pill("/org", "Caseload", active === "caseload")}
        {pill("/org/members", "Members", active === "members")}
      </nav>
    </header>
  );
}
