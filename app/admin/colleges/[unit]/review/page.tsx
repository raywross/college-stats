import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { ReviewTable } from "@/components/admin/steward/ReviewTable";
import { TodoTable } from "@/components/admin/steward/TodoTable";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readReviewRows } from "@/lib/admin/steward-reads";
import { linkCls } from "@/lib/admin/steward-view";
import { getData } from "@/lib/data";

export const metadata: Metadata = { title: "Review", robots: { index: false, follow: false } };

/**
 * `/admin/colleges/[unit]/review` (specs/product/data-steward.md "The college's Review page"): everything pending for
 * one school. Its To do rows first (no document found, a blocked host), then its open review items and the Steward's
 * pending proposal rows, one row per field or code grouped by code, each with what the site shows now (the profile's
 * own `citeField`), the document at the page, the issue, the recommendation and the proposal; Accept the value,
 * Reject, Leave, and a proposal row's Approve or Decline. Server-rendered behind requireAdmin().
 */
export default async function ReviewPage({ params }: { params: Promise<{ unit: string }> }) {
  await connection();
  await requireAdmin();
  const { unit } = await params;
  if (!/^\d{6,8}$/.test(unit)) notFound();
  const data = await getData();
  const school = data.getSchoolById(unit);
  if (!school) notFound();
  const supabase = await adminSupabase();
  const review = await readReviewRows(supabase as unknown as StoreClient, unit, data);
  const rows = review.groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <PageHeader
        back={
          <Link href={`/admin/colleges/${unit}`} className="text-muted-foreground underline-offset-4 hover:underline">
            {school.name}
          </Link>
        }
        title={`Review ${school.name}`}
        subtitle={
          <>
            What is pending for this college · unit {unit} ·{" "}
            <Link href="/admin/data/issues" className={linkCls}>
              Issues
            </Link>{" "}
            ·{" "}
            <Link href={`/admin/data/holds?unit=${unit}`} className={linkCls}>
              Holds
            </Link>
          </>
        }
      />
      <div className="space-y-5">
        {review.todo.length > 0 && (
          <Panel title="To do" aside={<span className="text-sm text-muted-foreground">Documents a person has to fetch</span>}>
            <TodoTable rows={review.todo} />
          </Panel>
        )}
        <Panel title="Pending" aside={<span className="text-sm text-muted-foreground">{rows} row{rows === 1 ? "" : "s"}</span>}>
          {!review.queueOk && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              Couldn&apos;t read the review queue; only the proposals&apos; rows are shown.
            </p>
          )}
          <ReviewTable groups={review.groups} />
        </Panel>
      </div>
    </>
  );
}
