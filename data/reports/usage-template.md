# Usage report: {Month Year}

Copy this file to `data/reports/usage-{month}.md` (for example `usage-november.md` with the year in the heading) at the
start of each month and fill it in for the month just ended. The numbers are copied from PostHog (and Vercel Speed
Insights for performance) **by hand for now**: open each dashboard named below, set the date range to the month, and
copy the figure beside its metric. The insight definitions are in
[specs/product/telemetry.md](../../specs/product/telemetry.md#setup-owner). Leave a cell "n/a" when a number isn't
available yet (a feature that hasn't shipped), never a guess. Nothing here may contain a person's data: counts and
shares only.

Period: {first day} to {last day}. Source: PostHog project `quad-prod`, Vercel Speed Insights.

## 1. Traffic
Dashboard: Traffic.

| Metric | This month | Last month | Change |
|---|---|---|---|
| Visits (unique sessions) | | | |
| Visitors (unique users, weekly average) | | | |
| Top 5 entry pages | | | |
| Top 5 referrers | | | |
| Top 5 countries | | | |
| Phone share of visits | | | |

## 2. Engagement
Dashboard: Engagement.

| Metric | This month | Last month | Change |
|---|---|---|---|
| Colleges viewed per visit | | | |
| Most-read topic page and block | | | |
| Compare rate (visits that added a college) | | | |
| Search success (picked share of searches) | | | |
| Searches with no results | | | |
| Score checker uses | | | |

## 3. Funnels
Dashboard: Funnels.

| Funnel | Entered | Completed | Rate | Last month |
|---|---|---|---|---|
| Search, then profile, then compare | | | | |
| Profile, then list | | | | |
| Sign-up started, then completed | | | | |
| Sign-up, then paid | | | | |

## 4. Retention
Dashboard: Retention.

| Metric | Student | Guardian | Counselor | Last month (all) |
|---|---|---|---|---|
| New accounts | | | | |
| Returned in week 1 | | | | |
| Returned in week 4 | | | | |

## 5. Content
Dashboard: Content.

| Metric | This month |
|---|---|
| Top 10 colleges viewed (name and views) | |
| Top 5 filters used | |
| Top 5 glossary terms opened | |
| Top 5 citations opened | |
| Most-visited roadmap pages | |
| Most-used Over-time chart groups | |

## 6. Performance
Source: Vercel Speed Insights (75th percentile).

| Metric | Phone | Desktop | Last month (phone) |
|---|---|---|---|
| LCP (loading) | | | |
| INP (responsiveness) | | | |
| CLS (layout shift) | | | |
| Slowest route | | | |

## 7. Errors
Dashboard: Errors, and Vercel function logs.

| Metric | This month | Last month |
|---|---|---|
| Errors shown (`error_shown`, kind "error") | | |
| Pages not found (kind "not_found") | | |
| Route with the most errors | | |
| Server errors in Vercel logs | | |

## Observations
-
-
-

## Actions for next month
-
