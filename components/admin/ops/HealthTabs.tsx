import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "colleges", label: "Colleges", href: "/admin/data/health", hint: "The facts the admission estimate reads, college by college" },
  { key: "sources", label: "Sources", href: "/admin/data/health?tab=sources", hint: "Every file we read, and each college's documents" },
] as const;

/** The Health page's two tabs, Colleges and Sources (specs/product/admin-redesign.md "Data"), as links so each is its own URL. */
export function HealthTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Health views" className="flex flex-wrap gap-2 border-b border-border">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          title={t.hint}
          aria-current={t.key === current ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-semibold",
            t.key === current ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
