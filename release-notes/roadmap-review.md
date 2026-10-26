---
title: "The roadmap, checked against the site: six plans retired, nine rewritten"
pr: 179
date: 2026-10-26
kind: plans
summary: Every plan still listed on the roadmap was read against what the site now does; the ones already built or no longer needed came off, and the ones the site had outgrown were rewritten around what exists.
---

## What's new

The [roadmap](/roadmap) is shorter and truer. Many of its plans were written in the first week of October, before the
planner, Quad's estimate, Next steps, visit events, the Data API, and the Common App data arrived. Read against the site
today:

- **Six plans came off.** "Chances and fit" and "Early decision strategy" were built piece by piece under other names
  (the estimate and its levels, the For you filters on Explore, the "Applying early" block, the Common App filters, ED
  opportunities on the plan), so they are marked built and say where each part went. "Metro area" was never needed:
  the distance filter and the state pages do its job. Two lists of documents our crawlers can't read now live inside
  the Data Steward plan as its To do list, and scattergrams became the last phase of the counselor portal.
- **Nine plans were rewritten.** The family's price is now the personal layer on the cost curve the site already shows.
  The paid tiers are drawn around the plan, visit alerts, and the Data API as they exist, with the public data free as
  ever. Four ideas (near and far, the stress test for a list, cycle watch, getting into the major) shrank to what the
  site hasn't built yet. The three iPhone app plans now describe the site that exists, with the plan at their center.
- The roadmap lists **18 items in five groups**, down from 26 in six.

## Behind the scenes

The review compared each spec's assumptions with the code and the built specs: `lib/early.ts` already implemented the
early-decision measures to its spec, the Explore map view and the drive time already existed, the planner's stores
already carry the entitlement hook the paid tiers need, and the Data API's library is the base the app API should build
on. The retired specs keep their text as the record of what was planned, with a status block at the top saying where
each part was built. Three decisions are left for the owner and are named in the pull request.
