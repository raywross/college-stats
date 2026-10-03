# School Identity: Links, Accounts, Short Names, Colors and Marks

> Overview of four planned specs (2026-10-03). Each is a separate unit of work; the order below is the build order.

## Why
A profile today is all figures. It has no link to the college's website (the dataset has one, unused), no way to
reach admissions or book a tour, no social accounts, and search does not know that "UGA" is the University of
Georgia. The hero is tinted with a color hashed from the unit id and the crest is a generated monogram, so every
college looks like the site rather than like itself.

## Specs
| Spec | Adds | Source | Complexity |
|---|---|---|---|
| [links.md](links.md) | Website, admissions, apply, financial aid, veterans', and disability-services links, and the campus **visit** page found on the college's site | IPEDS HD (already downloaded) + the college's admissions page | Medium |
| [social-accounts.md](social-accounts.md) | Instagram, YouTube, TikTok, X, Facebook, LinkedIn; introduces `npm run sync-wikidata` and `data/wikidata.json` | Wikidata (by IPEDS id) + the homepage footer | Medium |
| [aliases.md](aliases.md) | A table of short names and nicknames (UGA, Vandy, Georgia Tech, Ole Miss) that search and Explore match | IPEDS HD, Wikidata, the homepage domain, a curated file | Medium |
| [brand.md](brand.md) | The college's own colors in the hero and crest, and its site icon in place of the monogram; the legal summary and the owner's decision | Wikipedia's college color data (cited to brand guides) + the college's site icon | Large |

## Shared pieces
- **The Wikidata link** (`sync-wikidata`, from social-accounts): one query keyed by IPEDS id gives accounts, other
  names, the Wikipedia article, and the Commons logo file for 1,719 of 1,893 colleges. Aliases and brand read it.
- **The homepage probe** (from links): one polite fetch of each homepage and admissions page, through the
  college-reported crawler (robots.txt, one request a second per host), collects the visit link, the footer's
  social links, and the site icon in a single pass.
- **Corrections** go in the existing `data/overrides.json` (links, accounts) or the new `data/aliases-curated.json`
  and `data/brand-overrides.json`, each value with its source, like every other override.

## What was measured (2026-10-03)
- `HD2025`: homepage 1,893, admissions 1,800, application 1,757, financial aid 1,807, net price 1,877, veterans
  1,454, disability services 1,893, alias 882 (of 1,893 colleges).
- Wikidata: 1,719 colleges have an item; X 1,504, Facebook 1,296, Instagram 1,045, YouTube 580, TikTok 225,
  LinkedIn 193; any account 1,548; a Commons logo 1,032; other names 1,354 (677 with a short all-caps one);
  an English Wikipedia article 1,663. Official colors (P6364): 27, so colors come from Wikipedia instead.
- Wikipedia `Module:College color/data`: 1,555 programs, 918 aliases, 1,519 with a citation to a brand or
  athletics guide. Of 14 random infoboxes, 7 gave hex colors, 5 names only, 2 none.
- Homepages (18 reachable of 20): 16 declared an icon, 11 a touch icon (mostly 180–192 px); 1 a theme color.
- College Scorecard: `school.alias` is the HD column a year older; `school.school_url` is set for all 1,893 and is
  already stored as `links.website`.
