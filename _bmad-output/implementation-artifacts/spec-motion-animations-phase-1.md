---
title: 'Phase 1 Motion Animations'
type: 'feature'
created: '2026-04-18'
status: 'ready-for-dev'
context:
  - '_bmad-output/implementation-artifacts/animation-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app has zero JavaScript-driven animations — no page transitions, no spring physics, no staggered entrances. Every interaction feels static and instant, missing the polish that makes study tools feel alive and responsive.

**Approach:** Install `motion-v` (with its Nuxt module for auto-imports), build shared spring presets and a reduced-motion composable, then add animations to the 6 highest-impact areas: page transitions, flashcard flip, dashboard entrance, folder tab indicator, chat messages, and mini player.

## Boundaries & Constraints

**Always:**
- Respect `prefers-reduced-motion` — disable springs/staggers, use instant transitions
- Animate only `transform` and `opacity` (no layout-thrashing properties like `width`, `height`, `top`, `left`)
- Keep all existing keyboard accessibility (flashcard Space/Enter flip, arrow nav)
- Client-only — wrap Motion components in `<ClientOnly>` or use `.client` plugin where needed

**Ask First:**
- Adding any new runtime dependency beyond `motion-v`
- Changing the flashcard flip CSS class structure if it breaks existing component tests

**Never:**
- Remove or alter existing functionality — animations are additive only
- Add animations to server-rendered content (SSR hydration mismatch risk)
- Block user interaction during any animation (no pointer-events:none during transitions)

</frozen-after-approval>

## Code Map

- `package.json` -- add `motion-v` as direct dependency
- `nuxt.config.ts` -- register `motion-v/nuxt` module
- `app/composables/useMotionPresets.ts` -- NEW: shared spring configs, stagger helper, reduced-motion flag
- `app/app.vue` -- add Nuxt `pageTransition` with fade+slide
- `app/pages/index.vue` -- dashboard: wrap greeting, action cards, carousel in Motion stagger
- `app/components/dashboard/Greeting.vue` -- fade-slide entrance
- `app/components/dashboard/ActionCard.vue` -- spring entrance via parent stagger index
- `app/components/dashboard/CourseCard.vue` -- spring entrance via parent stagger index
- `app/components/dashboard/CoursesCarousel.vue` -- stagger children on mount
- `app/components/flashcards/RoomPractice.vue` -- replace CSS transition with Motion spring flip + card-deal slide
- `app/components/chat/Message.vue` -- slide+fade entrance (right for user, left for assistant)
- `app/components/chat/ThinkingRow.vue` -- replace animate-pulse with Motion staggered bounce
- `app/components/audio-overview/StickyMiniPlayer.vue` -- spring appear/dismiss, enhance expand/collapse morph
- `app/components/folder-shell/FolderShellRailItem.vue` -- active indicator slide (layout animation)

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` + `nuxt.config.ts` -- install motion-v, register nuxt module
- [ ] `app/composables/useMotionPresets.ts` -- create shared presets: `springSnappy`, `springGentle`, `staggerDelay(index)`, `useReducedMotion()`
- [ ] `app/app.vue` -- add `pageTransition` with `mode: 'out-in'`, fade+translateY via Motion
- [ ] `app/pages/index.vue` + dashboard components -- wrap action cards + carousel items in `<Motion>` with staggered entrance
- [ ] `app/components/flashcards/RoomPractice.vue` -- replace CSS `transition: transform 400ms` with Motion spring `rotateY`, add card-deal slide on index change
- [ ] `app/components/chat/Message.vue` -- wrap message div in `<Motion>` with role-based slide direction
- [ ] `app/components/chat/ThinkingRow.vue` -- replace `animate-pulse` dots with Motion staggered scale bounce
- [ ] `app/components/audio-overview/StickyMiniPlayer.vue` -- replace Vue `<Transition>` with Motion `<AnimatePresence>` + spring enter/exit
- [ ] `app/components/folder-shell/FolderShellRailItem.vue` -- add Motion layout animation to active indicator

**Acceptance Criteria:**
- Given a route change, when navigating forward, then page content fades out and slides up, new page fades in and slides down (reversed for back navigation)
- Given a flashcard in practice mode, when user clicks/presses Space, then card flips via 3D rotateY with spring physics (not linear CSS)
- Given the dashboard loads, when courses and action cards mount, then they appear in sequence with visible stagger (not all at once)
- Given a chat message arrives, when it renders, then it slides in from the appropriate side with spring easing
- Given the mini player becomes visible, when it mounts, then it springs up from below with overshoot
- Given `prefers-reduced-motion: reduce` is active, when any animation would play, then it completes instantly with no spring/delay

## Verification

**Commands:**
- `pnpm lint` -- expected: passes with no new warnings
- `pnpm typecheck` -- expected: no type errors
- `pnpm test` -- expected: existing tests pass (no behavior change)
- `pnpm test:component` -- expected: existing component tests pass
- `pnpm build` -- expected: production build succeeds

**Manual checks:**
- Navigate between pages — transitions visible, no flash of unstyled content
- Flip flashcards — spring bounce visible, keyboard still works
- Load dashboard — cards stagger in visually
- Send chat message — slides in smoothly
- Play audio then navigate away — mini player springs up
- Enable "reduce motion" in OS settings — all animations instant
