import Link from "next/link";
import { Check } from "lucide-react";

/**
 * One row of the record overview (specs/planner/record/steps.md "The overview"): a check or ring, the rail's name,
 * the step's summary or its unlock line (muted), and the action link (Edit/Add for a tour step, "Open your story" /
 * "Pick your recommenders" for those two, which link their guide instead). `href` null hides the action (a guardian
 * without edit access sees no Edit/Add; the story and recommenders links stay, since those guides are readable
 * either way, same as the moves that open them).
 */
export function RecordRow({ name, done, text, href, action }: { name: string; done: boolean; text: string; href: string | null; action: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        aria-hidden
        className={
          done
            ? "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-pop/30 text-foreground"
            : "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed text-transparent"
        }
      >
        {done && <Check className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{name}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </div>
      {href && (
        <Link
          href={href}
          aria-label={`${action}: ${name}`}
          className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary hover:underline"
        >
          {action}
        </Link>
      )}
    </li>
  );
}
