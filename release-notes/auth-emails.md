---
title: "Sign-in emails that look like Quad"
pr: 146
date: 2026-10-13
kind: improvement
summary: The emails Quad sends to confirm your address, sign you in, or reset your password now come from Quad with Quad's look, and replies reach a real person.
---

## What's new

- **Emails you can recognize.** The emails that confirm your address, send a sign-in link, reset your password, or
  confirm a new email address now carry Quad's name and colors, with one clear button.
- **From a real address.** They come from support@usequad.app. If something looks wrong, reply and a person reads it.
- **Clear about why you got it.** Each one says what the button does and what to do if you didn't ask for it.

## Behind the scenes

The emails are sent by our sign-in provider through a dedicated email service on Quad's own domain, which also lifts
the old limit of a few emails an hour. The designs are kept in the repository and checked on every change.
