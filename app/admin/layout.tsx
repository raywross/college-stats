import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Wrench } from "lucide-react";
import { AdminRail } from "@/components/admin/AdminRail";
import { MfaStep } from "@/components/admin/MfaStep";
import { adminState } from "@/lib/admin/auth";
import { shellFor } from "@/lib/admin/console";

// Never indexed, never followed; the site-wide title template still appends the site name.
export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };

/**
 * The admin console's frame (specs/product/admin.md "The console"). It decides what the person sees by their standing,
 * from adminState() (lib/admin/auth.ts):
 *
 *   not an admin (or signed out, or unconfigured)  → a 404: the console's existence isn't advertised
 *   signed in, but the admin migration isn't there → a setup notice
 *   an admin at aal1                               → the second-factor step in place of every page
 *   an admin at aal2                               → the rail and the page
 *
 * A layout does not guard its pages (they render in parallel and a page can be reached by its own request, a Server
 * Action, or a route handler), so every page and action calls requireAdmin()/withAdmin() too, and the database checks
 * is_admin() on every read and write. Analytics doesn't run here: AnalyticsProvider renders nothing under /admin.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const shell = shellFor(await adminState());
  if (shell.shell === "not-found") notFound();
  if (shell.shell === "setup") return <SetupNotice />;
  if (shell.shell === "mfa") return <MfaStep enrolled={shell.enrolled} />;
  return (
    <div className="mx-auto flex w-full max-w-[90rem] flex-col lg:flex-row">
      <AdminRail />
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <span className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <Wrench className="size-7" aria-hidden />
      </span>
      <h1 className="mt-6 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">The console isn&apos;t set up yet</h1>
      <p className="mt-3 text-sm text-muted-foreground sm:text-base">
        This Supabase project doesn&apos;t have the admin migration (<span className="font-mono">20261012200000_admin.sql</span>) applied. Apply it, add the
        first admin in the SQL Editor, and reload.
      </p>
    </div>
  );
}
