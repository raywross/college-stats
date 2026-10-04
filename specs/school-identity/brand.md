# Colors and Marks: The College's Own Look on Its Profile (Wikipedia color data + the college's icon)

> Status: **built** 2026-10-04 (branch `feature/identity-brand`; see [As built](#as-built), with real coverage, the
> contrast check's results, and the deviations). Planned 2026-10-03. Part of the [identity family](README.md); reads
> the Wikipedia article link that [social-accounts.md](social-accounts.md) stores. Research 2026-10-03: Wikipedia's
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
counsel once before the first deploy with marks (done: counsel approved showing the marks, 2026-10-04).

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
  names: (string | null)[] | null; // ["red", null, "black"] (as built: null where the source names no color)
  accent: string | null;           // "#BA0C2F"
  on_accent: "white" | "black" | null;
  crest_to?: string | null;        // as built: the crest gradient's end, "#81001C" (see As built, deviation 3)
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

## As built
Built 2026-10-04 on `feature/identity-brand`, all three steps in one branch. Defaults taken for the open questions: a
college with colors but no acceptable icon gets a monogram in its colors (2), and the WebP files live in the repo
until they pass about 25 MB (3).

### Pieces
| Piece | What it does |
|---|---|
| `lib/brand-colors.ts` | Pure. A Lua reader for the module (keyed and positional fields, comments, escapes, long strings; a repeated key keeps its last value, as Lua does); wikitext helpers (templates, links, the `{{cite …}}` an entry carries); the infobox reader; the join; OKLab/OKLCH and WCAG math; `deriveBrand`; `applyBrand` with lineage and override checks |
| `scripts/lib/wikipedia-colors.mts` | The module once and every article's lead (section 0) through the MediaWiki API, redirects followed, one request a second, `maxlag=5`, user agent `QuadCollegeStats/1.0 (https://college-stats-nine.vercel.app/data)`, cached 30 days in `.cache/wikipedia/`; writes `data/brand-colors.json` |
| `scripts/lib/brand-icons.mts` | Ranks each college's icon candidates from `data/site-probe.json`, downloads through `PoliteHttp`, decodes with `sharp` (ICO parsed here), checks, writes `public/brand/{unit_id}.webp` and `data/brand-logos.json` |
| `scripts/sync-brand.mts` | `npm run sync-brand` (`--colors`, `--icons`, `--ids`, `--refresh`, `--no-merge`, `--wikidata <file>`), then `mergeIdentity`; without a step named, a step whose input file isn't there yet is skipped with a note |
| `lib/brand.ts` | `crestBrand` (gradient, text color, mark URL; `BRAND_MARKS=off` hides marks), `brandTint` (per-theme tints for the hero and card glow), `BRAND_REMOVAL_CONTACT` |
| `components/school/Crest.tsx` | Mark on a white tile (image at 80%, so 10% padding each side), else the monogram on the college's gradient in `brand.text`, else today's tile; same sizes everywhere, the hero's `size-14 sm:size-24` unchanged |
| Hero, cards | The hero's radial tint and the Explore card's glow read `--tint-light`/`--tint-dark` and pick with `dark:`; a 3 px accent line under the hero from `sm` up |
| `/data` | "Colors and marks" under The datasets: sources, the trademark line, the removal route, and live counts |
| `scripts/check-hero-contrast.mts` | The rendered contrast check (below) |

### Real runs (2026-10-04)
**Colors.** `Module:College color/data` revision 1375970502 (edited 2026-09-21): 1,552 entries and 951 alias keys
after Lua's last-value rule (four keys are defined twice), 1,515 entries citing a guide (1,122 `cite web`, 392
`cite manual`, 1 `cite book`), 37 uncited. `data/wikidata.json` (social track): 1,663 colleges with an English
article. 35 requests in all (the module and 34 batches of 50 leads), 35 seconds.

| Result | Colleges |
|---|---|
| **Colors** | **1,316** (79% of colleges with an article, 70% of 1,893) |
| from the module by exact key / alias / normalized key | 682 / 31 / 35 (748) |
| from the infobox's own hex values | 568 |
| none: no colors in the infobox | 193 |
| none: color names only ("Red and black", `{{color box|maroon}}`) | 136 |
| none: a team link the module doesn't know | 8 |
| none: no infobox | 10 |

The spec's estimate of 1,500 assumed more infoboxes give hex values; the shortfall is the 329 articles that give
names or nothing, which the rule against guessing from names leaves alone (the brand-guide reader deferred above is
the way to close it). Derived: text white on 1,129 accents, black on 187; the crest's end is a second brand color for
122, a darkened accent for 994, a lightened one for 199; 3 colleges have only neutral colors (accent = the first).
Every accent and every gradient end has at least 4.50:1 against its text color. `data/brand-colors.json`: 462 KB.

**Marks.** `data/site-probe.json` (probe track, 2026-10-04): 1,808 of 1,893 colleges with icon candidates (8,264 in
all: 1,961 declared touch icons, 2,842 declared icons, 3,461 conventional fallbacks). One full run, 4,682 requests
through `PoliteHttp` (robots.txt honored, a second apart per host, 12 colleges in flight), about 30 minutes; then a
re-run of the 20 colleges the guards added afterwards (84 requests).

| Result | Colleges |
|---|---|
| **A mark** | **1,118** (59% of 1,893; 62% of the 1,808 with candidates); 1,119 after the older ICO formats (follow-ups.md) |
| from a declared touch icon / a declared icon / the conventional paths | 855 / 153 / 110 |
| source format: PNG / ICO / JPEG / WebP / SVG / other | 902 / 95 / 68 / 32 / 15 / 6 |
| none, by the last candidate's reason: 404 | 254 |
| too small (under 64 px: mostly 16–48 px favicons) | 207 |
| the probe found no candidate (no homepage answer) | 85 |
| not an image (an HTML page with status 200) | 63 |
| 403 (bot protection) | 57 |
| robots.txt disallows it | 49 |
| an ICO with no PNG or 32-bit entry (see deviation 8; decoded since, see follow-ups.md section 2) | 42 |
| a platform's default (below) / blank on white / other | 11 / 1 / 6 |

Storage: 1,118 files, 5.9 MB (5,907,762 bytes; 5.3 KB average, 35 KB the largest), well under the 25 MB line.
`data/brand-logos.json`: 246 KB. The first pass stored 1,137; reviewing them found what the checks then learned:
WordPress's own W logo on 14 colleges (WordPress redirects a missing `/favicon.ico` to it), one company's
`arrow_forward.svg` declared as the touch icon on three of its colleges' sites (5 colleges), and one near-white glyph;
the re-run gave one of the 20 a real icon. Shared marks that stay are systems whose campuses use the system's icon
(Arizona College of Nursing 18 campuses, Strayer 17, the University of Minnesota 5, Antioch 4, the University of Puerto
Rico's campuses on three sites, CU Boulder and CU Colorado Springs on two, and so on: 32 images shared by 109 colleges,
every one within one system or one site). Of the profiles in the visual QA, Stanford, Harvard, Berkeley, and Yale have
marks; UGA (a 48 px favicon) and Vanderbilt (its icon host's robots.txt) show monograms in their colors.

### The rendered contrast check
`scripts/check-hero-contrast.mts` opens each hero in Chromium (1280 and 390 px wide, light and dark), reads every hero
text node's color and box, hides all text, screenshots what was behind it, and takes the 10th percentile of the
pixel-by-pixel contrast in each box (so the hero's 1 px dot texture, one pixel in 22×22, isn't taken for the
background while the tint's gradient still counts). AA: 4.5:1, or 3:1 at 24 px or 18.66 px bold. Run 2026-10-04 with
the real marks and the links and social rows of the other identity tracks in the hero (the last two rows: the first
run, with development marks):

| College (tint hue) | 1280 light | 1280 dark | 390 light | 390 dark | Crest |
|---|---|---|---|---|---|
| UGA 139959 (red, 21°) | 4.58 | 5.63 | 4.86 | 6.22 | monogram 6.96:1 |
| Vanderbilt 221999 (gold, 83°) | 4.76 | 5.40 | 5.03 | 6.11 | monogram 7.97:1 |
| Stanford 243744 (cardinal, 27°) | 4.59 | 5.56 | 4.88 | 6.21 | mark |
| Harvard 166027, and the hues worst for muted text: Boston U, Indiana, Clemson, Oregon | 4.60–4.85 | 5.50–5.76 | | | Harvard a mark; monograms 5.6–6.5:1 |
| Hunter 190594 (no colors: today's hashed tint) | 4.66 | 5.19 | | | generated monogram 2.80:1 |

Every hero text passes in both themes; the lowest is the muted breadcrumb at the top left, where the tint is
strongest. Over every hue, muted text at the tint's full strength would be 4.33:1 (light) and 4.75:1 (dark) on a
college's tint against 4.20:1 and 4.03:1 on today's hashed tint, so college colors never make the hero harder to read
than it is now. Shown to fail: with the tint's alpha raised from 0.35 to 0.9, UGA's breadcrumb measured 3.10:1 (light)
and 2.65:1 (dark) and the check exited 1.

### Checks (each shown to fail when broken, 2026-10-04)
- `tests/brand-colors.test.mts` (18): the Lua reader; entries, an alias, and a cite (the fixture is 50 real module
  entries, `tests/fixtures/brand/college-color-data.lua`); the three infobox shapes and names-only; the join by key,
  alias, and normalized key, and an ambiguous normalized form joining nothing; accent skips white, black, and gray;
  `on_accent` black for `#FFC72C`, white for `#002B5C`; tints within L ± 0.02 and chroma ≤ 0.16 as a browser shows
  them for all 147 colors of the fixture; the gradient end at 4.5:1; `applyBrand` lineage, idempotence, overrides;
  `crestBrand` and `BRAND_MARKS=off`. Broken on purpose 13 ways (aliases dropped, cite ignored, names turned into
  colors, no normalized join, accent = first color, text always white, tint chroma uncapped, gradient end without the
  contrast check, old lineage kept, unsourced correction accepted, `logo: false` ignored, `BRAND_MARKS` ignored, the
  mark's lineage not extracted): each failed.
- `tests/brand-icon.test.mts` (11): the largest touch icon first, and the probe's real entries (UGA's, Stanford's)
  ranked; 32 px rejected, 180 px stored as a 192 px WebP; 200×190 cropped, 300×100 and 229×256 rejected; an ICO's largest
  entry; 32-bit BMP entries top-down with the mask's alpha; transparent, white, and near-white glyphs rejected, a small
  dark one kept; SVG rasterized; runs: removals (full and `--ids`), a timeout or a silent host keeps the mark, a refusal
  or 404s remove it, orphans deleted, WordPress's logo refused, a stock image on three unrelated sites refused while one
  system's shared seal stays. Broken 15 ways (size floor, square tolerance, ICO entry order, BMP rows, transparency,
  ink floor, ranking, removals, timeouts, silent hosts, the WordPress check, the shared-image pass, its threshold, its
  name families, orphans): each failed.
- `tests/brand-files.test.mts` (7, the verify-time check): every mark has its 192 px WebP and every file a mark and a
  school; a `brand.logo` in the dataset has its file; a `logo: false` removal leaves no file, row, or mark; color rows
  and overrides are well formed; the committed files give every school valid lineage; every `<Crest>` in `app/` and
  `components/` passes `brand`; nothing in `components/charts/` reads a college's colors. Broken 9 ways (an orphan
  file, a row without its file, a 64 px file, a removal with its file still there, an unsourced override, an override
  for no school, a color that isn't hex, a `<Crest>` without `brand`, a chart reading the accent): each failed.
- `tests/identity.test.mts` (foundation) passes with the real files: applying identity twice equals once.

### Deviations from the plan
1. **A separate step reads the other tracks' files.** The plan put the color fetch in `sync-wikidata` and the icon
   fetch in the links probe. `npm run sync-brand` instead reads `data/wikidata.json` and `data/site-probe.json`, so
   the five tracks could be built apart; `syncBrandColors(root)` and `syncBrandIcons(root)` can be called from those
   scripts if the integrator prefers one command.
2. **50-title batches.** `rvsection=0` turned out to work for every page of a 50-title batch (measured: Harvey Mudd's
   lead 3,897 characters alone or batched), so 34 requests fetch every lead instead of ~1,660.
3. **One more stored derived field, `brand.crest_to`**, the gradient's end, so the app does no color math. "Second
   color" is read as the next brand color after the accent with white skipped (in the module white is nearly always
   the text-color slot, unnamed); a black or gray one becomes a darkened accent, white alone a lightened one, and any
   end that would leave the monogram under 4.5:1 is shaded back toward the accent. Without this Georgia (red, white,
   black) would have gone red to pink rather than red to dark red.
4. **Names are aligned with colors, null where the module names none** (`(string | null)[]`), since the module leaves
   the white text slot unnamed (`name1="red", name3="black"`). `lib/types.ts` and `lib/identity-files.ts` changed
   accordingly (additive for readers).
5. **Infobox details.** "black" and "white" color boxes beside at least one hex value count as `#000000`/`#FFFFFF`
   (exact whoever writes them); other named boxes are dropped, so a few colleges keep a partial list (Miles College's
   gold without its purple). `{{color sample}}` counts as a color box. Names come from the text after the boxes when
   there is exactly one per color.
6. **Normalized join, measured.** Beyond dashes, accents, "&", and "St." (after the first word) as "State", it tries
   the men's half of a two-team athletics article ("Central Arkansas Bears and Sugar Bears" → "Central Arkansas
   Bears") and a sport's article for its program ("Sewanee Tigers football" → "Sewanee Tigers"): 35 joins, all
   checked by hand. A normalized form shared by two entries joins nothing.
7. **Lineage.** `brand.colors` (and `brand.names`): `{ source: "wikipedia", method: "reported", url: <the brand guide
   the entry cites, else the module's page>, field: <the module key>, quote: <the guide's title>, retrieved }`;
   infobox colors cite the article with `field: "infobox colors"` and the field as written as the quote. Corrected
   colors carry the override's `_lineage` (required, with source and URL). `brand.logo`: `{ source: "college-site",
   method: "extracted", url: <the icon's URL>, retrieved, year: <retrieval year>, quote: <the declaring tag and the
   homepage> }`. The derived fields cite `brand.colors` through the registry.
8. **Marks: extra rules.** Safari's monochrome `mask-icon` and `data:` URIs are never used. Candidates are re-ranked:
   declared touch icons by size; declared icons of a stated size of 64 px or more (an SVG counts as large); the
   probe's `rel: "fallback"` `/apple-touch-icon.png`; declared icons of unknown size and `/favicon.ico`; last, icons that
   say they're under 64 px. At most four downloads per college. Three more rejections: **blank on white** (under 1% of
   the tile shows ink once laid on white: white or near-white glyphs made for dark browser tabs); **WordPress's own
   logo** (any final URL under `/wp-includes/images/`); and **a platform's default**: an identical mark on three or more
   sites for three or more differently named colleges (name families: the first three words before a dash, comma,
   or "at") sends those colleges back for their next candidate, while one system's shared icon stays. ICO: PNG entries
   via sharp, 32-bit BMP entries converted to RGBA (the AND mask gives alpha when every alpha byte is 0). Built
   first without 1-, 4-, 8-, and 24-bit entries (42 colleges' last candidate was such an ICO); those decode since
   2026-10-04 (follow-ups.md section 2), and only 16-bit and compressed entries are skipped. A passing failure (timeout, 5xx, a
   host that didn't answer) keeps yesterday's mark; a refusal (robots.txt, 4xx, a rejected image) removes it.
9. **`next/image` with `unoptimized`.** `next.config.ts` sets no image loader, and the stored WebP is already the
   largest size any tile shows (96 px at 2x), so the optimizer would only add a transformation per size on Vercel.
10. **Dark mode.** The 15% ring is white (a ring sits outside the tile, on indigo, where a black one can't show), and
    tiles in a college's colors get it too, since navy and black tiles sank into indigo. The tile's sheen is fainter on
    a college's colors (18% rather than 35%).
11. **Client data.** `ScatterPointData` and the Explore map's `MapPoint` (`lib/us-map.ts`) carry `brand` for the hover
    card (about 110 KB of uncompressed JSON for the map's 1,303 points with colors, measured before the marks; each
    mark adds a 24-character URL).

### Left for the owner
- **The removal address.** `BRAND_REMOVAL_CONTACT` (`lib/brand.ts`) is a prefilled issue on
  `github.com/raywross/college-stats`; it only works while the repo is public. Choose a permanent address (an email
  that someone reads daily, since a request is honored within a day).
- ~~Counsel, once, before the first deploy with marks~~: **approved 2026-10-04**. Marks are on (they show unless
  `BRAND_MARKS=off` is set at build time, and nothing sets it).
- **The colleges without a mark** (775): a monogram in their colors when they have colors (open question 2's default).
  Many have a 16–48 px favicon only; a college that wants its mark shown can add a 180 px `apple-touch-icon` to its
  homepage, and the next run picks it up.
- ~~ICO entries other than PNG or 32-bit~~: decoded since 2026-10-04 (follow-ups.md section 2). One college gained a
  mark; the rest of those icons are 16–48 px favicons, below the 64 px floor.
