import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { GlossaryList } from "@/components/glossary/GlossaryList";
import { GLOSSARY } from "@/lib/glossary";

export const metadata: Metadata = { title: "Glossary" };

export default function GlossaryPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-6 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Glossary</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
            Admissions-speak, <span className="highlight">translated</span>
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Every term you&apos;ll see on this site, in plain English. Look for the{" "}
            <span className="inline-flex size-4 translate-y-0.5 items-center justify-center rounded-full border text-[10px] font-bold">i</span>{" "}
            icon or a dotted underline anywhere to get these definitions without leaving the page.
          </p>
        </div>
        <div className="hidden items-center gap-3 rounded-3xl border bg-card px-5 py-4 sm:flex">
          <BookOpen className="size-6 text-primary" />
          <div>
            <p className="font-display text-3xl leading-none font-extrabold">{Object.keys(GLOSSARY).length}</p>
            <p className="text-xs text-muted-foreground">terms explained</p>
          </div>
        </div>
      </header>
      <GlossaryList />
    </div>
  );
}
