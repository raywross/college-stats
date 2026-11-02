"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { track } from "@/lib/analytics";
import { formatJoinCode } from "@/lib/org-rules";
import { cn } from "@/lib/utils";

/**
 * The join code and its link (specs "How a student joins", the join-code door): "QUAD-RIVERA" large enough to read
 * off a slide, the `/join/<code>` link, and Copy. Copying counts as showing the code (`org_student_invited
 * {method: "code_shown"}`), the one way the site knows a code went out.
 */
export function JoinCode({ code, link, className }: { code: string; link: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("space-y-2", className)}>
      <p className="font-display text-2xl font-extrabold tracking-wide break-all sm:text-3xl">{formatJoinCode(code)}</p>
      <div className="flex min-w-0 items-center gap-2">
        <input
          readOnly
          value={link}
          aria-label="Join link"
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 font-mono text-xs outline-none dark:bg-input/30"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              track("org_student_invited", { method: "code_shown" });
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted"
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
