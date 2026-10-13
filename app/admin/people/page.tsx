import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PageHeader, Empty } from "@/components/admin/Panel";
import { StatusChip, StatusChips } from "@/components/admin/StatusChip";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { requireAdmin } from "@/lib/admin/auth";
import { KIND_LABELS, fmtDate, resultHref, singleHitHref } from "@/lib/admin/console";
import { PEOPLE_PAGE_SIZE, listPeople, searchPeople, type SearchRow } from "@/lib/admin/people";

export const metadata: Metadata = { title: "People", robots: { index: false, follow: false } };

/**
 * /admin/people?q=…: the results of admin_search_people (specs/product/admin.md "Search"). One hit opens its page;
 * none or several list here. With no q, every account and managed student record, newest first, PEOPLE_PAGE_SIZE at a
 * time (admin_list_people, ?page=N). Households have their own page (owner, 2026-10-13): a search here lists people
 * and student records, and links to Households when households or invitations match too. This list is the only place
 * on the site that shows an email next to a name.
 */
export default async function PeoplePage({ searchParams }: PageProps<"/admin/people">) {
  await connection();
  await requireAdmin();
  const params = await searchParams;
  const raw = params.q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const hits = q ? await searchPeople(q) : [];
  const only = singleHitHref(hits);
  if (only) redirect(only);
  const rows = hits.filter((r) => r.kind === "user" || r.kind === "student");
  const elsewhere = hits.length - rows.length;
  const list = q ? null : await listPeople(page);
  if (list && list.rows.length === 0 && page > 1) redirect("/admin/people");
  const pages = list ? Math.max(1, Math.ceil(list.total / PEOPLE_PAGE_SIZE)) : 1;
  const from = (page - 1) * PEOPLE_PAGE_SIZE + 1;

  return (
    <>
      <PageHeader title="People" subtitle="Accounts and student records. Paused and deleted accounts are included." />
      <AdminSearch defaultValue={q} id="people-search" className="max-w-xl" />
      <div className="mt-6">
        {list ? (
          list.total === 0 ? (
            <Empty>No accounts yet.</Empty>
          ) : (
            <>
              <p className="mb-2 text-sm text-muted-foreground" role="status">
                {list.total.toLocaleString("en-US")} people, newest first · showing {from.toLocaleString("en-US")} to{" "}
                {(from + list.rows.length - 1).toLocaleString("en-US")}
              </p>
              <PeopleList rows={list.rows} />
              {pages > 1 && (
                <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
                  {page > 1 ? (
                    <Link href={page === 2 ? "/admin/people" : `/admin/people?page=${page - 1}`} rel="prev" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
                      Previous {PEOPLE_PAGE_SIZE}
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    Page {page} of {pages}
                  </span>
                  {page < pages ? (
                    <Link href={`/admin/people?page=${page + 1}`} rel="next" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
                      Next {PEOPLE_PAGE_SIZE}
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          )
        ) : rows.length === 0 ? (
          <Empty>
            No one matches &ldquo;{q}&rdquo;.{" "}
            {elsewhere > 0 && (
              <>
                <Link href={`/admin/households?q=${encodeURIComponent(q)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                  See matching households
                </Link>
                .{" "}
              </>
            )}
            Try part of a name or email. To look up a college, use{" "}
            <Link href={`/admin/colleges?q=${encodeURIComponent(q)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
              Colleges
            </Link>
            .
          </Empty>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              {rows.length} {rows.length === 1 ? "match" : "matches"} for &ldquo;{q}&rdquo;
              {elsewhere > 0 && (
                <>
                  {" · "}
                  <Link href={`/admin/households?q=${encodeURIComponent(q)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                    households and invitations matching too
                  </Link>
                </>
              )}
            </p>
            <PeopleList rows={rows} />
          </>
        )}
      </div>
    </>
  );
}

/** The rows, as links to each one's page: shared by the search results and the unsearched list. */
function PeopleList({ rows }: { rows: SearchRow[] }) {
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {rows.map((r) => {
        const href = resultHref(r);
        const title = r.name ?? r.email ?? "No name";
        return (
          <li key={`${r.kind}-${r.id}`}>
            <Link href={href ?? "#"} className="flex min-h-14 flex-col gap-1 p-3.5 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4">
              <span className="min-w-0 space-y-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold break-words">{title}</span>
                  <span className="text-xs text-muted-foreground">{KIND_LABELS[r.kind]}</span>
                  <StatusChips status={r.status} />
                  {r.email_confirmed === false && <StatusChip label="Email not confirmed" tone="warn" />}
                </span>
                {r.email && <span className="block text-sm break-all text-muted-foreground">{r.email}</span>}
                {r.household && r.kind !== "household" && <span className="block text-xs text-muted-foreground">{r.household} household</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                Created {fmtDate(r.created)}
                {r.last_sign_in && <> · last signed in {fmtDate(r.last_sign_in)}</>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
