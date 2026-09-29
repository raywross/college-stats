"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Sticky in-page nav that highlights the section you're reading. */
export function SectionNav({ sections }: { sections: { id: string; label: string; color?: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -60% 0px" }
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  // Keep the active pill visible on narrow screens.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <nav
      aria-label="On this page"
      className="sticky z-30 -mx-4 border-y bg-background/80 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + var(--header-h))" }}
    >
      <div ref={listRef} className="no-scrollbar flex gap-1 overflow-x-auto py-1.5 sm:py-2">
        {sections.map((s) => (
          <a
            key={s.id}
            data-id={s.id}
            href={`#${s.id}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors sm:px-3.5 sm:text-sm",
              active === s.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {s.color && <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />}
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
