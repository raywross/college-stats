import { permanentRedirect } from "next/navigation";
import { essaysListRedirect } from "@/lib/essays/rows";

type Search = Promise<{ for?: string | string[]; college?: string | string[] }>;

/**
 * /advisor/essays, the workspace's old list page, is now the advisor's Essays tab (specs/product/essays/tab.md "The
 * tab strip"): a permanent (308) redirect to `planHref({ tab: "essays", person, college })`, keeping `?for=` and
 * turning `?college=` into the college card's anchor. The editor (/advisor/essays/<id>) and the package
 * (/advisor/essays/package/<unit>) stay where they are.
 */
export default async function EssaysPage({ searchParams }: { searchParams: Search }) {
  permanentRedirect(essaysListRedirect(await searchParams));
}
