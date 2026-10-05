"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ComponentType } from "react";
import { Menu } from "@base-ui/react/menu";
import { LogOut, UserRound, Users } from "lucide-react";
import { initialsFor, loginHref } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { useMe } from "./useMe";

/**
 * Links in the avatar menu, in order. Account features add theirs here (households, your profile, lists, following),
 * never to the main navigation (specs/product/accounts.md).
 */
const ACCOUNT_MENU_LINKS: { href: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { href: "/account", label: "Your account", icon: UserRound },
  { href: "/account/household", label: "Household", icon: Users },
];

/** Paths where "Sign in" shouldn't send people back (they'd land on the login page again). */
function returnPath(pathname: string): string | undefined {
  return pathname === "/login" || pathname.startsWith("/auth/") ? undefined : pathname;
}

/**
 * Desktop header: "Sign in" when signed out, an avatar menu when signed in, nothing where sign-in isn't configured.
 * State comes from /api/me in the browser (useMe), so the pages around it stay static.
 */
export function AccountMenu() {
  const me = useMe();
  const pathname = usePathname();
  const signOutForm = useRef<HTMLFormElement>(null);

  // Hold the space while loading so the header doesn't shift.
  if (!me) return <span className="inline-block size-9" aria-hidden />;
  if (!me.configured) return null;
  if (!me.signedIn) {
    return (
      <Link
        href={loginHref(returnPath(pathname))}
        className="inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Sign in
      </Link>
    );
  }

  const initials = initialsFor(me.name, me.email);
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
              {ACCOUNT_MENU_LINKS.map(({ href, label, icon: Icon }) => (
                <Menu.LinkItem key={href} closeOnClick render={<Link href={href} />} className={cn(itemCls, pathname === href && "text-primary")}>
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
