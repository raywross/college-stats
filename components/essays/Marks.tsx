"use client";

/**
 * Marks in the draft (specs/product/essays/editors.md "2. Marks in the draft", "Phones and accessibility"): colored
 * underlines under the words the reader's notes, the comments and the open changes point at, drawn **around** the
 * plain `<textarea id="essay-field">`, never inside it.
 *
 * - The **backdrop** sits behind the field (whose background is transparent): a copy of the field's box, type and
 *   padding holding the same text in transparent color, each marked segment a `span` with up to three 2 px bands
 *   at its foot, one per author color, so two marks on the same words both show. An insertion is a caret-width bar.
 * - The **overlay** is a second copy above the field, `pointer-events: none` except on its marked spans, so hovering
 *   (a pointer) or tapping (a touch) one opens the **popover**: who (with their color), the first line, and **Open**,
 *   which scrolls the full card into view. A tap also puts the caret at the tapped spot. Escape or a tap elsewhere
 *   closes it. On a phone the popover is a bottom sheet. Both copies are `aria-hidden`: the notes list, the comment
 *   thread and Review changes stay the accessible path.
 * - The **legend** (above the field): a chip per author with a color dot, the label and a count; each toggles its marks.
 *
 * The copies take the field's computed type, padding and inner box on every change of text, on resize (the window's
 * and the field's, through a ResizeObserver), on input, and once the fonts have loaded. The field auto-grows and never
 * scrolls inside itself, so nothing else can shift.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { track } from "@/lib/analytics";
import { legendFor, resolveMarks, segmentMarks, type ChangeLocator, type MarkColor, type MarkItem, type MarkSegment, type Resolved } from "@/lib/essays/marks";
import { cn } from "@/lib/utils";
import { useColors, useHiddenKeys, useMarkItems, useMarksText, useOpenerLookup } from "./marks-context";

const FIELD_ID = "essay-field";
/** At most this many bands under one segment (more authors on the same words still list in the popover). */
const MAX_BANDS = 3;
const BAND_PX = 2;
const BAND_GAP_PX = 1;

/**
 * The mark colors as CSS variables, light and dark (each band's contrast against the page is at least 3:1 in both
 * themes: Tailwind's 700/600 shades on the light background, its 400 shades on the dark one).
 */
export const MARK_VARS =
  "[--mark-amber:#b45309] [--mark-gray:#6b7280] [--mark-blue:#2563eb] [--mark-violet:#7c3aed] [--mark-green:#15803d] [--mark-rose:#e11d48] [--mark-teal:#0f766e] " +
  "dark:[--mark-amber:#fbbf24] dark:[--mark-gray:#9ca3af] dark:[--mark-blue:#60a5fa] dark:[--mark-violet:#a78bfa] dark:[--mark-green:#4ade80] dark:[--mark-rose:#fb7185] dark:[--mark-teal:#2dd4bf]";
export const markVar = (c: MarkColor) => `var(--mark-${c})`;

/** The field's computed styles the copies take, so their text wraps exactly where the field's does. */
const COPIED = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariant", "fontKerning", "fontFeatureSettings", "letterSpacing", "wordSpacing", "lineHeight", "textIndent", "textTransform", "textAlign", "direction", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;

/** The base classes of both copies: the field's type and padding (Editor.tsx) as a first guess before measuring. */
const LAYER = "absolute top-0 left-0 h-full w-full overflow-hidden px-4 py-4 text-[18px] leading-relaxed whitespace-pre-wrap break-words text-transparent sm:px-6 sm:text-lg [overflow-wrap:break-word]";

function fieldEl(): HTMLTextAreaElement | null {
  const el = typeof document !== "undefined" ? document.getElementById(FIELD_ID) : null;
  return el instanceof HTMLTextAreaElement ? el : null;
}

/** The distinct colors of a segment's visible items, in order, at most three. */
export function segmentColors(seg: MarkSegment, colors: Record<string, MarkColor>): MarkColor[] {
  const out: MarkColor[] = [];
  for (const it of seg.items) {
    const c = colors[it.authorKey] ?? "gray";
    if (!out.includes(c)) out.push(c);
    if (out.length === MAX_BANDS) break;
  }
  return out;
}

/** A segment's underline bands: one 2 px gradient per color, stacked upward from the foot of the line. */
export function bandStyle(cs: readonly MarkColor[]): CSSProperties {
  return {
    backgroundImage: cs.map((c) => `linear-gradient(${markVar(c)}, ${markVar(c)})`).join(", "),
    backgroundSize: cs.map(() => `100% ${BAND_PX}px`).join(", "),
    backgroundPosition: cs.map((_, i) => `0 calc(100% - ${i * (BAND_PX + BAND_GAP_PX)}px)`).join(", "),
    backgroundRepeat: "no-repeat",
  };
}

