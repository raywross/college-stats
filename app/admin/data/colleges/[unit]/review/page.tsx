import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { ReviewTable } from "@/components/admin/steward/ReviewTable";
import { TodoTable } from "@/components/admin/steward/TodoTable";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readReviewRows } from "@/lib/admin/steward-reads";
import { linkCls } from "@/lib/admin/steward-view";
import { codeLabel } from "@/lib/admin/words";
import { getData } from "@/lib/data";

export const metadata: Metadata = { title: "Review", robots: { index: false, follow: false } };

const inputCls = "mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm dark:bg-input/30";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

/**
 * `/admin/data/colleges/[unit]/review` (specs/product/data-steward.md "The college's Review page";
 * specs/product/admin-redesign.md "The screens"): everything pending for one school, and the one place a review item is
 * decided. Its To do rows first (no document found, a blocked host), then its open review items and the Steward's
 * pending proposal rows, one row per field or code grouped by code, each with what the site shows now (the profile's
 * own `citeField`), the document at the page, the finding, the recommendation and the proposal; Accept the value,
 * Reject, Leave, and a proposal row's Approve or Decline. The filters Holds had live here: `?code=` narrows the rows
 * to one field, and `?college=` (a name or a unit id) opens another college's Review page with the same code.
 */
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ unit: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const { unit } = await params;
  if (!/^\d{6,8}$/.test(unit)) notFound();
  const query = (await searchParams) ?? {};
  const code = one(query.code);
  const college = one(query.college);
  const data = await getData();
  if (college) {
    const target = data.getSchoolById(college) ? college : (data.searchSchools(college, 1)[0]?.id ?? null);
    if (target && target !== unit) redirect(`/admin/data/colleges/${target}/review${code ? `?code=${encodeURIComponent(code)}` : ""}`);
  }
  const school = data.getSchoolById(unit);
  if (!school) notFound();
  const supabase = await adminSupabase();
  const review = await readReviewRows(supabase as unknown as StoreClient, unit, data);
  const groups = code ? review.groups.filter((g) => g.code === code || g.label === code) : review.groups;
  const rows = groups.reduce((n, g) => n + g.rows.length, 0);
  const notFoundCollege = college !== null && !data.getSchoolById(college) && data.searchSchools(college, 1).length === 0;

  return (
    <>
      <PageHeader
        back={
          <Link href={`/admin/data/colleges/${unit}`} className="text-muted-foreground underline-offset-4 hover:underline">
            {school.name}
          </Link>
        }
        title={`Review ${school.name}`}
        help="review-page"
        subtitle={
          <>
            What is pending for this college · unit {unit} ·{" "}
            <Link href="/admin/steward/findings" className={linkCls}>
              Findings
            </Link>
          </>
        }
      />
      <div className="space-y-5">
        <form method="get" action={`/admin/data/colleges/${unit}/review`} className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block text-sm font-semibold">
            College
            <input name="college" defaultValue={college ?? ""} placeholder="Another college's name or id" className={inputCls} />
          </label>
          <label className="block text-sm font-semibold">
            Field
            <select name="code" defaultValue={code ?? ""} className={inputCls}>
              <option value="">Every field</option>
              {review.groups.map((g) => (
                <option key={g.code} value={g.code}>
                  {codeLabel(g.code)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-3">
            <button type="submit" className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
              Filter
            </button>
            {(code || college) && (
              <Link href={`/admin/data/colleges/${unit}/review`} className={`inline-flex min-h-11 items-center text-sm ${linkCls}`}>
                Clear
              </Link>
            )}
          </div>
          {notFoundCollege && (
            <p role="status" className="text-sm text-muted-foreground sm:col-span-3">
              No college matches &ldquo;{college}&rdquo;; showing {school.name}.
            </p>
          )}
        </form>
        {review.todo.length > 0 && (
          <Panel title="To do" help="to-do" aside={<span className="text-sm text-muted-foreground">Documents a person has to fetch</span>}>
            <TodoTable rows={review.todo} />
          </Panel>
        )}
        <Panel title="Pending" help="review-item" aside={<span className="text-sm text-muted-foreground">{rows} row{rows === 1 ? "" : "s"}{code ? ` · ${codeLabel(code)}` : ""}</span>}>
          {!review.queueOk && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              Couldn&apos;t read the review queue; only the proposals&apos; rows are shown.
            </p>
          )}
          <ReviewTable groups={groups} />
        </Panel>
      </div>
    </>
  );
}
