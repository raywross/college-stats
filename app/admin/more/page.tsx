import type { Metadata } from "next";
import { connection } from "next/server";
import { DoorScreens } from "@/components/admin/DoorScreens";
import { PageHeader } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";

export const metadata: Metadata = { title: "More", robots: { index: false, follow: false } };

/**
 * `/admin/more`, the More door's landing (specs/product/admin-redesign.md "Settings (More)"): Admins, Settings, Log,
 * and Help as cards. The tab bar's More tab opens it on a phone; from `md` the rail lists the same screens.
 */
export default async function MorePage() {
  await connection();
  await requireAdmin();
  return (
    <>
      <PageHeader title="More" help="help" subtitle="Who can open the console, the site's switches, every admin action, and what the console's words mean." />
      <DoorScreens door="more" />
    </>
  );
}
