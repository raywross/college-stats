---
title: Admins reach the console from the account menu
pr: 220
date: 2026-11-08
kind: improvement
summary: An admin's avatar menu, and the phone's More sheet, now show an Admin entry that opens the console; everyone else sees nothing new.
---

## Why

An admin signed in and then had to type the console's address into the browser. Nothing on the site led there,
because the console's existence is not advertised to anyone who is not an admin.

## What changed

- The avatar menu shows **Admin**, last, to an admin. The phone's More sheet shows the same entry.
- The header's account state carries one more flag, answered by the same question the console asks on every page,
  so the two can never disagree. To a visitor who is not an admin the menu is unchanged and the console is still
  not found.
- The console still asks an admin for the second factor itself.
