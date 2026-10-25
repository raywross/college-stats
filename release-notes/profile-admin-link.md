---
title: "An admin console link on your account page"
pr: 173
date: 2026-10-21
kind: improvement
summary: Admins get a link to the admin console on their account page, instead of typing the URL by hand.
---

## What's new

- **Nothing changes for families.** The account page looks the same unless you're an admin.
- **A shortcut for admins.** Signed-in admins now see an "Admin console" link on `/account`, right after the Profile
  section, instead of having to type `/admin` into the address bar.

## Behind the scenes

- The link only renders when `adminState()` (`lib/admin/auth.ts`) reports the signed-in user as an admin, including
  one still mid-way through MFA; everyone else sees nothing.
