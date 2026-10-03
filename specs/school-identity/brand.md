# Colors and Marks: The College's Own Look on Its Profile (Wikipedia color data + the college's icon)

> Status: **planned** 2026-10-03. Part of the [identity family](README.md); reads the Wikipedia article link and
> the Commons logo file that [social-accounts.md](social-accounts.md) stores. Research 2026-10-03: Wikipedia's
> college color data module downloaded and counted; fourteen colleges' Wikipedia infoboxes read; twenty college
> homepages probed for icons and theme colors; four Commons logo files' license tags read; the trademark and
> copyright position summarized below. Figures are measured unless marked *estimate*. **The legal section is a
> summary, not legal advice.** Decided 2026-10-03: the owner chose to show marks (option b below: colors and each
> college's own site icon, with every safeguard listed), accepting the trademark risk.

## Question it answers
*Does this page feel like the college?* Every profile hero today is tinted with a hue hashed from the unit id, and
the crest is a generated monogram on a gradient ("UGA" in white on violet-pink). The owner would like the hero to
carry the college's own colors and, where allowed, its mark in place of the monogram, at the same size.

## What is proposed
1. **Colors** for every college we can source them for (*estimate:* 1,500 of 1,893), used as the hero's tint and
   the crest tile's gradient. Colors carry no legal risk worth planning around (below), so this part ships first.
2. **A mark** in the crest tile, the same size as the tile today (56 px on phones, 96 px on desktop in the hero;
   36–48 px in the compact header, cards, and search rows), from the college's own site icon, with the monogram as
   the fallback. Approved by the owner on 2026-10-03 (legal section below); it ships with the safeguards listed
   there, in the PR after colors.
3. **Opt-out and correction files**, a trademark line on `/data`, and a documented removal route, whichever marks
   are used.

Nothing else changes: the site's own violet, lime, and domain colors stay everywhere else; charts never use a
college's colors (the compare slot palette is validated for contrast and stays); the design rule "crests are
decoration, never data" ([design-system.md](../design-system.md)) stays.

## Source: colors

### Wikipedia's college color data (primary)
English Wikipedia keeps every college athletic program's colors in one Lua table,
[`Module:College color/data`](https://en.wikipedia.org/wiki/Module:College_color/data) (483 KB, read 2026-10-03):
1,555 programs plus 918 alias keys, each entry a list of hex colors in brand order with names and, for all but a
few, a citation to the college's own brand or athletics style guide (1,126 `cite web`, 392 `cite manual`, 1 book;
3 entries note they were eyedropped). Examples:

| Key | Colors | Cited to |
|---|---|---|
| `Georgia Bulldogs` | `BA0C2F`, `FFFFFF`, `000000` (red, white, black) | University of Georgia logo guide, May 2025 |
| `Vanderbilt Commodores` | `000000`, `FFFFFF`, `CFAE70` (black, white, gold) | Vanderbilt brand style guide |
| `Stanford Cardinal` | `8C1515`, `FFFFFF` (cardinal, white) | Stanford identity toolkit |
| `Berea Mountaineers` | `004B87`, `FFFFFF` (Berea blue, white) | a third-party color site (weaker) |

These are athletics colors, which for nearly every college are the institutional colors; where a college's academic
palette differs (Vanderbilt's academic gold is a different hex), athletics is the look people know. The table is
keyed by team name, not IPEDS id, so a college is joined through its Wikipedia article (from Wikidata's sitelink,
1,663 colleges): the infobox's `colors` field is either `{{college color list|team=Georgia Bulldogs}}` (the key
directly) or the `sports_nickname`/`athletics_nickname` link target (`[[Georgia Bulldogs|Bulldogs]]`), which is the
key or one of its aliases. Join by exact key, then by alias key, then by normalized key (dashes, "State", "–").

### The article's infobox (secondary)
Of fourteen random colleges' infoboxes read on 2026-10-03, seven gave hex values directly
(`{{color box|#4F2D7F}} {{color box|#818A8F}} Purple & gray`), five gave only names ("Red and black", "Crimson,
Black"), and two had none. Hex values are taken when the module has no entry; names alone are not guessed from.

### What was checked and rejected
- **Wikidata official color (P6364):** 27 of 3,857 items. Too sparse.
- **`<meta name="theme-color">` on the homepage:** 1 of 18 pages. Too sparse.
- **The dominant color of the icon:** automatic but often wrong (white tiles, gray seals). Not used, even as a
  fallback.
- **Reading each college's brand guide with a model:** the college-reported ladder could, at *estimate* $0.01–0.05 a
  college, for the ~400 left without colors. Deferred until the two sources above are in and the gap is measured.

## Source: marks

### What the measurements say
| Option | Coverage | Shape and size | Notes |
|---|---|---|---|
| **The college's site icon** (`apple-touch-icon`, then the largest `<link rel="icon">`, then `/apple-touch-icon.png`, then `/favicon.ico`) | 16 of 18 reachable homepages declared an icon; 11 a touch icon, mostly 180–192 px | Square by design; made by the college for exactly this use (a small tile that stands for its site) | Some are 32 px only (too small for the 96 px tile: use the monogram); two homepages answered 403 to the probe |
| **Wikimedia Commons file from Wikidata P154** | 1,032 colleges; 414 SVG, 581 PNG | Often a wide wordmark or a seal, not a square mark | Tagged: Vanderbilt and Stanford `Public domain` + `trademarked`; Georgia Tech `trademarked` + `insignia` (a seal); Rowan untagged. Seals are the marks colleges restrict most |
| Commercial logo services (Brandfetch, logo.dev; Clearbit's shut down 2025-12-08) | High | Square | A paid dependency serving the same icons, with their own attribution terms; not needed |

**Recommendation:** the site icon, fetched once per college by the [links](links.md) probe (same crawler, robots.txt
honored), stored at 192 px as WebP in `public/brand/{unit_id}.webp` (*estimate:* 1,500 files × 5–8 KB ≈ 10 MB;
committed like the history shards, or moved to Supabase Storage if the repo grows past the owner's comfort), and
served through `next/image` at the tile's size. Commons files are not used in this round: too many are seals or
wordmarks, and a square icon of the college's own choosing is the better fit for a 56–96 px tile.

## The legal position, in plain terms (for the owner's decision; not legal advice)
Two separate questions apply to every mark, and a third to colors.

1. **Copyright.** Simple text and shape logos fall below the threshold of originality and are public domain
   (Commons tags them `PD-textlogo`; Vanderbilt's and Stanford's wordmarks are tagged so). Pictorial marks and most
   seals are copyrighted. Showing a small copy to identify the college beside factual data about it is the classic
   fair-use case (Wikipedia relies on it for every non-free logo), but fair use is a defense, not a permission.
2. **Trademark.** Every college mark is a trademark whether or not it is copyrighted. U.S. law allows *nominative
   fair use*: using a mark only to refer to its owner, no more of it than needed, without suggesting endorsement.
   A small icon next to "University of Georgia" and its admission rate is that. Against this, nearly every
   university's brand policy says third parties need written permission to use its marks, and the licensing
   agents that enforce merchandising rules do send letters. Policies are not law, but a letter costs time either
   way. Comparable sites (college search and ranking sites) show marks, and so do link previews in every messaging
   app, which is what a site icon exists for.
3. **Colors.** A color or a pair of colors is not copyrightable, and trade dress claims need a product or
   packaging context that a tinted web page does not have. The hex values are facts; the Wikipedia compilation is
   CC BY-SA, so `/data` credits it (and the brand guide each entry cites). Risk: none worth planning around.

**What lowers the risk if marks are shown:** use the college's own site icon rather than a seal or a wordmark; keep it
at tile size, never in the site's own branding, ads, or share images; add to `/data` a line that marks and colors
identify colleges, belong to them, and imply no endorsement; publish a removal address and honor a request within a
day by setting `logo: false` in `data/brand-overrides.json` (the monogram returns on the next deploy); and ask
counsel once before the first deploy with marks.

**The options were:** (a) colors only; (b) colors and site icons with the safeguards above; (c) colors and
icons only for colleges that have opted in or granted permission (the college-reported workflow could ask, but
that is a different project). **Decided 2026-10-03: (b).** The owner accepts the trademark risk; the safeguards
above are all required, and a removal request is honored within a day. The spec degrades to (a) by one flag
(`BRAND_MARKS=off` at build time hides every mark without touching the data) should that ever be needed.

## Ingest
- `sync-wikidata` (existing from [social-accounts.md](social-accounts.md)) fetches each college's article infobox
  (section 0 wikitext via the MediaWiki API, 1,663 requests at a polite rate, cached 30 days) and the color module
  once; `lib/brand-colors.ts` parses the `colors`, `sports_nickname`, and `athletics_nickname` fields, joins, and
  writes `brand.colors` with the module key and its citation as lineage.
- The [links](links.md) probe fetches the icon: parse the homepage head for `apple-touch-icon` (largest `sizes`),
  then `icon`; try `/apple-touch-icon.png`; last `/favicon.ico`. Accept PNG, ICO, SVG, WebP, JPEG; decode with
  `sharp` (new dev dependency, used only by scripts); reject anything under 64 px on its short side, non-square
  (crop to center square when the long side is within 10%), or fully transparent; resize to 192 px, WebP quality
  85; write `public/brand/{unit_id}.webp` and `brand.logo = { source_url, retrieved, width }`.
- `data/brand-overrides.json`: `{ "<unit_id>": { "logo": false } }` or `{ "colors": ["#BA0C2F", "#000000"], "_lineage": {…} }`
  for corrections and removals; applied last.
- Derived at sync time, so the app does no color math: for each color, OKLCH lightness and chroma; `brand.accent`
  = the first color that is neither white nor black nor gray (chroma > 0.03), else the first color; `on_accent` =
  `"white"` or `"black"`, whichever gives ≥ 4.5:1 contrast on the accent (the monogram's text color); `tint_light`
  and `tint_dark` = the accent re-lit to OKLCH L 0.72 / 0.62 with chroma capped at 0.16, so the tint reads on both
  the paper and the indigo backgrounds.

## Store
```ts
brand?: {
  colors: string[] | null;         // hex, brand order, e.g. ["#BA0C2F", "#FFFFFF", "#000000"]
  names: string[] | null;          // ["red", "white", "black"]
  accent: string | null;           // "#BA0C2F"
  on_accent: "white" | "black" | null;
  tint_light: string | null;       // "oklch(0.72 0.16 20)"
  tint_dark: string | null;
  logo: { source_url: string; retrieved: string; width: number } | null;   // the file is public/brand/{unit_id}.webp
} | null;
```
Fields in `lib/fields.ts`: `brand.colors` (source `wikipedia`, a new `SourceKey`, with the module and the cited
brand guide in each value's lineage URL), `brand.logo` (source `college-site`, lineage URL = the icon's URL).
The derived fields are registered as derived from `brand.colors`.

## Display
- **Hero**: `crestTint(id)` becomes `brand.tint_light`/`tint_dark` when present (same alpha, same radial gradient),
  else the hashed hue as today. A 3 px accent line under the hero on desktop; nothing more. Text stays on the
  site's background tokens, never on a raw college color, so no per-college contrast case exists for text.
- **Crest tile** (`Crest.tsx`): with a mark, the tile shows `public/brand/{unit_id}.webp` on a white tile with 10%
  padding and the existing ring (`ring-black/5`), at the same sizes as today; the hero's `size-14 sm:size-24` stays
  exactly. Without a mark but with colors, the gradient is `accent → second color` (black or white second colors
  use a darkened or lightened accent instead) and the monogram text is `on_accent`. Without either, today's tile.
- **Compact header, Explore cards, search rows, Compare header, leaderboards**: the same `Crest` component, so they
  change together; small sizes use the same WebP.
- **Dark mode**: tints use `tint_dark`; the white tile behind a mark stays white (a mark drawn for a light tile
  often has no dark variant), with the ring at 15% so it reads on indigo.
- `/data`: a "Colors and marks" paragraph: sources, the trademark line, the removal address.

## Keep history?
No. Colors and marks are replaced when they change; the previous WebP is overwritten.

## Checks (each shown to fail when broken)
- `tests/brand-colors.test.mts`: parsing the module's Lua (an entry, an alias, a cite); the three infobox shapes
  above; the join by key, alias, and normalized key; accent selection skips white/black/gray; `on_accent` is black
  for `#FFC72C` and white for `#002B5C`; tints stay within L ± 0.02 and chroma ≤ 0.16 for every color in a fixture
  of 50 real entries.
- `tests/brand-icon.test.mts`: head parsing picks the largest touch icon; fixtures of a 32 px icon (rejected),
  a 180 px PNG (accepted), a wide image (cropped), an ICO with several sizes (largest taken).
- A verify-time check that every `brand.logo` has its WebP and every WebP has a school, and that `logo: false`
  overrides leave no file behind.
- A rendered check (the existing Playwright setup) of three heroes in both themes against the page's text contrast
  rules, run once in the build PR.

## Cost
Wikipedia and the homepages: free. `sharp` adds a dev dependency. Storage: *estimate* 10 MB of WebP in the repo.

## Decisions and open questions
1. **Decided 2026-10-03:** show colors and site icons (option b), with the safeguards.
2. Should a college with colors but no acceptable icon get a monogram in its colors (as specified), or keep the
   site's hashed gradient so the two cases look alike? Default: its colors.
3. Where the WebP files live: the repo (simple, reviewed in PRs) or Supabase Storage (keeps the repo small).
   Default: the repo until it passes about 25 MB.

## Implementation plan
1. Colors: `lib/brand-colors.ts`, the module and infobox fetch in `sync-wikidata`, derived fields, overrides,
   tests; hero tint and crest gradient. One PR.
2. Marks: the icon fetch in the links probe, `sharp`, `public/brand/`, overrides, the `/data` paragraph and
   removal route, the `BRAND_MARKS` flag, the verify check; `Crest.tsx` renders the mark. The next PR.
3. The rendered contrast check in both themes.
