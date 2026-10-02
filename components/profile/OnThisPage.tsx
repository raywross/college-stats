"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageItem {
  id: string;
  label: string;
}

/**
 * Scroll-spy list of a topic page's blocks (their h3 cards, by id). A sticky side column from `lg`; below it, a
 * collapsible "On this page" row above the content. Items whose block isn't in the page (a component that rendered
 * nothing) drop out after mount, so the server HTML can list every possible block.
 */
export function OnThisPage({ items, className }: { items: PageItem[]; className?: string }) {
  const [present, setPresent] = useState(items);
  const [active, setActive] = useState(items[0]?.id);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const found = items.filter((i) => document.getElementById(i.id));
    // After layout: blocks whose component rendered nothing leave the list.
    const frame = requestAnimationFrame(() => setPresent(found));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-160px 0px -55% 0px" }
    );
    found.forEach((i) => observer.observe(document.getElementById(i.id)!));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [items]);

  if (present.length < 2) return null;

  /** Scrolls to the block, or to its "Show …" button when the block is folded (ShowMore), under the sticky bands. */
  function jump(e: MouseEvent<HTMLAnchorElement>, id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    // Close the phone row first: it sits above the content, so measuring with it open overshoots by its height.
    flushSync(() => setOpen(false));
    const target = el.offsetParent === null ? (document.getElementById(`${id}-toggle`) ?? el) : el;
    const site = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const band = document.querySelector<HTMLElement>("[data-compact-header]")?.offsetHeight ?? 0;
    const top = target.getBoundingClientRect().top + window.scrollY - site - band - 16;
    window.scrollTo({ top, behavior: "smooth" });
    window.history.replaceState(null, "", `#${id}`);
    setActive(id);
  }

  const list = (
    <ol className="flex flex-col gap-0.5">
      {present.map((i) => (
        <li key={i.id}>
          <a
            href={`#${i.id}`}
            onClick={(e) => jump(e, i.id)}
            aria-current={active === i.id ? "location" : undefined}
            className={cn(
              "block rounded-lg border-l-2 py-1.5 pr-2 pl-3 text-sm transition-colors",
              active === i.id ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {i.label}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <nav aria-label="On this page" className={className}>
      {/* lg+: sticky side column. */}
      <div className="sticky hidden lg:block" style={{ top: "calc(env(safe-area-inset-top, 0px) + var(--header-h) + 7rem)" }}>
        <p className="mb-2 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">On this page</p>
        {list}
      </div>
      {/* Below lg: a collapsible row above the content. */}
      <div className="rounded-2xl border bg-card/50 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-semibold"
        >
          On this page
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && <div className="border-t px-3 py-2">{list}</div>}
      </div>
    </nav>
  );
}
