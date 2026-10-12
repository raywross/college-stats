import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PageHeader, Empty } from "@/components/admin/Panel";
import { StatusChips } from "@/components/admin/StatusChip";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { requireAdmin } from "@/lib/admin/auth";
import { KIND_LABELS, fmtDate, resultHref, singleHitHref } from "@/lib/admin/console";
import { searchPeople } from "@/lib/admin/people";

export const metadata: Metadata = { title: "People", robots: { index: false, follow: false } };

/**
 * /admin/people?q=…: the results of admin_search_people (specs/product/admin.md "Search"). One hit opens its page;
 * none or several list here. This list is the only place on the site that shows an email next to a name.
 */
export default async function PeoplePage({ searchParams }: PageProps<"/admin/people">) {
  await connection();
  await requireAdmin();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const rows = q ? await searchPeople(q) : [];
  const only = singleHitHref(rows);
  if (only) redirect(only);

  return (
    <>
      <PageHeader title="People" subtitle="People, student records, households, and invitations. Paused and deleted accounts are included." />
      <AdminSearch defaultValue={q} id="people-search" className="max-w-xl" />
      <div className="mt-6">
        {!q ? (
          <Empty>Search a name, an email, a household, or paste a user, student, household, or invitation id. Colleges and high schools have their own pages.</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            No one matches &ldquo;{q}&rdquo;. Try part of a name or email. To look up a college, use{" "}
            <Link href={`/admin/colleges?q=${encodeURIComponent(q)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
              Colleges
            </Link>
            .
          </Empty>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              {rows.length} {rows.length === 1 ? "match" : "matches"} for &ldquo;{q}&rdquo;
            </p>
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
          </>
        )}
      </div>
    </>
  );
}
