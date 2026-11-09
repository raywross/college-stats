"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { Menu } from "@base-ui/react/menu";
import { LogOut } from "lucide-react";
import { initialsFor, loginHref } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { accountMenuLinks } from "./account-menu-links";
import { useMe } from "./useMe";

/** Paths where "Sign in" shouldn't send people back (they'd land on the login page again). */
function returnPath(pathname: string): string | undefined {
  return pathname === "/login" || pathname.startsWith("/auth/") ? undefined : pathname;
}

const SIGN_IN_CLS =
  "h-9 items-center rounded-full border border-border bg-background px-4 text-sm font-semibold text-foreground shadow-xs transition-colors hover:bg-muted";
const AVATAR_CLS = "size-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground";

/**
 * The slot before the state is known (the server HTML, hydration, and a signed-in first page with no hint): both
 * "Sign in" and an avatar placeholder that looks like the trigger, each hidden by app/globals.css until the inline
 * script (components/layout/MeFirstPaint.tsx) sets `<html data-me>`; the placeholder prints the hint's initials from
 * `--me-initials`. Plain links, so they work before any script: Sign in, and the account page. Same box as the real
 * control, so nothing shifts when it takes over.
 */
function MeFirstPaintSlot({ signInHref }: { signInHref: string }) {
  return (
    <>
      <a href={signInHref} data-me-show="out" className={SIGN_IN_CLS}>
        Sign in
      </a>
      <a href="/account" data-me-show="in" aria-label="Your account" className={AVATAR_CLS} />
    </>
  );
}

/**
 * Header (desktop, and opposite the logo on phones): "Sign in" when signed out, an avatar menu when signed in, nothing where sign-in isn't configured.
 * State comes from /api/me in the browser (useMe), so the pages around it stay static; before that, the first-paint
 * slot shows what the cookies say, and useMe's first state is seeded from the same hint (initials and role).
 */
export function AccountMenu() {
  const me = useMe();
  const pathname = usePathname();
  const signOutForm = useRef<HTMLFormElement>(null);

  if (!me) return <MeFirstPaintSlot signInHref={loginHref(returnPath(pathname))} />;
  if (!me.configured) return null;
  if (!me.signedIn) {
    return (
      <Link href={loginHref(returnPath(pathname))} className={cn("inline-flex", SIGN_IN_CLS)}>
        Sign in
      </Link>
    );
  }

  // The hint's initials until /api/me answers (lib/me-hint.ts meFromHint); then the name's or the email's.
  const initials = me.initials ?? initialsFor(me.name, me.email);
  const itemCls = "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium outline-none data-[highlighted]:bg-muted";
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Your account"
          className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:ring-2 data-[popup-open]:ring-ring"
        >
          {initials}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
            <Menu.Popup className="w-64 origin-(--transform-origin) rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-xl outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-opacity">
              <div className="px-3 pt-2 pb-2.5">
                {me.name && <p className="truncate text-sm font-semibold">{me.name}</p>}
                {me.email && <p className="truncate text-xs text-muted-foreground">{me.email}</p>}
              </div>
              <div className="my-1 h-px bg-border" />
              {accountMenuLinks(me).map(({ href, label, icon: Icon }) => (
                <Menu.LinkItem key={href} closeOnClick render={<Link href={href} />} className={cn(itemCls, (pathname === href || pathname.startsWith(`${href}/`)) && "text-primary")}>
                  <Icon className="size-4" />
                  {label}
                </Menu.LinkItem>
              ))}
              <div className="my-1 h-px bg-border" />
              <Menu.Item className={itemCls} onClick={() => signOutForm.current?.requestSubmit()}>
                <LogOut className="size-4" />
                Sign out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <form ref={signOutForm} action="/auth/signout" method="post" hidden />
    </>
  );
}
