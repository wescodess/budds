# Story 1.2: App Shell Layout with Responsive Navigation

Status: done

## Story

As a student,
I want a clean, navigable app shell with sidebar and study mode tabs,
So that I can move between my folders, chats, and study modes without confusion.

## Acceptance Criteria

1. **Given** an authenticated user on any `/app/**` route on desktop (>1024px)
   **When** the page loads
   **Then** a persistent sidebar (w-64) is visible on the left with sections for Folders and Recent Chats (empty state placeholders for now)
   **And** the main content area shows a horizontal tab bar with Chat, Flash Cards, Quiz, and Documents tabs (placeholder content)
   **And** a breadcrumb navigation is visible in the header area showing the current location
   **And** a skip-to-content link is the first focusable element for keyboard users

2. **Given** a user on mobile (<768px)
   **When** they view the app
   **Then** the sidebar is hidden by default
   **And** a menu button opens the sidebar as a Sheet overlay (slide-in from left)
   **And** the study mode tabs scroll horizontally
   **And** the breadcrumb shows the current folder name with a back arrow

3. **Given** a user on tablet (768-1024px)
   **When** they view the app
   **Then** the sidebar is visible and the main content fills the remaining width
   **And** no source panel is shown (inline citations only at this breakpoint)

4. **Given** any viewport
   **When** the user views the app
   **Then** the design token foundations are applied: Inter font with the defined type scale (14px body, 24px headings), semantic color tokens including Budds-specific additions (citation blue/teal, success green, warning amber, source highlight)
   **And** dark mode is the default theme
   **And** a light/dark mode toggle is accessible
   **And** all text meets 4.5:1 contrast ratio in both modes
   **And** semantic HTML landmarks are used (`<nav>`, `<main>`, `<aside>`)

5. **Given** the app shell is rendered
   **When** shadcn-nuxt primitives are needed
   **Then** Button, Tabs, Sheet, Separator, ScrollArea, Skeleton, Sidebar, Breadcrumb, DropdownMenu, and Tooltip components are scaffolded and available

## Tasks / Subtasks

