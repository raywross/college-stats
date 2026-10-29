"use client";

/**
 * The prompt picker (specs/product/essays/workspace.md "Where it lives", "Reuse"), a bottom sheet on phones:
 * - `new`: "Write a new one": every prompt from the plan's colleges, the platforms' own, or free; picking one starts
 *   a draft (or opens the main essay when it exists already).
 * - `reuse`: "Use for another college": prompts of the same kind; each either uses this draft as it is (a link) or
 *   makes a copy that remembers this one (a variant), the suggested choice first.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { track } from "@/lib/analytics";
import { countLabel } from "@/lib/essays/count";
import { createEssay, linkEssay, makeVariant } from "@/lib/essays/store";
import type { PickerGroup, PickerPrompt } from "@/lib/essays/prompts";
import type { ReuseMode } from "@/lib/essays/variants";
import { cn } from "@/lib/utils";

const TRIGGER = "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold";

function LimitLine({ p }: { p: PickerPrompt }) {
  const bits = [p.limit ? `Up to ${countLabel(p.limit.max, null, p.limit.kind)}` : null, p.required === false ? "Optional" : null].filter(Boolean);
  return bits.length ? <p className="mt-0.5 text-xs text-muted-foreground">{bits.join(" · ")}</p> : null;
}

const editorHref = (id: string, person: string | null) => `/advisor/essays/${id}${person ? `?for=${person}` : ""}`;

export function PromptPicker({ groups, person, label = "Write a new one", primary = true }: { groups: PickerGroup[]; person: string | null; label?: string; primary?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pick = (p: PickerPrompt) =>
    start(async () => {
      setMessage(null);
      const r = await createEssay(p.ref);
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      track("essay_created", { prompt_kind: r.kind });
      setOpen(false);
      router.push(editorHref(r.id, person));
    });

  return (
    <SheetDialog
      open={open}
      onOpenChange={setOpen}
      title="Which prompt?"
      description="Pick what you're writing for. You can reuse a draft for other colleges later."
      trigger={{ className: cn(TRIGGER, primary ? "bg-foreground text-background" : "ring-1 ring-border hover:bg-muted"), label, content: label }}
    >
      <div className="mt-4 space-y-5">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h3 className="text-sm font-semibold text-muted-foreground">{g.label}</h3>
            {g.note && <p className="mt-1 text-sm text-muted-foreground italic">{g.note}</p>}
            <ul className="mt-1.5 space-y-1.5">
              {g.prompts.map((p) => (
                <li key={p.ref}>
                  <button type="button" disabled={pending} onClick={() => pick(p)} className="w-full rounded-2xl border px-3 py-2.5 text-left hover:bg-muted disabled:opacity-60">
                    <p className="font-semibold">{p.title}</p>
                    {p.text && <p className="mt-0.5 line-clamp-3 text-sm text-muted-foreground">{p.text}</p>}
                    <LimitLine p={p} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {message && (
          <p className="text-sm text-destructive" role="status">
            {message}
          </p>
        )}
      </div>
    </SheetDialog>
  );
}

export function ReusePicker({
  essayId,
  choices,
  person,
}: {
  essayId: string;
  choices: { groupLabel: string; prompt: PickerPrompt; mode: ReuseMode }[];
  person: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = (p: PickerPrompt, mode: ReuseMode) =>
    start(async () => {
      setMessage(null);
      if (mode === "link") {
        const r = await linkEssay(essayId, p.ref);
        if (!r.ok) setMessage(r.message);
        else {
          setOpen(false);
          router.refresh();
        }
        return;
      }
      const r = await makeVariant(essayId, p.ref);
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      track("essay_created", { prompt_kind: r.kind });
      setOpen(false);
      router.push(editorHref(r.id, person));
    });

  return (
    <SheetDialog
      open={open}
      onOpenChange={setOpen}
      title="Use for another college"
      description="Use this draft as it is, or make a copy to change for that prompt."
      trigger={{ className: cn(TRIGGER, "ring-1 ring-border hover:bg-muted"), label: "Use for another college", content: "Use for another college" }}
    >
      <div className="mt-4 space-y-2">
        {choices.length === 0 && <p className="text-sm text-muted-foreground">No other prompt on your list asks for this kind of essay.</p>}
        {choices.map(({ groupLabel, prompt, mode }) => (
          <div key={prompt.ref} className="rounded-2xl border px-3 py-2.5">
            <p className="text-xs font-semibold text-muted-foreground">{groupLabel}</p>
            <p className="font-semibold">{prompt.title}</p>
            {prompt.text && <p className="mt-0.5 line-clamp-3 text-sm text-muted-foreground">{prompt.text}</p>}
            <LimitLine p={prompt} />
            <div className="mt-2 flex flex-wrap gap-2">
              {(mode === "link" ? (["link", "variant"] as const) : (["variant", "link"] as const)).map((m, i) => (
                <button
                  key={m}
                  type="button"
                  disabled={pending}
                  onClick={() => go(prompt, m)}
                  className={cn(TRIGGER, i === 0 ? "bg-foreground text-background" : "ring-1 ring-border hover:bg-muted", "disabled:opacity-60")}
                >
                  {m === "link" ? "Use this draft" : "Make a copy for it"}
                </button>
              ))}
            </div>
          </div>
        ))}
        {message && (
          <p className="text-sm text-destructive" role="status">
            {message}
          </p>
        )}
      </div>
    </SheetDialog>
  );
}

export default PromptPicker;
