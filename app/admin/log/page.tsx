import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Empty, PageHeader } from "@/components/admin/Panel";
import { LogRows } from "@/components/admin/LogRows";
import { requireAdmin } from "@/lib/admin/auth";
import { LOG_ACTIONS, TARGET_KINDS, logHref, parseLogQuery } from "@/lib/admin/console";
import { adminLog, adminsList } from "@/lib/admin/people";

export const metadata: Metadata = { title: "Log", robots: { index: false, follow: false } };

const selectCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * /admin/log (specs/product/admin.md "The console"): every admin action, newest first, filtered by action, admin, or
 * target, in the URL, and paged by the id of the last row seen ("Older"). The log holds no token, link, or password.
 */
export default async function LogPage({ searchParams }: PageProps<"/admin/log">) {
  await connection();
  await requireAdmin();
  const query = parseLogQuery(await searchParams);
  const [{ rows, next }, admins] = await Promise.all([adminLog(query), adminsList()]);
  const filtered = Boolean(query.action || query.adminId || query.targetKind || query.targetId);

  return (
    <>
      <PageHeader title="Log" subtitle="Every admin action, newest first." />
      <form action="/admin/log" method="get" className="mb-5 grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm font-semibold">
          Action
          <select name="action" defaultValue={query.action ?? ""} className={selectCls}>
            <option value="">Any action</option>
            {Object.entries(LOG_ACTIONS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Admin
          <select name="admin" defaultValue={query.adminId ?? ""} className={selectCls}>
            <option value="">Any admin</option>
            {admins.map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.name ?? a.email ?? a.user_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Target
          <select name="kind" defaultValue={query.targetKind ?? ""} className={selectCls}>
            <option value="">Any target</option>
            {TARGET_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Target id
          <input name="target" defaultValue={query.targetId ?? ""} placeholder="Paste an id" autoComplete="off" spellCheck={false} className={selectCls} />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
          <button type="submit" className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
            Filter
          </button>
          {filtered && (
            <Link href="/admin/log" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? <Empty>{filtered ? "Nothing matches those filters." : "Nothing has been logged yet."}</Empty> : <LogRows rows={rows} />}

      <nav aria-label="Pages of the log" className="mt-4 flex items-center justify-between text-sm">
        {query.before !== undefined ? (
          <Link href={logHref({ ...query, before: undefined })} className="font-semibold text-primary underline-offset-4 hover:underline">
            Back to the newest
          </Link>
        ) : (
          <span />
        )}
        {next !== null && (
          <Link href={logHref({ ...query, before: next })} className="font-semibold text-primary underline-offset-4 hover:underline">
            Older
          </Link>
        )}
      </nav>
    </>
  );
}
