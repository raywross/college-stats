# Part 2, The Major Picker

> Status: **built** 2026-10-16 (PR #165). A step of [steps.md](steps.md) (step 8) and the overview's Major row. Part 2 of
> [Your record](README.md). The owner: "Choosing a major goes in the guided section, it should be another section. The way
> it's entered should work the way the other entry works: you type and there are a few common choices you can click. You
> should be able to choose more than one."

## The step
```
What might you study?
Up to three. Undecided is fine; leave it blank.

[ Type a major or a subject…                                    ]
Common:  Business   Engineering   Biology   Computer science   Psychology   Nursing and health   Arts   Social sciences

Picked:  ✕ Engineering (first choice)   ✕ Computer science
         drag or use the arrows to put your first choice first
```
- **Typing** matches the 38 major families (`MAJOR_FAMILIES`, lib/majors.ts) by name and by **alias**: a small table
  `MAJOR_ALIASES` in `lib/majors-search.ts` ("pre-med", "premed", "medicine" → Biology and Health professions; "nursing"
  → Health professions; "cs", "coding", "software" → Computer science; "finance", "accounting", "marketing" → Business;
  "pre-law" → Law and legal studies and Social sciences; "physics", "chemistry" → Physical sciences; "art", "music",
  "theater", "film" → Visual and performing arts; "econ", "economics", "political science", "poli sci", "sociology" →
  Social sciences; "kinesiology", "sports medicine" → Parks, recreation, and kinesiology; "architecture" → Architecture;
  "data science", "statistics" → Math and statistics; "environmental" → Natural resources; "journalism" → Communication
  and journalism; "teaching" → Education; "criminal justice" → Criminal justice and protective services; "nutrition" →
  Family and consumer sciences; and the family names' own words). The result list shows the family name with the alias
  that matched in muted text ("Health professions · nursing"). `searchMajors(query, exclude, limit = 6)` mirrors
  `searchAp`.
- **Common picks** before anything is typed: the eight families most students pick (`POPULAR_MAJORS`, in that order:
  Business, Engineering, Biology, Computer science, Psychology, Health professions, Visual and performing arts, Social
  sciences), as chips; a picked one leaves the row.
- **Picked**: up to `MAX_INTENDED_MAJORS` (3), the first is "first choice" (the estimate's major reading and the list
  guide's likeness fact read the first); arrows (and drag where cheap) reorder; ✕ removes. At three the search disables
  with "Three is the most; remove one to add another."
- **Nothing picked** is fine ("Undecided is fine"); the Review row reads "Undecided".
- Stored as `plans.intendedMajors: MajorFamily[]` (built, ordered). The overview's Major row reads the names joined.

## Rules
- Family names come from `MAJOR_FAMILIES` so the Explore filter, the estimate's notes, and the picker agree.
- No "popularity" number shows; the common chips are a fixed, ordered list.
- Telemetry: `record_major_picked { count }` (never the major).

## Files
`lib/majors-search.ts` (pure: `MAJOR_ALIASES`, `POPULAR_MAJORS`, `searchMajors`), `components/planner/intake/MajorStep.tsx`,
`components/planner/intake/MajorChips.tsx` (the picked list with reorder), the intake draft's `majors: MajorFamily[]`.
Tests: `tests/majors-search.test.mts` (aliases, exclusion, the cap, name matches, every alias resolves to a real family).

## As built by R2
- Eight popular majors as chips before any typing; a pick removes it from the common set
- Search input with six results, alias matches shown in muted text
- Up to three majors picked with "First choice" label, arrow reorder, and ✕ remove
- Native HTML5 drag-and-drop on the picked list, with no touch-drag fallback (arrows cover phones)
- `record_major_picked { count }` fired on every pick, never on reorder or remove
