# Glossary & Tooltips

Every term of art gets an explanation one hover or tap away, backed by a full glossary page.

## Source of truth: `lib/glossary.ts`
`GLOSSARY: Record<TermKey, GlossaryEntry>`. Each entry has:
- `term`: display name
- `short`: one or two sentences shown in pop-overs
- `long?`: detail for the glossary page
- `why?`: "Why it matters" for students
- `category`: Admissions, Test scores, Students & access, School types, How we measure, Data sources
- `related?`: other keys (checked with `isTermKey`)

To add a term, add an entry; `TermKey` updates automatically and TypeScript flags any unknown key.

## Components (`components/ui/info-tip.tsx`)
| Component | Look | Use |
|---|---|---|
| `<InfoTip term="yield" />` | small (i) icon | After a metric label or chart title |
| `<Term term="pell-grant">Pell Grants</Term>` | dotted underline | Inline in sentences |
| `<MetricLabel term=…>Label</MetricLabel>` | label + (i) | Standard metric heading |

Built on base-ui **Popover** with `openOnHover`, so it works on hover and keyboard focus (desktop) and on tap
(touch), unlike tooltips. Each pop-over links to `/glossary#<key>`. The trigger's hit area extends past the icon.

## Glossary page (`/glossary`)
- Client-side search across terms and definitions.
- Category nav (sticky sidebar on desktop, horizontal chips on mobile).
- Each entry is an anchor (`id=<key>`) that flashes lime when targeted.
- "Related" chips jump between entries.

## Metric registry link
`lib/metrics.ts → METRICS[key].term` maps every metric to its glossary entry, so charts and compare rows get
the right info icon automatically.
