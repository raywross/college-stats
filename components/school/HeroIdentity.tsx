import type { School } from "@/lib/types";
import { OfficialLinks } from "@/components/school/OfficialLinks";
import { SocialLinks } from "@/components/school/SocialIcons";

/**
 * The profile hero's official links and social accounts, under the "Known for" chips (specs/school-identity/links.md,
 * social-accounts.md). The links pill row needs the full scrolling width on phones (like the chips above it), so it
 * forces a line break there and the social icons drop to their own line; from `sm:` up, once the pills wrap instead
 * of scrolling, the icons share the row after them. Hidden entirely when the college has neither.
 */
export function HeroIdentity({ school }: { school: School }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 empty:hidden sm:mt-5">
      <OfficialLinks school={school} />
      <SocialLinks school={school} />
    </div>
  );
}
