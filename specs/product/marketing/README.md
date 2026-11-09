# Marketing

Planned 2026-11-09 from the owner's brief: advertise to parents, counselors, and students as separate campaigns, track
success, know the cost, and run the whole thing from the admin console, with PostHog's numbers pulled in and SEO
driven from the console too. Four specs; the plan first, then the three things that get built for it. Part of
[product](../README.md).

| Spec | What it covers |
|---|---|
| [plan.md](plan.md) | The plan: where we stand, principles (search is the engine; the first push on Google and Meta only; no pixels and no behavioral targeting, with students 13 to 17 reached contextually; the counselor is the channel), the economics at $20 a year (a $12 ceiling per trial), the three campaigns with seasons, messages, placements, landing pages, conversions, budgets, and stop-or-grow rules, the calendar through August 2027, a budget of about $7,300 with $6,900 in ad spend over three months, the channels layered in later with their triggers, the funnel and nine metrics with targets, what must exist first, owner decisions |
| [measurement.md](measurement.md) | Attribution without tracking: campaign links (`/go/{code}`), a 30-day first-party cookie holding only the code, `acquired_via` on the account, new funnel events, PostHog dashboards, the Query API pulled daily into our own tables, cost per trial, the weekly review, what we never do |
| [seo.md](seo.md) | Search from the console: today's gaps (no sitemap, robots, descriptions, Open Graph, or structured data), what search can send, the code built once (sitemap, robots from switches, metadata templates, canonical, Open Graph images, JSON-LD, IndexNow), the Search screen (templates with live preview, per-page overrides, crawler switches including AI crawlers, Search Console numbers, indexing, sharing preview), the Steward's weekly SEO audit, the content program |
| [console.md](console.md) | The Growth door: Overview, Campaigns with the link builder and QR codes, **the ad platforms** (Google Ads and Meta campaigns written, launched, paused, and re-budgeted from the console through their APIs, with a dry run, a spending ceiling, an hourly sync, and alerts to the owner's phone, because the platforms' consoles are blocked at the owner's day job), Pages (editable landing-page copy), Search, Emails (lifecycle sequences and a double-opt-in newsletter for adults), Spend; the tables, jobs, help entries, owner steps, and the four-wave build plan with a model per unit |

Order: wave 1 (findable, measurable, landing pages) and wave 2 (the ad platforms) before the January 2027 push;
wave 3 (search in the console, sharing); wave 4 (spend, lifecycle mail, newsletter) after Stripe and the trial ship
([../commercialization.md](../commercialization.md)).
