# Roadmap Pages

> Status: **built** 2026-09-28.

## What it is
`/roadmap` lists the planned specs, grouped the way the [backlog](backlog.md) orders them, each with a one-line summary
and a complexity rating, and, in its own section near the end, the [ideas](ideas/README.md) that aren't planned yet.
`/roadmap/{slug}` renders one spec's markdown as a readable page. The specs in `specs/` stay
the single source: the pages read them at build time, so editing a spec updates its page on the next deploy.

## Files
| File | Role |
|---|---|
| `lib/roadmap.ts` | Registry: slug, spec file, group, summary, complexity (1–4) with a reason, status, and `after` dependencies. Also the complexity scale, the groups, and overview pages (the data-expansion, product, school-identity, and ideas READMEs) |
| `lib/roadmap-render.ts` | Pure markdown → HTML (`marked`, GFM): takes the H1 as the page title (a trailing "(IPEDS …)" becomes the source), gives headings GitHub-style ids, collects the level-2 headings for "On this page", rewrites links, and wraps tables so they scroll on phones |
| `lib/roadmap-docs.ts` | Server-only loader: reads the spec file and renders it (`cache`d per request) |
| `app/roadmap/page.tsx` | Index: the planned and idea counts, the complexity scale with counts, then one list per group, with a link to the group's overview page where one exists |
| `app/roadmap/[slug]/page.tsx` | Spec page: summary, complexity/status/source panel, a sticky contents list on desktop (a collapsible one on phones), the spec, and previous/next links |
| `components/roadmap/ComplexityMeter.tsx` | Four-bar meter with its label |
| `app/globals.css` `.spec-prose` | Typography for rendered specs (headings, lists, code, callouts, tables) |

## Rules
- **Every planned spec is listed.** A spec whose status line starts `> Status: **planned**`, `**skeleton**`,
  `**deferred**`, or `**idea**` must have an entry in `ROADMAP`, and every entry must be such a spec
  (`tests/roadmap.test.mts`). When a spec is built, change its status and remove its entry; when a new one is written,
  add one.
- **Ideas.** A spec whose status line starts `> Status: **idea**` is a direction worth judging, not planned work: it
  gets status `idea` and the `ideas` group (its own section before Later, with an "Idea" badge), and the test checks
  that the entry's status, its group, and the spec's status line agree. An idea page has the question, why it's
  fresh, the data, the display, the tier, and open questions; [ideas/README.md](ideas/README.md) is the group's
  overview and holds the research behind them. An idea becomes planned when its data is verified and it has a place
  in the build order: change the status line and the entry, and move it to a wave group.
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
