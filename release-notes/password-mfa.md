---
title: "Password reset works with two-step sign-in"
pr: 149
date: 2026-10-13
kind: fix
summary: Resetting your password on an account that uses an authenticator app now asks for your 6-digit code and saves, instead of failing.
---

## What's new

- **Password resets on accounts with two-step sign-in.** If your account uses an authenticator app, the password page
  now asks for the current 6-digit code along with your new password, and saves it. Before, it said "We couldn't save
  it" every time.

## Behind the scenes

Our sign-in provider only lets an account with an authenticator change its password after the code is checked, and a
reset link doesn't check it. The page now checks the code first, then saves the password.
