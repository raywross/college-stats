"use client";

import { useEffect, useState } from "react";

/**
 * TEMPORARY (remove before merging #83): live scroll and viewport numbers, shown only with ?debug=1, to diagnose the
 * phone header that can't be scrolled back into view on Chrome for iOS. Reads the URL in the browser so pages stay
 * static.
 */
export function ScrollDebug() {
  const [rows, setRows] = useState<[string, string][] | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") !== "1") return;
    let frame = 0;
    let minY = Infinity;
    const read = () => {
      frame = 0;
      const header = document.querySelector("header")?.getBoundingClientRect();
      const main = document.querySelector("main")?.getBoundingClientRect();
      const vv = window.visualViewport;
      const se = document.scrollingElement;
      minY = Math.min(minY, window.scrollY);
      const r = (n: number | undefined) => (n === undefined ? "–" : String(Math.round(n * 10) / 10));
      setRows([
        ["scrollY", r(window.scrollY)],
        ["min scrollY seen", r(minY)],
        ["scrollingEl", `${se?.tagName ?? "–"} ${r(se?.scrollTop)}`],
        ["body.scrollTop", r(document.body.scrollTop)],
        ["header top/bot", `${r(header?.top)} / ${r(header?.bottom)}`],
        ["main top", r(main?.top)],
        ["body top", r(document.body.getBoundingClientRect().top)],
        ["innerH / outerH", `${window.innerHeight} / ${window.outerHeight}`],
        ["vv h / offTop", `${r(vv?.height)} / ${r(vv?.offsetTop)}`],
        ["vv pageTop", r(vv?.pageTop)],
        ["docEl clientH", String(document.documentElement.clientHeight)],
        ["build", process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "–"],
      ]);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const timer = setInterval(read, 500);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      clearInterval(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  if (!rows) return null;
  return (
    <div className="pointer-events-none fixed top-1/3 right-2 z-[100] rounded-lg bg-black/80 px-2.5 py-2 font-mono text-[11px] leading-snug text-white">
      {rows.map(([k, v]) => (
        <div key={k}>
          {k}: <b>{v}</b>
        </div>
      ))}
    </div>
  );
}