/** An insertion's caret-width bar: no width in the flow (negative margins), so the text wraps as in the field. */
function caretStyle(c: MarkColor, hit: boolean): CSSProperties {
  // The overlay's copy is wider to tap (padding), still taking no width.
  const pad = hit ? 6 : 0;
  return { borderLeft: `${BAND_PX}px solid ${markVar(c)}`, paddingInline: `${pad}px`, marginInline: `-${pad + BAND_PX / 2}px` };
}

type SpanHandlers = {
  onPointerEnter?: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onPointerLeave?: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onPointerDown?: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onClick?: (e: ReactMouseEvent<HTMLSpanElement>) => void;
};

/**
 * One copy of the text with its marked segments as spans (the backdrop's bands, or the overlay's hit targets). Pure
 * apart from the handlers, so a test renders it with renderToStaticMarkup.
 */
export function MarkLayer({
  text,
  segments,
  colors,
  layer,
  onSpan,
}: {
  text: string;
  segments: readonly MarkSegment[];
  colors: Record<string, MarkColor>;
  layer: "backdrop" | "overlay";
  /** The overlay's handlers for a segment's span. */
  onSpan?: (seg: MarkSegment) => SpanHandlers;
}) {
  const parts: ReactNode[] = [];
  let pos = 0;
  segments.forEach((seg, i) => {
    if (seg.start > pos) parts.push(text.slice(pos, seg.start));
    const cs = segmentColors(seg, colors);
    const zero = seg.end === seg.start;
    const style = zero ? caretStyle(cs[0] ?? "gray", layer === "overlay") : layer === "backdrop" ? bandStyle(cs) : undefined;
    parts.push(
      <span
        key={`${seg.start}-${seg.end}-${i}`}
        data-mark={seg.items.map((it) => it.id).join(" ")}
        data-start={seg.start}
        className={cn(zero ? "mark-caret" : "mark-span", layer === "overlay" && "pointer-events-auto cursor-pointer")}
        style={style}
        {...(onSpan ? onSpan(seg) : {})}
      >
        {zero ? null : text.slice(seg.start, seg.end)}
      </span>,
    );
    pos = Math.max(pos, seg.end);
  });
  if (pos < text.length) parts.push(text.slice(pos));
  // A trailing line break shows as a line in the field; a zero-width space keeps the copy's last line too.
  if (text.endsWith("\n")) parts.push("​");
  return <>{parts}</>;
}

/** The items as drawn: the published items minus hidden keys, resolved in the live text, cut into segments. */
export function useResolvedMarks(locate?: ChangeLocator): { text: string; resolved: Resolved[]; segments: MarkSegment[]; colors: Record<string, MarkColor> } {
  const text = useMarksText();
  const items = useMarkItems();
  const colors = useColors();
  const { hidden } = useHiddenKeys();
  const resolved = useMemo(() => resolveMarks(text, items, locate), [text, items, locate]);
  const segments = useMemo(() => segmentMarks(resolved.filter((r) => !hidden.has(r.item.authorKey))), [resolved, hidden]);
  return { text, resolved, segments, colors };
}

type Via = "hover" | "tap";
interface Pop {
  seg: MarkSegment;
  via: Via;
  /** Where the span's line box sits, relative to the field's wrapper. */
  top: number;
  bottom: number;
  left: number;
  sheet: boolean;
}

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 250;

/** Where the pointer's caret falls inside a marked span, as an offset into the text; the span's start otherwise. */
function tappedOffset(e: ReactMouseEvent<HTMLSpanElement>, seg: MarkSegment): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
    if (p) ({ offsetNode: node, offset } = p);
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(e.clientX, e.clientY);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (node && node.nodeType === Node.TEXT_NODE && e.currentTarget.contains(node)) return seg.start + Math.min(Math.max(0, offset), seg.end - seg.start);
  return seg.start;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The backdrop, the overlay and the popover. Rendered by the Editor inside the field's `relative` wrapper, right
 * before the field (the backdrop must come first so the field paints over it; the overlay is lifted above with z).
 * `locate`: lib/essays/suggestions.ts's locateChange, so open changes draw (U3 passes it).
 */
