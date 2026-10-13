---
title: "Sign-in activity for Quad support"
pr: 150
date: 2026-10-13
kind: improvement
summary: Quad support can now see when an account signed in, from what kind of device, and when its password or email changed, so a "my reset link didn't work" question has an answer.
---

## What's new

- **Help with sign-in trouble.** When someone writes in because a reset link didn't work or they can't get in, support
  can see when the account last signed in, from what kind of device ("Safari on iPhone"), when a reset link went out,
  and whether the password was changed afterwards.
- **Said plainly on the privacy page.** The privacy page now says Quad keeps this security record and that support
  can see it. Connection addresses are never shown.

## Behind the scenes

The record comes from our sign-in provider's own tables: sessions, the account's dates, and its sign-in log.
