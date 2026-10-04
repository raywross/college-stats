import type { ReactNode } from "react";
import type { School, SocialNetwork } from "@/lib/types";
import { SOCIAL_LABELS, SOCIAL_NETWORKS, socialUrl } from "@/lib/social";
import { cn } from "@/lib/utils";

/**
 * One hand-drawn, monochrome glyph per network (specs/school-identity/social-accounts.md, Display): tiny marks that
 * identify a link target, the way every site shows them, not full-color brand logos. `currentColor` throughout, so
 * they inherit the button's text color (and its hover/dark-mode color) for free.
 */
function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.1" cy="6.9" r="1.15" fill="currentColor" />
    </svg>
  );
}

function YouTubeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <rect x="2.3" y="5.8" width="19.4" height="12.4" rx="4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.3 9.1 16 12l-5.7 2.9z" fill="currentColor" />
    </svg>
  );
}

function TikTokGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        d="M13.2 2.8h2.3c.2 1.9 1.5 3.5 3.5 3.8v2.3a6.4 6.4 0 0 1-3.5-1.3v6.1a4.8 4.8 0 1 1-4.8-4.8c.2 0 .4 0 .6.03v2.4a2.5 2.5 0 1 0 2.2 2.48V2.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path d="M4.3 4h3.4l4.3 5.7L16.3 4h3.4l-6 7.8 6.3 8.2h-3.4l-4.6-6-4.9 6H3.7l6.2-8.2z" fill="currentColor" />
    </svg>
  );
}

function FacebookGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M13.4 20v-6.4h2.1l.33-2.5h-2.43v-1.5c0-.72.2-1.21 1.23-1.21h1.3V6.1c-.22-.03-1-.1-1.9-.1-1.88 0-3.17 1.15-3.17 3.26v1.83H8.8v2.5h2.1V20z"
        fill="currentColor"
      />
    </svg>
  );
}

function LinkedInGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.1" cy="8.3" r="1.25" fill="currentColor" />
      <rect x="7" y="10.6" width="2.2" height="7" fill="currentColor" />
      <path
        d="M11.9 10.6h2.1v1.07c.47-.63 1.17-1.27 2.33-1.27 1.9 0 2.67 1.26 2.67 3.13V17.6h-2.2v-3.63c0-.9-.33-1.6-1.27-1.6-.72 0-1.2.5-1.4 1-.07.18-.1.42-.1.68v3.55h-2.14z"
        fill="currentColor"
      />
    </svg>
  );
}

const GLYPH: Record<SocialNetwork, () => ReactNode> = {
  instagram: InstagramGlyph,
  youtube: YouTubeGlyph,
  tiktok: TikTokGlyph,
  x: XGlyph,
  facebook: FacebookGlyph,
  linkedin: LinkedInGlyph,
};

/**
 * The college's social accounts as small round icon buttons, in SOCIAL_NETWORKS order
 * (specs/school-identity/social-accounts.md, Display). Self-contained (one inline-flex group), so HeroIdentity's
 * flex row can place it after the official links without knowing its internals. Nothing when the college has none.
 */
export function SocialLinks({ school, className }: { school: School; className?: string }) {
  const accounts = school.social;
  if (!accounts) return null;
  const networks = SOCIAL_NETWORKS.filter((n) => accounts[n]);
  if (!networks.length) return null;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {networks.map((network) => {
        const Glyph = GLYPH[network];
        const label = `${school.name} on ${SOCIAL_LABELS[network]}`;
        return (
          <a
            key={network}
            href={socialUrl(network, accounts[network]!)}
            target="_blank"
            rel="noopener"
            aria-label={label}
            title={SOCIAL_LABELS[network]}
            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Glyph />
          </a>
        );
      })}
    </span>
  );
}
