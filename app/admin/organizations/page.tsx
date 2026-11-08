import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { PageHeader, Empty } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDate } from "@/lib/admin/console";
import { ORG_KIND_LABEL } from "@/lib/org-rules";
import { ORG_PAGE_SIZE, listOrganizations } from "@/lib/admin/organizations";

export const metadata: Metadata = { title: "Organizations", robots: { index: false, follow: false } };

const BASE = "/admin/organizations";

/** "/admin/organizations?q=…&page=N", leaving out what's empty or the first page. */
function orgsHref(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${BASE}?${query}` : BASE;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * /admin/organizations (specs/product/counselor-portal.md "The channel"; specs/product/admin.md "the admin console
 * lists organizations"): every counselor organization, newest first, or the ones matching `?q=` (the organization's
 * name, its join code, its high school, or a member's name), as Households searches
 * (specs/product/admin-redesign.md "People": "Organizations get a search like the other two lists"). One match on a
 * search opens the organization.
 */
export default async function OrganizationsPage({ searchParams }: PageProps<"/admin/organizations">) {
  await connection();
  await requireAdmin();
  const params = await searchParams;
  const raw = params.q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const list = await listOrganizations(q, page);
  if (q && list.total === 1 && page === 1) redirect(`${BASE}/${list.rows[0].id}`);
  if (list.rows.length === 0 && page > 1) redirect(orgsHref(q, 1));
  const pages = Math.max(1, Math.ceil(list.total / ORG_PAGE_SIZE));
  const from = (page - 1) * ORG_PAGE_SIZE + 1;

  return (
    <>
      <PageHeader help="organization" title="Organizations" subtitle="Every counselor's or school's caseload: who is in it, how many students, and how many are still waiting to join." />
      <AdminSearch
        defaultValue={q}
        id="organizations-search"
        className="max-w-xl"
        action={BASE}
        label="Search organizations"
        placeholder="Organization, member name, join code"
      />
      {list.total === 0 ? (
        <div className="mt-6">
          <Empty>{q ? <>No organization matches &ldquo;{q}&rdquo;. Try part of its name, a member&rsquo;s name, or its join code.</> : "No organizations yet."}</Empty>
        </div>
      ) : (
        <div className="mt-6">
          <p className="mb-2 text-sm text-muted-foreground" role="status">
            {q ? `${list.total.toLocaleString("en-US")} ${list.total === 1 ? "match" : "matches"} for “${q}”` : `${list.total.toLocaleString("en-US")} organizations, newest first`}
            {pages > 1 && ` · showing ${from.toLocaleString("en-US")} to ${(from + list.rows.length - 1).toLocaleString("en-US")}`}
          </p>
          <ul className="divide-y rounded-2xl border bg-card">
            {list.rows.map((o) => (
              <li key={o.id}>
                <Link
                  href={`${BASE}/${o.id}`}
                  className="flex min-h-14 flex-col gap-1 p-3.5 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4"
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold break-words">{o.name}</span>
                      {o.deleted_at && <StatusChip label="Deleted" tone="danger" />}
                    </span>
                    <span className="block text-sm break-words text-muted-foreground">
                      {ORG_KIND_LABEL[o.kind]}
                      {o.highSchoolName && <> · {o.highSchoolName}</>}
                      {" · "}
                      {o.members.map((m) => m.name ?? "Unnamed").join(", ") || "No members"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {plural(o.liveStudents, "student", "students")}
                      {o.pendingInvitations > 0 && <> · {plural(o.pendingInvitations, "invitation waiting", "invitations waiting")}</>}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">Created {fmtDate(o.created)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
              {page > 1 ? (
                <Link href={orgsHref(q, page - 1)} rel="prev" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
                  Previous {ORG_PAGE_SIZE}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link href={orgsHref(q, page + 1)} rel="next" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
                  Next {ORG_PAGE_SIZE}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      )}
    </>
  );
}