export function Marks({ locate }: { locate?: ChangeLocator }) {
  const { text, resolved, segments, colors } = useResolvedMarks(locate);
  const opener = useOpenerLookup();
  const backdrop = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const has = segments.length > 0;

  // The copies take the field's box and type.
  const sync = useCallback(() => {
    const el = fieldEl();
    if (!el) return;
    const cs = window.getComputedStyle(el);
    for (const layer of [backdrop.current, overlay.current]) {
      if (!layer) continue;
      for (const p of COPIED) layer.style[p] = cs[p];
      layer.style.top = `${el.offsetTop + el.clientTop}px`;
      layer.style.left = `${el.offsetLeft + el.clientLeft}px`;
      layer.style.width = `${el.clientWidth}px`;
      layer.style.height = `${el.clientHeight}px`;
    }
  }, []);
  useLayoutEffect(() => {
    if (has) sync();
  }, [has, text, segments, sync]);
  useEffect(() => {
    if (!has) return;
    const el = fieldEl();
    let frame: number | null = null;
    const later = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    window.addEventListener("resize", later);
    el?.addEventListener("input", later);
    const observer = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(later) : null;
    if (observer && el) observer.observe(el);
    let live = true;
    void document.fonts?.ready.then(() => live && later());
    return () => {
      live = false;
      window.removeEventListener("resize", later);
      el?.removeEventListener("input", later);
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [has, sync]);

  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const close = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setPop(null);
  }, []);

  const place = (target: HTMLElement, clientX: number, clientY: number, seg: MarkSegment, via: Via): Pop => {
    const wrap = (overlay.current?.offsetParent as HTMLElement | null) ?? overlay.current;
    const base = wrap?.getBoundingClientRect() ?? { top: 0, left: 0 };
    // The line box under the pointer (a span that wraps has one rect per line).
    const rects = [...target.getClientRects()];
    const r = rects.find((x) => clientY >= x.top && clientY <= x.bottom) ?? rects[0] ?? target.getBoundingClientRect();
    const sheet = window.matchMedia("(max-width: 639px)").matches;
    return { seg, via, top: r.top - base.top, bottom: r.bottom - base.top, left: Math.max(0, (via === "hover" ? r.left : clientX) - base.left), sheet };
  };

  // Escape, and a tap anywhere but the popover or a mark, close it.
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = popRef.current?.contains(document.activeElement);
      close();
      if (inside) fieldEl()?.focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (popRef.current?.contains(t) || overlay.current?.contains(t))) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [pop, close]);
  useEffect(() => clearHover, []);

  // A popover whose segment no longer exists (the text changed under it, or its key was hidden) closes.
  const live = pop && segments.some((s) => s.start === pop.seg.start && s.end === pop.seg.end) ? pop : null;

  // How the last press on a mark came (a click event doesn't say so in every browser).
  const lastPointer = useRef<string>("mouse");
  const onSpan = (seg: MarkSegment): SpanHandlers => ({
    onPointerEnter: (e: ReactPointerEvent<HTMLSpanElement>) => {
      if (e.pointerType !== "mouse") return;
      clearHover();
      const target = e.currentTarget;
      const { clientX, clientY } = e;
      hoverTimer.current = setTimeout(() => setPop((p) => (p?.via === "tap" ? p : place(target, clientX, clientY, seg, "hover"))), HOVER_OPEN_MS);
    },
    onPointerLeave: (e: ReactPointerEvent<HTMLSpanElement>) => {
      if (e.pointerType !== "mouse") return;
      clearHover();
      hoverTimer.current = setTimeout(() => setPop((p) => (p?.via === "hover" ? null : p)), HOVER_CLOSE_MS);
    },
    // Keep the field's focus (and its caret) when a mark is pressed with a mouse.
    onPointerDown: (e: ReactPointerEvent<HTMLSpanElement>) => {
      lastPointer.current = e.pointerType;
      if (e.pointerType === "mouse") e.preventDefault();
    },
    onClick: (e: ReactMouseEvent<HTMLSpanElement>) => {
      clearHover();
      const el = fieldEl();
      if (el) {
        const at = tappedOffset(e, seg);
        // A mouse click focuses the field there; a touch moves the caret but only keeps focus where it already was
        // (focusing would raise the keyboard over the sheet).
        const touch = lastPointer.current !== "mouse";
        if (!touch || document.activeElement === el) el.focus({ preventScroll: true });
        el.setSelectionRange(at, at);
      }
      setPop(place(e.currentTarget, e.clientX, e.clientY, seg, "tap"));
    },
  });

  const openItem = (item: MarkItem, via: Via) => {
    track("essay_mark_opened", { kind: item.kind, via });
    close();
    const custom = opener(item.kind);
    if (custom?.(item)) return;
    // A note: its words selected in the field, as "Show in the draft" does, without scrolling away from the card.
    if (item.kind === "note") {
      const at = resolved.find((r) => r.item.id === item.id);
      const el = fieldEl();
      if (at && el) el.setSelectionRange(at.start, at.end);
    }
    const card = document.getElementById(item.targetId);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "-1");
    card.focus({ preventScroll: true });
  };

  if (!has) return null;
  return (
    <>
      <div ref={backdrop} aria-hidden data-marks="backdrop" className={cn(LAYER, MARK_VARS, "pointer-events-none z-0 select-none")}>
        <MarkLayer text={text} segments={segments} colors={colors} layer="backdrop" />
      </div>
      <div ref={overlay} aria-hidden data-marks="overlay" className={cn(LAYER, MARK_VARS, "pointer-events-none z-20 select-none")}>
        <MarkLayer text={text} segments={segments} colors={colors} layer="overlay" onSpan={onSpan} />
      </div>
      {live && (
        <MarkPopover
          pop={live}
          colors={colors}
          popRef={popRef}
          onOpen={(it) => openItem(it, live.via)}
          onClose={close}
          onEnter={clearHover}
          onLeave={() => {
            if (live.via !== "hover") return;
            clearHover();
            hoverTimer.current = setTimeout(() => setPop((p) => (p?.via === "hover" ? null : p)), HOVER_CLOSE_MS);
          }}
        />
      )}
    </>
  );
}

