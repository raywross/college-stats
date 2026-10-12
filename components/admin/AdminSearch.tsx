import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The console's global search box (specs/product/admin.md "The console"): a plain GET form to /admin/people, which
 * opens the page itself when there is one hit and lists the hits otherwise. Names, emails, household names, and
 * user, student, household, or invitation ids. A GET with the query in the URL is fine here: the console is
 * noindex, behind sign-in, and the query is the admin's own.
 */
export function AdminSearch({ defaultValue = "", className, id = "admin-search" }: { defaultValue?: string; className?: string; id?: string }) {
  return (
    <form action="/admin/people" method="get" role="search" className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        Search people, students, households
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Name, email, household, id"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="h-11 w-full min-w-0 rounded-full border border-input bg-background pr-4 pl-10 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
    </form>
  );
}
