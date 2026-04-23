# Story 2-1: Learn Home Page — Empty & Active States

## Status: ready-for-dev

## Epic
Epic 2: Learn Navigation & Course Management

## Story
As a user,
I want a Learn home page showing all my courses,
So that I can quickly access any course or start a new one.

## Acceptance Criteria

**AC1: Empty State**
Given the user navigates to `/app/learn/`
When no courses exist for the user
Then the empty state hero is shown with:
- A "What do you want to learn?" topic input field
- A "Create from your folders" link that navigates to `/app/learn/create`
- Visually centered, inviting layout consistent with the app's dark theme

**AC2: Active State — Course Grid**
Given the user navigates to `/app/learn/`
When courses exist for the user
Then a grid of course cards is displayed showing:
- Course title
- Progress bar (completedSectionCount / totalSectionCount as percentage)
- Section count label (e.g., "5 sections")
- Pace badge (relaxed / steady / intensive)
- Click navigates to `/app/learn/[courseId]`

**AC3: Create Course CTA**
Given the user is on the Learn home page
When courses exist (active state)
Then a dashed "+ Create Course" card appears at the end of the grid
And clicking it navigates to `/app/learn/create`

**AC4: Streak Display**
Given the user is on the Learn home page
When the user's learnProfile.streakCurrent > 0
Then a streak display shows in the header area with flame icon and day count
And if streakFreezeUsedAt is recent, a frost indicator replaces the flame

**AC5: Mobile Responsiveness**
Given the user views the Learn home page on mobile
When the page renders
Then cards stack in a single column layout
And the page remains usable with bottom navigation

## Tasks

### Task 1: Create learnProfile query
- Add `getProfile` query to a new `convex/learnProfile.ts` (or in `convex/courses.ts`)
- Query `learnProfile` by userId, return streak and profile data
- Return null if no profile exists yet (user hasn't started any course)

### Task 2: Create Learn Home page component
- Create `/app/pages/app/learn/index.vue`
- Use `useConvexQuery(api.courses.listByUser)` for course list
- Use learnProfile query for streak data
- SSR guard: wrap reactive queries with `import.meta.client` check
- Render empty state or active state based on course list length

### Task 3: Build CourseCard component
- Create `/app/components/learn/CourseCard.vue`
- Props: course object (from `courses.listByUser`)
- Display: title, progress bar, section count, pace badge
- Progress bar: `(completedSectionCount / totalSectionCount) * 100`, handle 0/0 as 0%
- Pace badge: color-coded (relaxed=green, steady=amber, intensive=red)
- Click: `navigateTo('/app/learn/' + course._id)`

### Task 4: Build CreateCourseCard component
- Create `/app/components/learn/CreateCourseCard.vue`
- Dashed border card with "+" icon and "Create Course" text
- Click: `navigateTo('/app/learn/create')`

### Task 5: Build StreakDisplay component
- Create `/app/components/learn/StreakDisplay.vue`
- Props: streakCurrent (number), streakFreezeUsedAt (string | undefined)
- Flame icon (amber) when active, frost icon when freeze used recently
- Only renders when streakCurrent > 0

### Task 6: Build empty state
- Inside the Learn home page, render hero section when no courses
- Topic input field (visual only for now — typing + Enter navigates to `/app/learn/create?topic={input}`)
- "Create from your folders" link below → `/app/learn/create`

### Task 7: Write component tests
- Test CourseCard renders title, progress, section count, pace badge
- Test CreateCourseCard renders and emits navigation
- Test StreakDisplay renders/hides based on streak value
- Test Learn home page empty state vs active state
- Use `@nuxt/test-utils` with `mountSuspended`

## Technical Notes

### Existing infrastructure
- `api.courses.listByUser` — returns all courses for the authenticated user, ordered desc
- `api.courses.get` — single course by ID
- `learnProfile` table has `streakCurrent`, `streakLastDate`, `streakFreezeAvailable`, `streakFreezeUsedAt`, `dailyReviewCap`
- Course schema includes `completedSectionCount`, `totalSectionCount`, `pace`, `title`, `status`
- Existing placeholder at `/app/pages/app/learn/[courseId].vue` — do not modify

### Design tokens (from app theme)
- Dark background: stone-950
- Card surface: stone-900 border stone-800
- Accent: amber-500
- Text primary: stone-100, secondary: stone-400
- Radius: rounded-xl for cards

### Dependencies
- No new npm packages needed
- Lucide icons for flame/snowflake (already available via nuxt-icon or lucide-vue-next)
