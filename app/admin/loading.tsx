import { ConsolePageSkeleton } from "@/components/admin/InboxSkeletons";

/**
 * Every console page's instant state (specs/product/admin-speed.md "Wave 1" fix 5): Next nests this inside
 * app/admin/layout.tsx, so the rail and the tab bar stay and the page's place shows a header and three panel frames
 * the moment a console link is followed, until the page streams in. The layout's guards (a 404 for anyone but an
 * admin, the second-factor step) run before it, so nothing here is shown to anyone else. Reads nothing.
 */
export default function AdminLoading() {
  return <ConsolePageSkeleton />;
}
