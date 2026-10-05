import { NextResponse } from "next/server";
import { exportListCsv, getListWithItems } from "@/lib/lists";

/** GET /me/lists/[id]/export: the list as a CSV download (Scoir-compatible columns; specs/product/saved-lists.md). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const withItems = await getListWithItems(id);
  if (!withItems) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const csv = await exportListCsv(id);
  if (csv === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const filename = `${withItems.list.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list"}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
