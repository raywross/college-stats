import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Crest } from "@/components/school/Crest";
import { crestBrand } from "@/lib/brand";
import { getData } from "@/lib/data";
import { authConfigured } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { CATEGORY_LABELS, ROUND_LABELS, isListCategory, isListRound, type ListCategory } from "@/lib/list-rules";

export const metadata: Metadata = { title: "A shared list", robots: { index: false, follow: false } };

interface SharePreview {
  list_id: string;
  list_name: string;
  items: { unit_id: string; category: string; round: string | null }[];
}

/**
 * /l/[token] (specs/product/saved-lists.md "Share"): a read-only view of someone's list — colleges and category
 * only, never notes, status, or outcomes. The anon RPC (list_share_preview) enforces that server-side; this page
 * doesn't add anything back. Not indexed.
 */
export default async function SharedListPage({ params }: { params: Promise<{ token: string }> }) {
  if (!authConfigured()) return <AuthUnavailable title="Sharing isn't available here" />;
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("list_share_preview", { p_token: token });
  if (error || !data) notFound();
  const preview = data as SharePreview;

  const { getSchoolById } = await getData();
  const groups: { category: ListCategory; items: { unit_id: string; round: string | null }[] }[] = (["reach", "target", "likely", "unsorted"] as const).map((category) => ({
    category,
    items: preview.items.filter((i) => isListCategory(i.category) && i.category === category),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="text-sm font-semibold text-muted-foreground">A shared college list</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">{preview.list_name}</h1>
      </header>
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.category}>
              <h2 className="mb-2 font-display text-lg font-bold">{CATEGORY_LABELS[g.category]}</h2>
              <div className="space-y-2">
                {g.items.map((item) => {
                  const school = getSchoolById(item.unit_id);
                  if (!school) return null;
                  return (
                    <Link key={item.unit_id} href={`/schools/${item.unit_id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-3 hover:border-primary/40">
                      <Crest id={school.unit_id} name={school.name} size="sm" brand={crestBrand(school)} />
                      <div className="min-w-0 flex-1">
                        <p className="font-display font-bold">{school.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {school.location.city}, {school.location.state}
                          {item.round && isListRound(item.round) ? ` · ${ROUND_LABELS[item.round]}` : ""}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ),
      )}
      {preview.items.length === 0 && <p className="text-sm text-muted-foreground">This list is empty so far.</p>}
    </div>
  );
}
