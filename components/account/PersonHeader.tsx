import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GuardianBanner } from "@/components/account/GuardianBanner";
import type { PersonPage } from "@/lib/households";
import { cn } from "@/lib/utils";

export type PersonTab = "list" | "numbers";

/** The person's name as their page's title: their own words, never an email. */
export function personTitle(person: PersonPage): string {
  const name = person.kind === "student" ? person.access.student.display_name : person.display_name;
  return name?.trim() || (person.kind === "student" ? "A student" : "A guardian");
}

/**
 * The top of a person's page (specs/product/household-hub.md "A person's page"): back to the household, their name,
 * the guardian banner when a guardian is looking at a student, and the tabs (List; Numbers for students).
 */
export function PersonHeader({ id, person, active }: { id: string; person: PersonPage; active: PersonTab }) {
  const title = personTitle(person);
  const own = person.kind === "student" ? person.access.relation === "self" : person.is_me;
  const tabs: { key: PersonTab; label: string; href: string }[] = [
    { key: "list", label: "List", href: `/household/${id}` },
    ...(person.kind === "student" ? [{ key: "numbers" as const, label: "Numbers", href: `/household/${id}/numbers` }] : []),
  ];
  return (
    <div className="space-y-4">
      <Link href="/household" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Household
      </Link>
      <h1 className="font-display text-3xl font-extrabold tracking-tight break-words sm:text-4xl">
        {title}
        {own && <span className="ml-2 align-middle text-base font-semibold text-muted-foreground">(you)</span>}
      </h1>
      {person.kind === "student" && person.access.relation === "guardian" && (
        <GuardianBanner studentName={person.access.student.display_name} canEdit={person.access.canEdit} />
      )}
      {tabs.length > 1 && (
        <nav aria-label={`${title}'s pages`} className="flex gap-1 border-b">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors",
                t.key === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
