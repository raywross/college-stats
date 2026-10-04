import type { School } from "@/lib/types";

/**
 * The college's social accounts as small round icon buttons, in SOCIAL_NETWORKS order
 * (specs/school-identity/social-accounts.md, Display). Nothing when it has none.
 */
export function SocialLinks({ school }: { school: School }) {
  // Built by the social-accounts track.
  void school;
  return null;
}
