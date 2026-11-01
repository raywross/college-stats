"use client";

/**
 * What the marks in the draft share across the page (specs/product/essays/editors.md "2. Marks in the draft"): the
 * field's live text (the Editor publishes it), the items each source publishes (the reader's notes, the comments, the
 * open changes), the per-draft colors (from the page's `order` of author keys, plus any key that turns up later),
 * the legend's hidden keys, and an optional opener per kind (how **Open** reaches a card that isn't on screen, such
 * as a change in Review changes). Three contexts, so a publisher never re-renders on a keystroke.
 *
 * Without a provider every hook is a no-op with empty values, so the Editor and Notes still work alone.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { assignColors, READER_KEY, type MarkColor, type MarkItem, type MarkKind } from "@/lib/essays/marks";

export type MarkSource = "notes" | "comments" | "changes";
export type MarkOpener = (item: MarkItem) => boolean;

const SOURCES: readonly MarkSource[] = ["notes", "comments", "changes"];
const NO_ITEMS: readonly MarkItem[] = [];
const NO_KEYS: ReadonlySet<string> = new Set();

interface Actions {
  setText: (text: string) => void;
  setItems: (source: MarkSource, items: readonly MarkItem[]) => void;
  toggleKey: (key: string) => void;
  setOpener: (kind: MarkKind, fn: MarkOpener | null) => void;
  /** The opener registered for a kind (read at the moment Open is pressed). */
  opener: (kind: MarkKind) => MarkOpener | null;
}
interface Marks {
  items: readonly MarkItem[];
  colors: Record<string, MarkColor>;
  hidden: ReadonlySet<string>;
}

const noop = () => {};
const ActionsContext = createContext<Actions>({ setText: noop, setItems: noop, toggleKey: noop, setOpener: noop, opener: () => null });
const TextContext = createContext<string>("");
const MarksContext = createContext<Marks>({ items: NO_ITEMS, colors: {}, hidden: NO_KEYS });

// Layout effects in the browser (the backdrop updates before the field's new text paints), plain effects on the server.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function MarksProvider({ order, initialText = "", children }: { order: readonly string[]; initialText?: string; children: ReactNode }) {
  const [text, setTextState] = useState(initialText);
  const [bySource, setBySource] = useState<Record<MarkSource, readonly MarkItem[]>>({ notes: NO_ITEMS, comments: NO_ITEMS, changes: NO_ITEMS });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NO_KEYS);
  const openers = useRef<Partial<Record<MarkKind, MarkOpener>>>({});

  const actions = useMemo<Actions>(
    () => ({
      setText: (t) => setTextState(t),
      setItems: (source, items) => setBySource((s) => (s[source] === items ? s : { ...s, [source]: items })),
      toggleKey: (key) =>
        setHidden((h) => {
          const next = new Set(h);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
      setOpener: (kind, fn) => {
        if (fn) openers.current[kind] = fn;
        else delete openers.current[kind];
      },
      opener: (kind) => openers.current[kind] ?? null,
    }),
    [],
  );

  const items = useMemo(() => SOURCES.flatMap((s) => bySource[s]), [bySource]);
  // The reader first (so the legend leads with "Reader's notes"), then the page's order (first appearance by created
  // time), then any key it didn't know, in the items' order. The reader and the student take no palette slot.
  const orderKey = order.join("\u0000");
  const colors = useMemo(() => assignColors([READER_KEY, ...orderKey.split("\u0000").filter(Boolean), ...items.map((i) => i.authorKey)]), [orderKey, items]);
  const marks = useMemo<Marks>(() => ({ items, colors, hidden }), [items, colors, hidden]);

  return (
    <ActionsContext.Provider value={actions}>
      <MarksContext.Provider value={marks}>
        <TextContext.Provider value={text}>{children}</TextContext.Provider>
      </MarksContext.Provider>
    </ActionsContext.Provider>
  );
}

/** The field's live text, as the Editor last published it. */
export function useMarksText(): string {
  return useContext(TextContext);
}

/** The Editor: publish the field's text on every change. */
export function usePublishMarksText(text: string): void {
  const { setText } = useContext(ActionsContext);
  useIsoLayoutEffect(() => setText(text), [text, setText]);
}

/** A source publishes its items (set when they change, cleared on unmount). Pass a memoized array. */
export function usePublishMarks(source: MarkSource, items: readonly MarkItem[]): void {
  const { setItems } = useContext(ActionsContext);
  useEffect(() => setItems(source, items), [source, items, setItems]);
  useEffect(() => () => setItems(source, NO_ITEMS), [source, setItems]);
}

/** Every published item, notes then comments then changes. */
export function useMarkItems(): readonly MarkItem[] {
  return useContext(MarksContext).items;
}

/** Each author key's color for this draft. */
export function useColors(): Record<string, MarkColor> {
  return useContext(MarksContext).colors;
}

/** The legend's hidden keys and the toggle. */
export function useHiddenKeys(): { hidden: ReadonlySet<string>; toggle: (key: string) => void } {
  const { hidden } = useContext(MarksContext);
  const { toggleKey } = useContext(ActionsContext);
  return { hidden, toggle: toggleKey };
}

/**
 * Register how **Open** reaches a kind's card when it isn't simply on the page (Review changes: switch to the tab,
 * then scroll). The handler returns true when it handled the open; false falls back to scrolling to `targetId`.
 */
export function useMarkOpener(kind: MarkKind, fn: MarkOpener | null): void {
  const { setOpener } = useContext(ActionsContext);
  const latest = useRef(fn);
  useIsoLayoutEffect(() => {
    latest.current = fn;
  });
  const has = fn !== null;
  const stable = useCallback((item: MarkItem) => latest.current?.(item) ?? false, []);
  useEffect(() => {
    if (!has) return;
    setOpener(kind, stable);
    return () => setOpener(kind, null);
  }, [kind, has, stable, setOpener]);
}

/** For Marks.tsx: the opener registered for a kind, read when Open is pressed. */
export function useOpenerLookup(): (kind: MarkKind) => MarkOpener | null {
  return useContext(ActionsContext).opener;
}
