import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PageHeader, Empty } from "@/components/admin/Panel";
import { StatusChips } from "@/components/admin/StatusChip";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDate } from "@/lib/admin/console";
import { PEOPLE_PAGE_SIZE, listHouseholds } from "@/lib/admin/people";

export const metadata: Metadata = { title: "Households", robots: { index: false, follow: false } };

const BASE = "/admin/households";

/** "/admin/households?q=…&page=N", leaving out what's empty or the first page. */
function householdsHref(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${BASE}?${query}` : BASE;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * /admin/households: every household, newest first, PEOPLE_PAGE_SIZE at a time (admin_list_households), or the ones
 * matching ?q= (the household's name, a member's name or email, a pending invitation's email). Separate from People
 * (owner, 2026-10-13). One match on a search opens the household.
 */
export default async function HouseholdsPage({ searchParams }: PageProps<"/admin/households">) {
  await connection();
  await requireAdmin();
  const params = await searchParams;
  const raw = params.q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const list = await listHouseholds(q, page);
  if (q && list.total === 1 && page === 1) redirect(`${BASE}/${list.rows[0].id}`);
  if (list.rows.length === 0 && page > 1) redirect(householdsHref(q, 1));
  const pages = Math.max(1, Math.ceil(list.total / PEOPLE_PAGE_SIZE));
  const from = (page - 1) * PEOPLE_PAGE_SIZE + 1;

  return (
    <>
      <PageHeader title="Households" subtitle="Every family, who is in it, and invitations still waiting. Closed households are included." />
      <AdminSearch
        defaultValue={q}
        id="households-search"
        className="max-w-xl"
        action={BASE}
        label="Search households"
        placeholder="Household, member name or email, invitation email"
      />
      <div className="mt-6">
        {list.total === 0 ? (
          <Empty>{q ? <>No household matches &ldquo;{q}&rdquo;. Try part of a family name or a member&rsquo;s email.</> : "No households yet."}</Empty>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground" role="status">
              {q ? `${list.total.toLocaleString("en-US")} ${list.total === 1 ? "match" : "matches"} for “${q}”` : `${list.total.toLocaleString("en-US")} households, newest first`}
              {pages > 1 && ` · showing ${from.toLocaleString("en-US")} to ${(from + list.rows.length - 1).toLocaleString("en-US")}`}
            </p>
            <ul className="divide-y rounded-2xl border bg-card">
              {list.rows.map((h) => (
                <li key={h.id}>
                  <Link
                    href={`${BASE}/${h.id}`}
                    className="flex min-h-14 flex-col gap-1 p-3.5 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4"
                  >
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold break-words">{h.name}</span>
                        <StatusChips status={h.status} />
                      </span>
                      <span className="block text-sm break-words text-muted-foreground">{h.members ?? "No members"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {plural(h.guardians, "parent", "parents")} · {plural(h.students, "student", "students")}
                        {h.invitations > 0 && <> · {plural(h.invitations, "invitation waiting", "invitations waiting")}</>}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">Created {fmtDate(h.created)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
                {page > 1 ? (
                  <Link href={householdsHref(q, page - 1)} rel="prev" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
                    Previous {PEOPLE_PAGE_SIZE}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Link href={householdsHref(q, page + 1)} rel="next" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
                    Next {PEOPLE_PAGE_SIZE}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}