- [x] Task 1: Scaffold required shadcn-nuxt components (AC: #5)
  - [x] Run `pnpm dlx shadcn-vue@latest add button tabs sheet separator scroll-area skeleton sidebar breadcrumb dropdown-menu tooltip badge card avatar` to generate all needed UI primitives
  - [x] Verify components are generated in `app/components/ui/` with `Ui` prefix

- [x] Task 2: Create app shell layout (AC: #1, #2, #3)
  - [x] Create `app/layouts/default.vue` — the app shell layout wrapping all `/app/**` pages
  - [x] Use `<UiSidebarProvider>` + `<UiSidebar>` as the structural foundation
  - [x] Sidebar contains two groups: "Folders" (empty state placeholder with folder icon + "No folders yet") and "Recent Chats" (empty state placeholder with message icon + "No recent chats")
  - [x] Main content area uses `<slot />` for page content
  - [x] Header area within main content shows breadcrumb + study mode tabs
  - [x] Sign-out button in sidebar footer using `signOut()` from `useUserSession()`
  - [x] User avatar display in sidebar footer using data from Convex `getUser` query

- [x] Task 3: Implement responsive sidebar behavior (AC: #1, #2, #3)
  - [x] Desktop (>1024px / `lg:`): sidebar persistent, visible, w-64
  - [x] Tablet (768-1024px / `md:`): sidebar persistent, visible
  - [x] Mobile (<768px): sidebar hidden by default, `<UiSidebarTrigger>` (hamburger menu button) opens sidebar as Sheet overlay from left
  - [x] Sheet closes on outside tap or explicit close
  - [x] Add skip-to-content link as first focusable element before sidebar

- [x] Task 4: Implement study mode tabs (AC: #1, #2)
  - [x] Add horizontal tab bar in main content header: Chat, Flash Cards, Quiz, Documents
  - [x] Use `<UiTabs>` component with `role="tablist"` and `role="tab"` attributes
  - [x] Each tab shows placeholder content ("Coming soon" for Flash Cards, Quiz, Documents)
  - [x] Chat tab renders the existing chat functionality (current `chat.vue` content)
  - [x] On mobile: tabs scroll horizontally when they overflow
  - [x] Active tab uses bottom border accent in `--primary` amber

- [x] Task 5: Implement breadcrumb navigation (AC: #1, #2)
  - [x] Use `<UiBreadcrumb>` component in the header area
  - [x] Show static breadcrumb for now: "Home" (links to `/app`)
  - [x] On mobile: show back arrow + current page name instead of full breadcrumb path
  - [x] Each breadcrumb segment will be clickable (wired to folder navigation in future stories)

- [x] Task 6: Add dark/light mode toggle (AC: #4)
  - [x] Use `useColorMode()` from VueUse (already installed `@vueuse/core@^14.2.1`)
  - [x] Add toggle button in sidebar header or footer area
  - [x] Dark mode is default — `.dark` class on `<html>` element
  - [x] Toggle switches between dark/light by adding/removing `.dark` class
  - [x] Existing CSS custom properties in `tailwind.css` already define both light and dark tokens via `@custom-variant dark (&:is(.dark *))` — no new token work needed
  - [x] Respect `prefers-color-scheme` for initial state if no user preference stored

- [x] Task 7: Refactor chat.vue to use layout (AC: #1)
  - [x] Remove `layout: false` from `app/pages/app/chat.vue`
  - [x] Remove the sign-out button, model selector header chrome from chat.vue (these move to the layout shell)
  - [x] Keep chat message list, input area, and source citation display
  - [x] Chat page becomes pure content rendered inside the layout's `<slot />`
  - [x] Ensure `useRag()` composable still works correctly within the new layout structure

- [x] Task 8: Apply design token foundations (AC: #4)
  - [x] Verify Inter and DM Sans fonts are loaded (already imported in `tailwind.css`)
  - [x] Apply type scale: 14px body (DM Sans 400), 24px page headings (DM Sans 700), 12px captions (Inter 500)
  - [x] Ensure `font-family` is set to DM Sans as primary with Inter for labels/meta
  - [x] Verify all semantic color tokens from DESIGN.md are in `tailwind.css`
  - [x] Add functional color tokens if missing: success (`#6ee7b7`), warning (`#fb923c`), citation badge amber, source highlight tint
  - [x] Confirm 4.5:1 contrast ratio: amber `#f59e0b` on `#1c1917` background = ~8.5:1 ✓, warm white `#fafaf9` on `#1c1917` = ~16:1 ✓

- [x] Task 9: Semantic HTML and accessibility (AC: #1, #4)
  - [x] Sidebar uses `<aside>` or appropriate landmark
  - [x] Main content area uses `<main>` element
  - [x] Navigation sections use `<nav>` elements
  - [x] Skip-to-content link: visually hidden, first focusable element, jumps to `<main>` content
  - [x] All interactive elements have visible focus indicators using `--ring` amber token
  - [x] Keyboard navigation: Tab key traverses all interactive elements in logical order
  - [x] `Escape` key closes Sheet sidebar on mobile
  - [x] Study mode tabs support arrow key navigation (built into Reka UI Tabs)

## Dev Notes

### Architecture Compliance

**Layout system:** Nuxt 4 layouts live in `app/layouts/`. Create `default.vue` as the app shell. Update `app/app.vue` to wrap `<NuxtPage />` with `<NuxtLayout>`. Pages under `/app/**` will automatically use the default layout. Login page and index page should use `definePageMeta({ layout: false })` to bypass the shell.

**Sidebar component:** Use the shadcn-vue `sidebar` component which provides `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarFooter`, `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarTrigger`. All prefixed with `Ui` per project config. The sidebar CSS tokens are already defined in `tailwind.css` (`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, etc.).

**No custom middleware or plugins needed for this story.** Route protection is already handled by `routeRules` in `nuxt.config.ts`. Auth composable is `useUserSession()` from `@onmax/nuxt-better-auth`.

**The "Void" concept from DESIGN.md:** The main content area is "the Void" — a full-screen dedicated workspace. Study mode tabs select which Void type is active (Chat, Flash Cards, Quiz, Documents). The tab content area should maximize available space — no unnecessary chrome or padding competing with content.

### Technical Requirements

- **shadcn component scaffolding:** Run `pnpm dlx shadcn-vue@latest add <components>`. Components land in `app/components/ui/` and auto-import with `Ui` prefix.
- **VueUse `useColorMode`:** Use `useColorMode()` for dark/light toggle. It manages the `.dark` class on `<html>` and persists preference to `localStorage`. Already installed via `@vueuse/core@^14.2.1`.
- **No Pinia/Vuex** — all state management via Vue composables. The sidebar's open/collapsed state is managed by `SidebarProvider`.
- **No `<style>` blocks** — Tailwind utility classes exclusively.
- **No manual Vue API imports** — Nuxt auto-imports `ref`, `computed`, `watch`, etc.
- **`$fetch` for API calls** — never raw `fetch` or `axios`.

### File Structure

Files to create:
- `app/layouts/default.vue` — App shell layout with sidebar, header, tabs, breadcrumb
- (shadcn components auto-generated in `app/components/ui/` via CLI)

Files to modify:
- `app/app.vue` — Wrap `<NuxtPage />` with `<NuxtLayout>`
- `app/pages/app/chat.vue` — Remove `layout: false`, extract header chrome to layout, keep chat content only
- `app/pages/login.vue` — Add `definePageMeta({ layout: false })` to bypass app shell
- `app/pages/index.vue` — Add `definePageMeta({ layout: false })` to bypass app shell
- `app/assets/css/tailwind.css` — Add any missing functional color tokens (success, warning) if not present

Files to NOT modify:
- `nuxt.config.ts` — Route rules are already correct, shadcn config is already correct
- `convex/*` — No backend changes needed
- `server/*` — No API changes needed
- `app/composables/useRag.ts` — Should work as-is within the new layout
- `app/plugins/convex-auth.client.ts` — No changes needed

### Previous Story (1-1) Intelligence

**What was established:**
- Better Auth + Google OAuth is working with Convex JWT bridge
- `useUserSession()` is the auth composable — provides `loggedIn`, `signOut()`, user data
- Sign-out button exists in `chat.vue` header — must be moved to sidebar footer during refactor
- Model selector dropdown exists in `chat.vue` header — keep it in chat content area (it's chat-specific, not shell chrome)
- `routeRules` handle auth: `/app/**` = authenticated, `/login` = guest. The `/app` route redirects to `/app/chat`
- Convex `getUser` query can retrieve user name/email/avatarUrl for sidebar display

**Review findings to carry forward:**
- `nuxt.config.ts` has `auth.redirects.logout: '/login'` — sign-out redirect works
- No custom middleware needed — `routeRules` handle everything
- `convex-auth.client.ts` plugin handles Convex token lifecycle automatically

### Responsive Breakpoints

| Breakpoint | Tailwind | Layout |
|---|---|---|
| < 768px | Default (mobile-first) | Single column, Sheet sidebar, horizontal scroll tabs |
| 768-1024px | `md:` | Two-panel: sidebar + main content |
| > 1024px | `lg:` | Full layout: sidebar (w-64) + main content (+ future source panel) |

### Sidebar Styling (from DESIGN.md)

- **Active item:** 2px left border in `--primary` amber + `rgba(245, 158, 11, 0.08)` background tint
- **Inactive item:** Muted text (`--muted-foreground`) + icon, no background
- **Hover:** Slight warm background tint `rgba(250, 250, 249, 0.05)`
- **Sidebar background:** `--sidebar` (#1c1917) — matches page background, no contrast drawer
- Sidebar item padding: `py-2 px-3`
- No drop shadows on sidebar — use `--sidebar-border` for edge definition

### Component Hierarchy

```
app.vue
└── NuxtLayout (default.vue)
    ├── skip-to-content link
    ├── UiSidebarProvider
    │   ├── UiSidebar (aside)
    │   │   ├── UiSidebarHeader
    │   │   │   └── App logo / name + dark mode toggle
    │   │   ├── UiSidebarContent
    │   │   │   ├── UiSidebarGroup: "Folders"
    │   │   │   │   └── Empty state placeholder
    │   │   │   └── UiSidebarGroup: "Recent Chats"
    │   │   │       └── Empty state placeholder
    │   │   └── UiSidebarFooter
    │   │       └── User avatar + name + sign-out button
    │   └── main
    │       ├── header
    │       │   ├── UiSidebarTrigger (mobile menu button)
    │       │   ├── UiBreadcrumb
    │       │   └── UiTabs (study mode tabs)
    │       └── tab content area
    │           └── slot (page content / NuxtPage)
    └── (Sheet overlay for mobile sidebar — handled by SidebarProvider)
```

### Critical Anti-Patterns to Avoid

- Do NOT manually import Vue APIs — auto-imports active
- Do NOT create custom auth middleware — `routeRules` handle auth
- Do NOT use `<style>` blocks — Tailwind utility classes only
- Do NOT add Pinia or Vuex — composables only
- Do NOT create a `types/` directory — co-locate interfaces
- Do NOT create barrel files (index.ts) — Nuxt auto-imports
- Do NOT add `npm` or `yarn` commands — `pnpm` only
- Do NOT modify `nuxt.config.ts` route rules unless absolutely necessary
- Do NOT put model selector in layout — it's chat-specific (keep in chat.vue)
- Do NOT create persistent panels competing with the Void for attention

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1, Story 1.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Frontend Architecture, Component Architecture]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — App Shell Layout, Responsive Design, Sidebar Behavior, Accessibility]
- [Source: _bmad-output/project-context.md — Framework-Specific Rules, Code Quality Rules]
- [Source: DESIGN.md — Colors, Typography, Spacing & Layout, Component Patterns, Sidebar Navigation]
- [Source: _bmad-output/implementation-artifacts/1-1-verify-and-harden-authentication-flow.md — Dev Notes, Review Findings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build fails with pre-existing `@convex-vue/core` resolution error in `nuxt-convex` module (not introduced by this story)
- shadcn-vue CLI defaults to npm despite pnpm lockfile — workaround: `NPM_CONFIG_LEGACY_PEER_DEPS=true`

### Completion Notes List

- Scaffolded 94 shadcn-vue component files across 14 UI primitive directories (button, tabs, sheet, separator, scroll-area, skeleton, sidebar, breadcrumb, dropdown-menu, tooltip, badge, card, avatar, input)
- Created `app/layouts/default.vue` as the app shell with UiSidebarProvider + UiSidebar + UiSidebarInset architecture
- Sidebar has Folders and Recent Chats groups with empty state placeholders, user avatar + name + sign-out in footer, dark/light toggle in header
- Responsive behavior: sidebar hidden on mobile with Sheet overlay via UiSidebarTrigger, persistent on md+ breakpoints
- Study mode tabs (Chat, Flash Cards, Quiz, Documents) with amber bottom border active indicator, horizontal scroll on mobile
- Breadcrumb with "Home" link to /app, mobile variant with back arrow
- Dark/light mode toggle using VueUse useColorMode with dark as default, persists to localStorage
- Refactored chat.vue: removed layout: false, sign-out button, and header chrome; kept model selector (chat-specific), messages, input, sources; updated to use semantic design tokens
- Added layout: false to login.vue and index.vue to bypass app shell
- Added DM Sans as primary font-family on body, Inter utility class, functional color tokens (success, warning)
- Skip-to-content link as first focusable element, UiSidebarInset renders as <main>, UiBreadcrumb renders as <nav>, focus indicators use amber ring token
- Model selector kept in chat.vue per story specification (chat-specific, not shell chrome)

### Review Findings

- [x] [Review][Decision] Font primary mismatch: DM Sans (implemented per Task 8 / DESIGN.md) vs Inter (AC #4 text) — resolved: keep DM Sans per DESIGN.md, AC text is a spec documentation bug
- [x] [Review][Patch] MediaQueryList listener never cleaned up — memory leak [default.vue:34-39] — fixed: replaced with `useMediaQuery` from VueUse
- [x] [Review][Patch] SidebarProvider reads `document.cookie` at prop default evaluation time — SSR hydration mismatch [SidebarProvider.vue:14] — fixed: uses Nuxt's `useCookie` for SSR-safe reads
- [x] [Review][Patch] SidebarTrigger hidden on md+ — no desktop re-open affordance after Ctrl+B collapse [default.vue:147] — fixed: removed `md:hidden`
- [x] [Review][Patch] Citation blue/teal and source highlight color tokens missing from tailwind.css [tailwind.css] — fixed: added `--citation-blue`, `--citation-teal`, `--source-highlight` tokens
- [x] [Review][Patch] Sidebar renders as `<div>` not `<aside>` — missing semantic landmark [Sidebar.vue] — fixed: changed to `<aside>` elements
- [x] [Review][Patch] Google Fonts import has no preconnect hint — render-blocking external request [tailwind.css:1] — fixed: added `useHead` preconnect in layout
- [x] [Review][Defer] `activeTab` ref decoupled from router — by design for story 1.2 (placeholder tabs)
- [x] [Review][Defer] `<slot />` only in chat TabsContent — correct for now, refactor when other study modes are implemented
- [x] [Review][Defer] Model identifier sent to backend without validation — pre-existing in chat.vue
- [x] [Review][Defer] `source.score * 100` assumes 0-1 range — pre-existing in chat.vue
- [x] [Review][Defer] `useRag` doesn't validate response shape — pre-existing composable
- [x] [Review][Defer] Scroll-after-send fires even on error — pre-existing chat.vue behavior

### Change Log

- 2026-04-10: Initial implementation of all 9 tasks for Story 1.2

### File List

New files:
- app/layouts/default.vue
- app/components/ui/button/Button.vue (+ index.ts)
- app/components/ui/tabs/Tabs.vue, TabsContent.vue, TabsList.vue, TabsTrigger.vue (+ index.ts)
- app/components/ui/sheet/Sheet.vue, SheetClose.vue, SheetContent.vue, SheetDescription.vue, SheetFooter.vue, SheetHeader.vue, SheetOverlay.vue, SheetTitle.vue, SheetTrigger.vue (+ index.ts)
- app/components/ui/separator/Separator.vue (+ index.ts)
- app/components/ui/scroll-area/ScrollArea.vue, ScrollBar.vue (+ index.ts)
- app/components/ui/skeleton/Skeleton.vue (+ index.ts)
- app/components/ui/sidebar/Sidebar.vue, SidebarContent.vue, SidebarFooter.vue, SidebarGroup.vue, SidebarGroupAction.vue, SidebarGroupContent.vue, SidebarGroupLabel.vue, SidebarHeader.vue, SidebarInput.vue, SidebarInset.vue, SidebarMenu.vue, SidebarMenuAction.vue, SidebarMenuBadge.vue, SidebarMenuButton.vue, SidebarMenuButtonChild.vue, SidebarMenuItem.vue, SidebarMenuSkeleton.vue, SidebarMenuSub.vue, SidebarMenuSubButton.vue, SidebarMenuSubItem.vue, SidebarProvider.vue, SidebarRail.vue, SidebarSeparator.vue, SidebarTrigger.vue (+ index.ts, utils.ts)
- app/components/ui/breadcrumb/Breadcrumb.vue, BreadcrumbEllipsis.vue, BreadcrumbItem.vue, BreadcrumbLink.vue, BreadcrumbList.vue, BreadcrumbPage.vue, BreadcrumbSeparator.vue (+ index.ts)
- app/components/ui/dropdown-menu/DropdownMenu.vue, DropdownMenuCheckboxItem.vue, DropdownMenuContent.vue, DropdownMenuGroup.vue, DropdownMenuItem.vue, DropdownMenuLabel.vue, DropdownMenuRadioGroup.vue, DropdownMenuRadioItem.vue, DropdownMenuSeparator.vue, DropdownMenuShortcut.vue, DropdownMenuSub.vue, DropdownMenuSubContent.vue, DropdownMenuSubTrigger.vue, DropdownMenuTrigger.vue (+ index.ts)
- app/components/ui/tooltip/Tooltip.vue, TooltipContent.vue, TooltipProvider.vue, TooltipTrigger.vue (+ index.ts)
- app/components/ui/badge/Badge.vue (+ index.ts)
- app/components/ui/card/Card.vue, CardAction.vue, CardContent.vue, CardDescription.vue, CardFooter.vue, CardHeader.vue, CardTitle.vue (+ index.ts)
- app/components/ui/avatar/Avatar.vue, AvatarFallback.vue, AvatarImage.vue (+ index.ts)
- app/components/ui/input/Input.vue (+ index.ts)

Modified files:
- app/app.vue — wrapped NuxtPage with NuxtLayout
- app/pages/app/chat.vue — removed layout: false, sign-out button, header chrome; kept model selector and chat content; updated to semantic design tokens
- app/pages/login.vue — added layout: false to definePageMeta
- app/pages/index.vue — added script setup with definePageMeta({ layout: false })
- app/assets/css/tailwind.css — added DM Sans font-family on body, font utility classes, success/warning color tokens
