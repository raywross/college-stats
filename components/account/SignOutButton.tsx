import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

/** A one-button form that POSTs to /auth/signout (never a link: GETs can be prefetched). */
export function SignOutButton({ className, label = "Sign out" }: { className?: string; label?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className={cn("inline-flex items-center gap-2", className)}>
        <LogOut className="size-4" />
        {label}
      </button>
    </form>
  );
}
