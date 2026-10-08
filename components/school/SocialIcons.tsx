import type { ReactNode } from "react";
import type { School, SocialNetwork } from "@/lib/types";
import { SOCIAL_LABELS, SOCIAL_NETWORKS, socialUrl } from "@/lib/social";
import { cn } from "@/lib/utils";

/**
 * One small mark per network in its own colors (specs/school-identity/social-accounts.md, Display; the owner chose
 * colored marks over monochrome on 2026-10-04): Instagram's gradient tile, YouTube's red play button, TikTok's note
 * with its cyan and red edges, X, Facebook's blue circle, LinkedIn's blue square. Simple SVG drawn here, not the
 * networks' asset files; the black parts of X and TikTok turn white in dark mode so they read on the indigo background.
 */
function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <defs>
        <radialGradient id="quad-instagram-warm" cx="0.3" cy="1.07" r="1.35">
          <stop offset="0" stopColor="#FFDD55" />
          <stop offset="0.1" stopColor="#FFDD55" />
          <stop offset="0.5" stopColor="#FF543E" />
          <stop offset="1" stopColor="#C837AB" />
        </radialGradient>
        <radialGradient id="quad-instagram-cool" cx="-0.17" cy="0.07" r="0.6">
          <stop offset="0" stopColor="#3771C8" />
          <stop offset="0.13" stopColor="#3771C8" />
          <stop offset="1" stopColor="#6600FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5.6" fill="url(#quad-instagram-warm)" />
      <rect x="2" y="2" width="20" height="20" rx="5.6" fill="url(#quad-instagram-cool)" />
      <rect x="5.9" y="5.9" width="12.2" height="12.2" rx="3.6" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.9" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="15.7" cy="8.3" r="0.95" fill="#fff" />
    </svg>
  );
}

function YouTubeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <rect x="1.5" y="5" width="21" height="14" rx="4.2" fill="#FF0000" />
      <path d="M9.9 8.7 15.6 12l-5.7 3.3z" fill="#fff" />
    </svg>
  );
}

const TIKTOK_NOTE =
  "M13.2 2.8h2.3c.2 1.9 1.5 3.5 3.5 3.8v2.3a6.4 6.4 0 0 1-3.5-1.3v6.1a4.8 4.8 0 1 1-4.8-4.8c.2 0 .4 0 .6.03v2.4a2.5 2.5 0 1 0 2.2 2.48V2.8Z";

function TikTokGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path d={TIKTOK_NOTE} fill="#25F4EE" transform="translate(-0.7 -0.7)" />
      <path d={TIKTOK_NOTE} fill="#FE2C55" transform="translate(0.7 0.7)" />
      <path d={TIKTOK_NOTE} className="fill-black dark:fill-white" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[18px]">
      <path
        d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.59l5.24 6.93zm-1.29 19.5h2.04L6.49 3.24H4.3z"
        className="fill-black dark:fill-white"
      />
    </svg>
  );
}

function FacebookGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <circle cx="12" cy="12" r="10.5" fill="#0866FF" />
      <path
        d="M13.5 22.4v-7.3h2.45l.37-2.85H13.5v-1.82c0-.82.23-1.38 1.41-1.38h1.5V6.5c-.26-.03-1.15-.11-2.19-.11-2.17 0-3.65 1.32-3.65 3.75v2.1H8.12v2.85h2.45v7.3z"
        fill="#fff"
      />
    </svg>
  );
}

function LinkedInGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <rect x="2" y="2" width="20" height="20" rx="3.2" fill="#0A66C2" />
      <circle cx="7.55" cy="7.6" r="1.5" fill="#fff" />
      <rect x="6.25" y="10.1" width="2.6" height="7.9" fill="#fff" />
      <path
        d="M10.95 10.1h2.5v1.15c.42-.72 1.33-1.35 2.67-1.35 2.36 0 2.98 1.55 2.98 3.67V18h-2.6v-4.02c0-.98-.27-1.82-1.33-1.82-1.02 0-1.62.73-1.62 1.85V18h-2.6z"
        fill="#fff"
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

/** The same per-network marks, for callers that build their own buttons around them (the planner's FollowRow). */
export const SOCIAL_GLYPHS: Record<SocialNetwork, () => ReactNode> = GLYPH;

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
            className="inline-flex size-8 items-center justify-center rounded-full transition-[background-color,transform] hover:scale-110 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Glyph />
          </a>
        );
      })}
    </span>
  );
}
