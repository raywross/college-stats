"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import { suggestAddresses } from "@/lib/home-store";
import { shouldSuggest, type AddressSuggestion, type SuggestProvider } from "@/lib/address-suggest";
import { cn } from "@/lib/utils";

/** Keystrokes settle for this long before the server is asked (and Google's quota spent). */
const DEBOUNCE_MS = 250;

/**
 * The home address field with suggestions as you type (specs/product/home-and-distance.md "Autocomplete"): a
 * combobox over `suggestAddresses` (a Server Action; the provider's key never reaches the browser). Picking a
 * suggestion only fills the field; saving still matches the text with the Census geocoder. Without a configured
 * provider it is a plain text field. Google's terms require its logo beside suggestions it supplied.
 */
export function AddressField({
  id,
  value,
  onChange,
  enabled = true,
  placeholder,
  disabled = false,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Whether a provider is configured (the page knows); false makes this a plain text field. */
  enabled?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [provider, setProvider] = useState<SuggestProvider | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestNo = useRef(0);
  // One token per field session (focus → pick), as Google's billing expects; a UUID v4.
  const session = useRef<string | null>(null);

  function sessionToken(): string {
    session.current ??= typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackUuid();
    return session.current;
  }

  function cancelPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    requestNo.current++;
  }

  function close() {
    cancelPending();
    setOpen(false);
    setActive(-1);
  }

  function fetchSuggestions(text: string) {
    cancelPending();
    if (!enabled || !shouldSuggest(text)) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const mine = ++requestNo.current;
    timer.current = setTimeout(async () => {
      try {
        const result = await suggestAddresses(text, sessionToken());
        if (mine !== requestNo.current) return; // a newer keystroke superseded this one
        setSuggestions(result.suggestions);
        setProvider(result.provider);
        setOpen(result.suggestions.length > 0);
        setActive(-1);
      } catch {
        if (mine === requestNo.current) setOpen(false);
      }
    }, DEBOUNCE_MS);
  }

  function pick(s: AddressSuggestion) {
    onChange(s.text);
    setSuggestions([]);
    close();
    session.current = null; // the session ends with a pick; the next keystroke starts another
  }

  return (
    <div className="relative">
      <input
        id={id}
        role={enabled ? "combobox" : undefined}
        aria-autocomplete={enabled ? "list" : undefined}
        aria-expanded={enabled ? open : undefined}
        aria-controls={enabled ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete={enabled ? "off" : "street-address"}
        maxLength={200}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          fetchSuggestions(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0 && shouldSuggest(value)) setOpen(true);
        }}
        onBlur={() => {
          // Let a click on an option land first (options stop the mousedown from stealing focus).
          setTimeout(() => setOpen(false), 0);
        }}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === "ArrowDown" && suggestions.length > 0) {
              setOpen(true);
              setActive(0);
              e.preventDefault();
            }
            return;
          }
          if (e.key === "ArrowDown") {
            setActive((i) => (i + 1) % suggestions.length);
            e.preventDefault();
          } else if (e.key === "ArrowUp") {
            setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            e.preventDefault();
          } else if (e.key === "Enter" && active >= 0) {
            pick(suggestions[active]);
            e.preventDefault();
          } else if (e.key === "Escape") {
            close();
            e.preventDefault();
          }
        }}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
          <ul id={listId} role="listbox" aria-label="Address suggestions" className="max-h-72 overflow-y-auto py-1">
            {suggestions.map((s, i) => (
              <li
                key={`${s.text}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
                className={cn("cursor-pointer px-3.5 py-2 text-sm", i === active && "bg-muted")}
              >
                <span className="block font-medium">{s.main}</span>
                {s.secondary && <span className="block text-xs text-muted-foreground">{s.secondary}</span>}
              </li>
            ))}
          </ul>
          {provider === "google" && (
            <div className="flex items-center justify-end border-t px-3 py-1.5">
              {/* Required by Google's terms for Places data shown without a Google map (120 × 14 px assets). */}
              <Image src="/attribution/google-light.png" alt="Powered by Google" width={120} height={14} unoptimized className="h-3.5 w-auto dark:hidden" />
              <Image src="/attribution/google-dark.png" alt="" aria-hidden width={120} height={14} unoptimized className="hidden h-3.5 w-auto dark:block" />
            </div>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {open && suggestions.length > 0 ? `${suggestions.length} address suggestions. Use the arrow keys to pick one.` : ""}
      </p>
    </div>
  );
}

/** For the rare browser without crypto.randomUUID: a v4-shaped id (only groups keystrokes for billing). */
function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
