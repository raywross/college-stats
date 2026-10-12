"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IDLE, typedMatches, type AdminActionState } from "@/lib/admin/console";

const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "textarea" | "select" | "checkbox";
  defaultValue?: string;
  /** Checkboxes: ticked to begin with. Unticked sends nothing, so the action reads the box's absence. */
  checked?: boolean;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  options?: { value: string; label: string }[];
  hint?: string;
  autoComplete?: string;
}

export type AdminAction = (prev: AdminActionState, form: FormData) => Promise<AdminActionState>;

export interface AdminFormProps {
  action: AdminAction;
  /** Ids the action needs (never anything secret). */
  hidden?: Record<string, string>;
  /** The button that opens the panel; with no fields, description, or typed confirmation it runs the action at once. */
  trigger: string;
  /** The panel's own button (defaults to the trigger's text). */
  submit?: string;
  pendingLabel?: string;
  tone?: "default" | "danger" | "primary";
  fields?: FieldSpec[];
  /** What the action does, shown above the fields. */
  description?: ReactNode;
  /** A typed confirmation: the button stays disabled until the box holds `expected` (the action checks again). */
  typed?: { expected: string; instruction?: ReactNode };
  className?: string;
}

const toneCls = {
  default: "border hover:bg-muted",
  danger: "border border-destructive/40 text-destructive hover:bg-destructive/10",
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
} as const;

const buttonCls = "inline-flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/**
 * One console action: a button, a panel of fields behind it when it needs any, an optional typed confirmation, and
 * the outcome beside it (a refusal in plain words, or the success message). The Server Action does the work and
 * re-checks everything; nothing here is trusted. Copy reset link returns `link`, shown once below the button in a
 * box with Copy: it lives in this component's memory only (not in the URL, storage, or any log) and goes when the
 * page is left or Hide is pressed.
 */
export function AdminForm({ action, hidden = {}, trigger, submit, pendingLabel, tone = "default", fields = [], description, typed, className }: AdminFormProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typedValue, setTypedValue] = useState("");
  const [hiddenLink, setHiddenLink] = useState(false);
  const [state, run, pending] = useActionState<AdminActionState, FormData>(async (prev, form) => {
    const next = await action(prev, form);
    if (next.status === "done") {
      setOpen(false);
      setTypedValue("");
      setHiddenLink(false);
    }
    return next;
  }, IDLE);

  const direct = fields.length === 0 && !description && !typed;
  const ready = typed ? typedMatches(typedValue, typed.expected) : true;
  const hiddenInputs = Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);

  const outcome = (
    <>
      {state.status === "error" && (
        <p className="max-w-prose text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "done" && state.message && (
        <p className="max-w-prose text-sm font-medium text-emerald-800 dark:text-emerald-300" role="status">
          {state.message}
        </p>
      )}
      {state.status === "done" && state.link && !hiddenLink && <LinkBox link={state.link} onHide={() => setHiddenLink(true)} />}
    </>
  );

  if (direct) {
    return (
      <form action={run} className={cn("flex flex-col items-start gap-1.5", className)}>
        {hiddenInputs}
        <button type="submit" disabled={pending} className={cn(buttonCls, toneCls[tone])}>
          {pending ? (pendingLabel ?? "Working…") : trigger}
        </button>
        {outcome}
      </form>
    );
  }

  return (
    <div className={cn("flex flex-col items-start gap-1.5", className)}>
      <button type="button" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((v) => !v)} className={cn(buttonCls, toneCls[tone])}>
        {trigger}
      </button>
      {open && (
        <form id={`${id}-panel`} action={run} className="w-full space-y-3 rounded-xl border bg-background p-3 sm:p-4">
          {hiddenInputs}
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
          {fields.map((f) => (
            <Field key={f.name} spec={f} id={`${id}-${f.name}`} />
          ))}
          {typed && (
            <div>
              <label className="block text-sm font-semibold" htmlFor={`${id}-confirm`}>
                {typed.instruction ?? (
                  <>
                    Type <span className="font-mono">{typed.expected}</span> to confirm
                  </>
                )}
              </label>
              <input
                id={`${id}-confirm`}
                name="confirm"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                className={`${inputCls} mt-1.5 sm:max-w-sm`}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending || !ready} className={cn(buttonCls, tone === "danger" ? "bg-destructive text-white" : toneCls.primary)}>
              {pending ? (pendingLabel ?? "Working…") : (submit ?? trigger)}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={cn(buttonCls, "text-muted-foreground hover:bg-muted")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {outcome}
    </div>
  );
}

function Field({ spec, id }: { spec: FieldSpec; id: string }) {
  const common = { id, name: spec.name, required: spec.required, maxLength: spec.maxLength, autoComplete: spec.autoComplete ?? "off" };
  if (spec.type === "checkbox") {
    return (
      <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium" htmlFor={id}>
        <input id={id} name={spec.name} type="checkbox" defaultChecked={spec.checked} className="size-5 accent-primary" />
        {spec.label}
      </label>
    );
  }
  return (
    <div>
      <label className="block text-sm font-semibold" htmlFor={id}>
        {spec.label}
      </label>
      {spec.type === "textarea" ? (
        <textarea {...common} defaultValue={spec.defaultValue} placeholder={spec.placeholder} rows={3} className={`${inputCls} mt-1.5 h-auto py-2.5`} />
      ) : spec.type === "select" ? (
        <select {...common} defaultValue={spec.defaultValue} className={`${inputCls} mt-1.5 sm:max-w-xs`}>
          {(spec.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input {...common} type={spec.type ?? "text"} inputMode={spec.type === "number" ? "numeric" : undefined} defaultValue={spec.defaultValue} placeholder={spec.placeholder} className={`${inputCls} mt-1.5 sm:max-w-md`} />
      )}
      {spec.hint && <p className="mt-1 text-xs text-muted-foreground">{spec.hint}</p>}
    </div>
  );
}

/** The reset link, shown once with a Copy button. */
function LinkBox({ link, onHide }: { link: string; onHide: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="w-full max-w-xl space-y-2 rounded-xl border border-dashed p-3">
      <input readOnly value={link} aria-label="Reset link" onFocus={(e) => e.currentTarget.select()} className={`${inputCls} font-mono text-xs`} />
      <p className="text-xs text-muted-foreground">Shown once, here only: leaving this page loses it. It signs the person in and asks for a new password, and works one time.</p>
      <div className="flex gap-2">
        <button type="button" onClick={copy} className={cn(buttonCls, toneCls.primary)}>
          {copied ? "Copied" : "Copy link"}
        </button>
        <button type="button" onClick={onHide} className={cn(buttonCls, "text-muted-foreground hover:bg-muted")}>
          Hide
        </button>
      </div>
    </div>
  );
}
