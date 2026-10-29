"use client";

/**
 * Download and copy (specs/product/essays/workspace.md "The round trip"): `.docx`, `.txt`, or copy to the
 * clipboard. The downloads are plain links to `GET /advisor/essays/[id]/export` (the browser's own download, no
 * JavaScript needed to get the file); copy reads the field's current text directly, so it copies exactly what's on
 * screen, saved or not.
 */
import { useState } from "react";
import { Copy, Download } from "lucide-react";
import { track } from "@/lib/analytics";

const row = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted";

export function ExportMenu({ essayId, person, text }: { essayId: string; person: string | null; text: string }) {
  const [copied, setCopied] = useState(false);
  const q = person ? `&for=${person}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      track("essay_exported", { format: "copy" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/advisor/essays/${essayId}/export?format=docx${q}`}
        onClick={() => track("essay_exported", { format: "docx" })}
        className={row}
      >
        <Download className="size-4" aria-hidden />
        .docx
      </a>
      <a
        href={`/advisor/essays/${essayId}/export?format=txt${q}`}
        onClick={() => track("essay_exported", { format: "txt" })}
        className={row}
      >
        <Download className="size-4" aria-hidden />
        .txt
      </a>
      <button type="button" onClick={copy} className={row}>
        <Copy className="size-4" aria-hidden />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default ExportMenu;
