import type { Metadata } from "next";
import { connection } from "next/server";
import { HelpList } from "@/components/admin/HelpList";
import { PageHeader } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";
import { githubRepo } from "@/lib/github-app";

export const metadata: Metadata = { title: "Help", robots: { index: false, follow: false } };

/**
 * `/admin/help` (specs/product/admin-redesign.md "Info icons and the Help page"): the console's own glossary
 * (lib/admin/help.ts), every word by door with its longer note, searchable. Each (i) icon's "More" lands on its entry.
 * The public glossary (/glossary) stays separate.
 */
export default async function HelpPage() {
  await connection();
  await requireAdmin();
  return (
    <>
      <PageHeader title="Help" help="help" subtitle="Every word the console uses, what it means, and what you can do about it." />
      <HelpList repo={githubRepo()} />
    </>
  );
}
