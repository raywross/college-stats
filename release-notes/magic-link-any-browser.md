---
title: "Sign-in links now work from your email app"
pr: 85
date: 2026-10-05
kind: fix
summary: Tapping the sign-in link in your email now signs you in, whichever app or browser opens it.
---

## What's new

Signing in or creating an account sends you an email with a link. Until now, tapping that link on a phone confirmed
your email but often didn't sign you in, because the email app opened the link in a different browser from the one
you started in. The link now signs you in wherever it opens. A link that has expired or was already used says so and
offers to send a new one.

## Behind the scenes

- Sign-in links carry the session back to a new page, `/auth/confirm`, which hands it to our server to store as your
  sign-in cookie and then clears it from the address bar.
- Sign-in cookies can no longer be read by scripts on the page; only our server reads them.
- The site's sign-in settings now point at the live address. They had pointed at an address that needs a Vercel login.
