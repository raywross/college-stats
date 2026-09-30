# Roadmap Pages

> Status: **built** 2026-09-28.

## What it is
`/roadmap` lists the planned specs, grouped the way the [backlog](backlog.md) orders them, each with a one-line summary
and a complexity rating. `/roadmap/{slug}` renders one spec's markdown as a readable page. The specs in `specs/` stay
the single source: the pages read them at build time, so editing a spec updates its page on the next deploy.

## Files
| File | Role |
|---|---|
| `lib/roadmap.ts` | Registry: slug, spec file, group, summary, complexity (1–4) with a reason, status, and `after` dependencies. Also the complexity scale, the groups, and overview pages (the data-expansion README) |
| `lib/roadmap-render.ts` | Pure markdown → HTML (`marked`, GFM): takes the H1 as the page title (a trailing "(IPEDS …)" becomes the source), gives headings GitHub-style ids, collects the level-2 headings for "On this page", rewrites links, and wraps tables so they scroll on phones |
| `lib/roadmap-docs.ts` | Server-only loader: reads the spec file and renders it (`cache`d per request) |
| `app/roadmap/page.tsx` | Index: complexity scale with counts, then one list per group |
| `app/roadmap/[slug]/page.tsx` | Spec page: summary, complexity/status/source panel, a sticky contents list on desktop (a collapsible one on phones), the spec, and previous/next links |
| `components/roadmap/ComplexityMeter.tsx` | Four-bar meter with its label |
| `app/globals.css` `.spec-prose` | Typography for rendered specs (headings, lists, code, callouts, tables) |

## Rules
- **Every planned spec is listed.** A spec whose status line starts `> Status: **planned**`, `**skeleton**`, or
  `**deferred**` must have an entry in `ROADMAP`, and every entry must be such a spec (`tests/roadmap.test.mts`). When a spec is built, change
  its status and remove its entry; when a new one is written, add one.
- **Later.** A spec set aside until another feature needs it gets status `**deferred**` and the `later` group, the last
  section on `/roadmap`, with its "Deferred" badge. Say in the spec why it waits and what it gets built with; move it
  to a wave when that feature is scheduled. The backlog's "Later" section lists the same specs.
- **Links.** A link to another roadmap page stays on the site (`/roadmap/{slug}#anchor`); any other repo link opens the
  file on GitHub (the repo is public). The test checks that every in-site anchor exists on its target page.
- **Static.** `generateStaticParams` + `dynamicParams = false`: every page is prerendered, and unknown slugs 404.
  `next.config.ts` also traces `specs/**/*.md` into `/roadmap/*` in case a page is ever rendered on demand.
- The markdown is trusted repo content, so it's rendered without sanitizing. Don't point the renderer at user input.

## Complexity scale
| Rating | Meaning |
|---|---|
| Small | A few fields from a source already read, shown in one or two places |
| Medium | A new source file or a new profile section, with filters and history |
| Large | New shared infrastructure or a new kind of view, used by later work |
| Extra large | A new system with its own pipeline, checks, and a pilot before launch |

Ratings are judgment calls made from each spec's ingest, store, and display sections; revisit them when a spec changes.

## Where it's linked
Desktop: footer ("Roadmap: what's coming"); not in the header nav, which stays for the four main tasks. Phones: the tab bar's More sheet (the footer's link column is hidden below `md`; see [mobile.md](mobile.md)).
