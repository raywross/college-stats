import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

type Params = Record<string, string | string[] | undefined>;

function hrefFor(params: Params, page: number) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v && k !== "page") next.set(k, v);
  if (page > 1) next.set("page", String(page));
  const qs = next.toString();
  return qs ? `/explore?${qs}` : "/explore";
}

/** Page numbers with ellipses: 1 … 4 5 [6] 7 8 … 40 */
function pageList(page: number, pages: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) out.push(p);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

export function Pagination({
  params,
  page,
  pages,
  total,
  perPage,
}: {
  params: Params;
  page: number;
  pages: number;
  total: number;
  perPage: number;
}) {
  if (pages <= 1) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const btn = "inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm font-semibold transition-colors";

  return (
    <nav aria-label="Pagination" className="flex flex-col items-center gap-3 pt-4 sm:flex-row sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {num(from)}–{num(to)} of <span className="font-semibold text-foreground">{num(total)}</span>
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(params, page - 1)} className={cn(btn, "border bg-card hover:border-foreground/40")} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Link>
        ) : (
          <span className={cn(btn, "border opacity-40")} aria-hidden>
            <ChevronLeft className="size-4" />
          </span>
        )}
        {pageList(page, pages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-muted-foreground">
              …
            </span>
          ) : (
            <Link
              key={p}
              href={hrefFor(params, p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(btn, p === page ? "bg-foreground text-background" : "hidden hover:bg-muted sm:inline-flex")}
            >
              {p}
            </Link>
          )
        )}
        {page < pages ? (
          <Link href={hrefFor(params, page + 1)} className={cn(btn, "border bg-card hover:border-foreground/40")} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={cn(btn, "border opacity-40")} aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
