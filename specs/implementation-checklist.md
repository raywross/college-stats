# Implementation Checklist

Step-by-step build order for the MVP. Each step should result in something runnable.

## Phase 0: Project Setup
- [ ] Scaffold Next.js project with TypeScript, Tailwind, ESLint
- [ ] Install and configure shadcn/ui
- [ ] Install Recharts
- [ ] Set up project structure (folders for components, lib, data)
- [ ] Create `lib/types.ts` with TypeScript interfaces

## Phase 1: Sample Data + Data Layer
- [ ] Create `data/sample-schools.json` with ~20 realistic schools
- [ ] Implement `lib/data.ts` with getSchools, getSchoolById, getSchoolsByIds
- [ ] Verify data loads correctly with a test page

## Phase 2: Layout + Navigation
- [ ] Create root layout with Header component
- [ ] Add navigation: Home, Compare
- [ ] Basic responsive layout with Tailwind

## Phase 3: Home Page - Search + Filter + Results
- [ ] Build SearchBar component (text input, debounced)
- [ ] Build FilterPanel component (acceptance rate slider, state dropdown)
- [ ] Build SchoolCard component
- [ ] Wire up URL-based filtering on home page
- [ ] Add sort controls
- [ ] Add "Add to Compare" button on cards

## Phase 4: School Detail Page
- [ ] Build school profile page layout
- [ ] Build ScoreRangeBar chart component (middle-50% visualization)
- [ ] Build DemographicsChart component
- [ ] Add test submission rate indicator
- [ ] Add Pell Grant % and First-Gen % progress bars

## Phase 5: Comparison Page
- [ ] Build ComparisonTable component
- [ ] Build floating comparison bar (selected schools indicator)
- [ ] Wire up comparison via URL params + localStorage
- [ ] Add "Remove" ability from comparison

## Phase 6: Polish
- [ ] Responsive design pass (mobile, tablet, desktop)
- [ ] Loading states and empty states
- [ ] Color coding for acceptance rates
- [ ] Consistent typography and spacing
