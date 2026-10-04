---
title: "Next year's price: public colleges read as public"
pr: 69
date: 2026-10-04
kind: fix
summary: "Next year's price from a public college's Common Data Set now always uses its in-state and out-of-state tuition, never the cell meant for private colleges."
---

## What's new

When a public university's Common Data Set was read, its tuition could land in the cell meant for private colleges,
so "Next year" showed one tuition figure instead of in-state and out-of-state prices. Public colleges now always show
their in-state and out-of-state tuition.

## Behind the scenes

The Common Data Set's private-college tuition cells are labeled only "Tuition", so the reading agent filled them at
public colleges too. The site now chooses the tuition cells by the college's federal sector, and the agent is told
those cells are for private colleges only.
