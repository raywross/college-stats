/**
 * The page container for every /plan page (the plan, its print view, the design preview), matching Explore's
 * (app/explore/page.tsx): the same width, side gutters, and top spacing, so Plan lines up with the other pages on a
 * phone and a desktop. Print drops the gutters.
 */
export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10 print:max-w-none print:px-0 print:pt-0 print:pb-0">{children}</div>;
}
