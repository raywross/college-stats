import type { School } from "@/lib/types";
import { OfficialLinks } from "@/components/school/OfficialLinks";
import { SocialLinks } from "@/components/school/SocialIcons";

/**
 * The profile hero's row of official links and social accounts (specs/school-identity/links.md, social-accounts.md).
 * Hidden when the college has neither.
 */
export function HeroIdentity({ school }: { school: School }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 empty:hidden sm:mt-5">
      <OfficialLinks school={school} />
      <SocialLinks school={school} />
    </div>
  );
}