/** The popover: a small card under the span on a pointer device, a bottom sheet on a phone; a dialog with a close button. */
function MarkPopover({
  pop,
  colors,
  popRef,
  onOpen,
  onClose,
  onEnter,
  onLeave,
}: {
  pop: Pop;
  colors: Record<string, MarkColor>;
  popRef: React.RefObject<HTMLDivElement | null>;
  onOpen: (item: MarkItem) => void;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const body = (
    <div
      ref={popRef}
      role="dialog"
      aria-label="What is marked here"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className={cn(
        MARK_VARS,
        "rounded-2xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg",
        pop.sheet ? "fixed inset-x-0 bottom-[var(--tabbar-h,0px)] z-50 rounded-b-none px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" : "absolute z-30 w-72 max-w-[calc(100%-1rem)]",
      )}
      style={pop.sheet ? undefined : { top: pop.bottom + 6, left: `min(${pop.left}px, calc(100% - min(18rem, 100% - 1rem)))` }}
    >
      <div className="flex items-start justify-between gap-2">
        <ul className="min-w-0 flex-1 space-y-2">
          {pop.seg.items.map((it) => (
            <li key={it.id} className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: markVar(colors[it.authorKey] ?? "gray") }} aria-hidden />
                {it.label}
              </p>
              <p className="mt-0.5 break-words">{it.firstLine}</p>
              <button type="button" onClick={() => onOpen(it)} className="mt-1 inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-primary ring-1 ring-border hover:bg-muted">
                Open
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
  if (pop.sheet && typeof document !== "undefined") return createPortal(body, document.body);
  return body;
}

/**
 * The legend above the field: a chip per author with marks in the draft (a color dot, the label, the count), each
 * toggling its marks. One row; on a phone it scrolls sideways inside itself, never the page.
 */
export function MarksLegend({ locate, className }: { locate?: ChangeLocator; className?: string }) {
  const { resolved, colors } = useResolvedMarks(locate);
  const { hidden, toggle } = useHiddenKeys();
  const entries = useMemo(() => legendFor(resolved.map((r) => r.item), colors), [resolved, colors]);
  if (entries.length === 0) return null;
  return <LegendChips entries={entries} hidden={hidden} onToggle={toggle} className={className} />;
}

/** The chips themselves (pure, for the render test). */
export function LegendChips({ entries, hidden, onToggle, className }: { entries: ReturnType<typeof legendFor>; hidden: ReadonlySet<string>; onToggle: (key: string) => void; className?: string }) {
  return (
    <div role="group" aria-label="Marks in the draft" className={cn(MARK_VARS, "-mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0", className)}>
      {entries.map((e) => {
        const off = hidden.has(e.key);
        return (
          <button
            key={e.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(e.key)}
            className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted", off && "text-muted-foreground opacity-60")}
          >
            <span className="inline-block size-3 rounded-full" style={{ background: off ? "transparent" : markVar(e.color), boxShadow: `inset 0 0 0 2px ${markVar(e.color)}` }} aria-hidden />
            {e.label}
            <span className="text-xs font-normal text-muted-foreground">{e.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export default Marks;
