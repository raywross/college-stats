"use client";

/**
 * Upload or paste a draft (specs/product/essays/workspace.md "The round trip"): the file picker on desktop, the
 * share sheet on a phone (Word or Docs can send a `.docx` straight here), or a paste from the clipboard (how Notes
 * and a phone's Docs app come across). Either way it lands as a **new version** — never over the current text — so
 * the student opens the version list afterward to compare it with what's there and restore the one they want.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { track } from "@/lib/analytics";
import { importPastedText, importUploadedFile } from "@/lib/essays/store";

const trigger = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted";
const field = "block min-h-32 w-full resize-none rounded-2xl border bg-background p-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Tab = "file" | "paste";

export function ImportSheet({ essayId }: { essayId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("file");
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const done = () => {
    setMessage("Imported as a new version. Open the version list below to compare it with what's there, and restore the one you want.");
    setPasted("");
    if (fileInput.current) fileInput.current.value = "";
    router.refresh();
  };

  const submitFile = () => {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setMessage("Choose a file first.");
      return;
    }
    start(async () => {
      setMessage(null);
      const form = new FormData();
      form.set("essayId", essayId);
      form.set("file", file);
      const r = await importUploadedFile(form);
      if (!r.ok) return setMessage(r.message);
      track("essay_imported", { format: "uploaded" });
      done();
    });
  };

  const submitPaste = () => {
    if (!pasted.trim()) {
      setMessage("Paste the text first.");
      return;
    }
    start(async () => {
      setMessage(null);
      const r = await importPastedText(essayId, pasted);
      if (!r.ok) return setMessage(r.message);
      track("essay_imported", { format: "pasted" });
      done();
    });
  };

  return (
    <SheetDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setMessage(null);
      }}
      title="Bring in a draft"
      description="From Word, Google Docs, or Notes. This never replaces what's here — it adds a version to compare."
      trigger={{ className: trigger, label: "Upload or paste a draft", content: (
        <>
          <Upload className="size-4" aria-hidden />
          Upload or paste
        </>
      ) }}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <button type="button" onClick={() => setTab("file")} className={`min-h-11 flex-1 rounded-full px-3 text-sm font-semibold ${tab === "file" ? "bg-foreground text-background" : "ring-1 ring-border"}`}>
            Upload a file
          </button>
          <button type="button" onClick={() => setTab("paste")} className={`min-h-11 flex-1 rounded-full px-3 text-sm font-semibold ${tab === "paste" ? "bg-foreground text-background" : "ring-1 ring-border"}`}>
            Paste text
          </button>
        </div>

        {tab === "file" ? (
          <div className="space-y-3">
            <label htmlFor="essay-import-file" className="sr-only">
              Choose a .docx or .txt file
            </label>
            <input id="essay-import-file" ref={fileInput} type="file" accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="block w-full text-sm" />
            <p className="text-xs text-muted-foreground">A .docx or a .txt. Comments and tracked changes aren&apos;t kept — only the text.</p>
            <button type="button" disabled={pending} onClick={submitFile} className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60">
              Import
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label htmlFor="essay-import-paste" className="sr-only">
              Paste the draft&apos;s text
            </label>
            <textarea id="essay-import-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste here" className={field} />
            <button type="button" disabled={pending} onClick={submitPaste} className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60">
              Import
            </button>
          </div>
        )}

        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </SheetDialog>
  );
}

export default ImportSheet;
