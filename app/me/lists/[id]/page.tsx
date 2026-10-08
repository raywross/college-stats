import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { ListPage } from "@/components/lists/ListPage";
import { authConfigured, requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "My list", robots: { index: false } };

/**
 * /me/lists/[id] (specs/product/saved-lists.md): one list, any owner kind (a student's, or a guardian's own). The
 * body is components/lists/ListPage.tsx, shared with the household hub's person pages.
 */
export default async function MeListPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser(`/me/lists`);
  return <ListPage listId={(await params).id} basePath="/me/lists" backHref="/account" backLabel="Your account" />;
}
