import { SITE_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Four quadrants = the "quad". Each tile is one of the data domains. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect x="2" y="2" width="13" height="13" rx="4" fill="var(--d-admissions)" />
      <rect x="17" y="2" width="13" height="13" rx="6.5" fill="var(--pop)" />
      <rect x="2" y="17" width="13" height="13" rx="6.5" fill="var(--d-size)" />
      <rect x="17" y="17" width="13" height="13" rx="4" fill="var(--d-diversity)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="transition-transform duration-500 group-hover:rotate-90" />
      <span className="font-display text-xl font-extrabold tracking-tight">{SITE_NAME}</span>
    </span>
  );
}
