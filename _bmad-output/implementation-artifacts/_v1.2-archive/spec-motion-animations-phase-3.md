---
title: 'Phase 3 Motion Animations — Delight'
type: 'feature'
created: '2026-04-19'
status: 'ready-for-dev'
context:
  - '_bmad-output/implementation-artifacts/animation-plan.md'
---

<frozen-after-approval>

## Intent

**Problem:** The app's loading skeletons use a flat `animate-pulse` that looks generic, the login page appears instantly with no entrance polish, the PWA install prompt pops in without motion, and empty states feel static. These are the "last mile" delight touches.

**Approach:** Replace the global Skeleton shimmer, add a staggered login entrance sequence, spring-animate the PWA install prompt, and add a CSS-based floating idle animation to empty states. Keep scope tight — no canvas particles or complex drag physics.

## Boundaries & Constraints

**Always:**
- Respect `prefers-reduced-motion` — shimmer degrades to pulse, springs disabled
- CSS-only where JS is unnecessary (shimmer, floating idle)
- Keep Skeleton component API unchanged — consumers should not need updates

**Ask First:**
- Adding new CSS keyframe animations beyond shimmer + float

**Never:**
- Canvas-based particle effects (Phase 4+)
- Modify drag/snap physics on mini player
- Touch existing Motion-wrapped components from Phase 1/2

</frozen-after-approval>

## Code Map

- `app/components/ui/skeleton/Skeleton.vue` -- replace animate-pulse with shimmer sweep
- `app/assets/css/tailwind.css` -- add @keyframes shimmer + floating-idle
- `app/pages/login.vue` -- staggered entrance (heading → card → button → footer)
- `app/components/global/InstallAppPrompt.vue` -- Motion spring entrance on prompt section
- `app/pages/app/chat.vue` -- sparkle icon rotation on empty state

## Tasks & Acceptance

**Execution:**
- [ ] `app/assets/css/tailwind.css` -- add `@keyframes shimmer` (gradient sweep) and `@keyframes float-idle` (2px translateY oscillation, 4s)
- [ ] `app/components/ui/skeleton/Skeleton.vue` -- replace `animate-pulse` with shimmer animation class
- [ ] `app/pages/login.vue` -- wrap heading, button, and footer in Motion with staggered delays (0, 0.08, 0.16s)
- [ ] `app/components/global/InstallAppPrompt.vue` -- wrap prompt section in Motion with spring slide-up entrance
- [ ] `app/pages/app/chat.vue` -- add CSS spin-slow class to sparkles icon for gentle rotation

**Acceptance Criteria:**
- Given any skeleton loader renders, when visible, then it shows a left-to-right gradient shimmer (not flat pulse)
- Given the login page loads, when elements mount, then heading appears first, button second, footer last — visibly staggered
- Given the PWA install prompt becomes visible, when it renders, then it slides up from below with spring overshoot
- Given `prefers-reduced-motion` is active, then shimmer falls back to flat pulse and springs are instant

## Verification

**Commands:**
- `pnpm build` -- expected: passes
- `pnpm test` -- expected: existing tests pass

**Manual checks:**
- Load any page with skeletons (dashboard, folder) — shimmer sweep visible
- Visit /login — staggered entrance visible
- Trigger PWA install prompt — slides up with bounce
- Enable reduced motion — shimmer reverts to pulse, no springs
