---
title: 'Motion Animations — Deep Dive Plan'
type: 'plan'
status: 'proposed'
owner: 'wesleyukadike@gmail.com'
created: '2026-04-18'
library: 'motion-v (Vue wrapper for Motion)'
---

## Context

The app currently relies entirely on CSS-based animations via `tw-animate-css` (Tailwind plugin). `motion-v` is installed in `node_modules` but completely unused. There are no page transitions, no spring physics, no staggered entrances, no gesture-driven animations. This plan identifies every animation opportunity across the app and prescribes the right Motion pattern for each.

## Current Animation State

- **Tailwind:** `animate-spin`, `animate-pulse`, hover color/bg transitions
- **Vue `<Transition>`:** Used only in StickyMiniPlayer expand/collapse
- **CSS:** Scrollbar transitions, button hover states, sidebar collapse (Shadcn defaults)
- **Motion-v:** Installed, zero usage
- **Missing entirely:** Page transitions, staggered lists, spring physics, 3D transforms, gesture feedback, scroll-linked effects, layout animations

---

## Phase 1 — High Impact (do first)

### 1.1 Page Transitions

**Where:** Every route change (Nuxt page transitions)
**Animation:** Directional cross-fade — pages fade + slide in navigation direction (forward = slide left, back = slide right). 200ms with ease-out.
**Implementation:** Nuxt `pageTransition` config + Motion `<AnimatePresence>` wrapper in `app.vue`.

### 1.2 Flashcard 3D Flip

**Where:** `FlashcardsRoomPractice.vue` — card flip between front/back
**Animation:** Full 3D `rotateY(180deg)` with spring physics. Front face fades as back appears mid-rotation. Slight perspective tilt. This is THE signature animation for flashcards.
**Extras:**
- Card deal: new card slides in from right, previous slides out left (deck dealing)
- Correct: green border flash + subtle confetti particles
- Incorrect: red flash + horizontal shake (3 oscillations, 4px amplitude)

### 1.3 Dashboard Staggered Card Entrance

**Where:** `app/pages/app/index.vue` — action cards, course carousel
**Animation:**
- Greeting text: words slide up with opacity, staggered per word
- Action cards: enter one by one from bottom with spring easing, 50ms stagger
- Course carousel: cards slide in from right edge with stagger
- Ask bar: scales from width 0 to full with spring, cursor blinks in at end
**Motion pattern:** `<Motion>` with `initial`, `animate`, `transition: { delay: index * 0.05, type: 'spring' }`

### 1.4 Tab Sliding Indicator

**Where:** Folder workspace tabs (Chat, Flashcards, Quiz, Audio Overview, Documents), all tab groups
**Animation:** Active tab underline/background slides smoothly to the selected tab using layout animation. Content cross-fades with directional slide (left tab = from left, right tab = from right).
**Motion pattern:** Layout animation on the indicator element.

### 1.5 Chat Message Entrance

**Where:** `ChatMessage.vue` — both user and assistant messages
**Animation:**
- User messages: slide in from right with spring + fade
- Assistant messages: slide in from left with spring + fade
- Citation badges: scale from 0→1 with spring overshoot on first appear
- Thinking row: three dots with staggered scale (breathing pattern)
**Duration:** 150ms per message, spring stiffness ~300

### 1.6 Mini Player Spring Appear/Morph

**Where:** `StickyMiniPlayer.vue`
**Animation:**
- Appear: springs up from bottom with overshoot
- Expand/Collapse: morphs between pill and full controls with spring physics, content cross-fades
- Close: shrinks to a point and fades out
- Drag: magnetic snap to screen edges/corners with spring
**Motion pattern:** `useSpring` for position, `<AnimatePresence>` for mount/unmount.

---

## Phase 2 — Polish

### 2.1 Audio Player Host Glow Enhancement

**Where:** `AudioOverviewPlayer.vue` — speaker glow rings
**Animation:** Enhance existing CSS glow with spring-based magnitude mapping. Rings pulse smoothly with audio amplitude using `useSpring`. Play/pause icon morphs via SVG path animation.
**Extras:**
- Quote display: typewriter effect (characters appear one by one as spoken)
- Speed selector: spring dropdown with item stagger
- History dropdown: items stagger in from top

### 2.2 Quiz Answer Validation

**Where:** Quiz question components (`Question.vue`, input components)
**Animation:**
- Answer selection (MC): selected option scales slightly + glowing border, unselected dims
- Correct: SVG checkmark draws itself with stroke animation + green glow
- Incorrect: SVG X draws with shake
- True/False: selected state morphs with background fill spreading from center
- Progress bar: segmented fill with spring per segment
- Results reveal: score counts up from 0 with spring, percentage ring fills. Score >80% triggers subtle confetti
- Question transition (sequential): slides in from right, previous from left, spring easing

### 2.3 Sidebar Collapse Spring

**Where:** `UiSidebar` in default layout
**Animation:**
- Collapse/expand: width animates with spring, items crossfade between full and icon-only. Icons slide to center as text fades
- Folder tree expand: chevron rotates 90deg with spring, children slide down with height + stagger
- Folder hover: background slides in from left (not instant appear)
- Active folder: indicator morphs/slides to selected folder
- New folder: slides in from left with spring, pushes others down
- Theme toggle: sun/moon morph (rotation + scale) with brief color flash
- User menu: springs open from avatar point, items stagger in
- Breadcrumb update: text slides out upward, new slides in from below

### 2.4 Panel Flip 3D Animation

**Where:** Folder workspace desktop — pane flip button
**Animation:** Panels do a subtle 3D rotation (`rotateY`) as they swap positions, ~400ms with spring. Left panel rotates out while right rotates in.
**Extras:**
- Resize handle: glow/color change on hover, slight width expansion
- Resize drag: shrinking panel goes to 0.95 opacity, growing to 1.0

### 2.5 Dialog/Sheet Spring Animations

**Where:** All `UiDialog`, `UiSheet`, `UiDrawer` components
**Animation:**
- Dialogs: scale from 0.95→1.0 with spring + backdrop blur transition (replace CSS animation)
- Sheets: spring slide from bottom/right with overshoot, velocity-aware dismiss
- Drawers: spring slide with content stagger after settle
**Motion pattern:** Override Shadcn default transitions with Motion springs.

### 2.6 Source Panel Citation Glow

**Where:** `ChatSourcePanel.vue`, `ChatSourceCard.vue`
**Animation:**
- Panel open: slides in from side with slight scale, content staggers after settle
- Source cards: stagger in from top to bottom, 30ms delays
- Citation click: corresponding source card gets glow border pulse + auto-scroll into view
- Panel close: content fades first, then panel slides out

---

## Phase 3 — Delight

### 3.1 Login Page Sequence

**Where:** `/login`
**Animation:**
- Staggered reveal: logo fades + scales in first → card slides up from bottom with spring → Google button fades in last
- Google button hover: magnetic hover (2-3px cursor follow) + scale(1.02) + shadow lift
- Background: slow-moving radial gradient shift
- Card: very slow translateY oscillation (2px up/down, 4s cycle) — floating feel

### 3.2 Sparkle/Particle Effects

**Where:** Chat empty state (sparkles icon), correct flashcard answers, high quiz scores
**Animation:**
- Sparkles: icon rotates slowly with intermittent scale pulses, particles float upward and fade
- Confetti: lightweight particle burst (10-15 elements, gravity + fade, 1s lifetime)
**Implementation:** Small canvas-based particle system or CSS-only with absolute-positioned spans.

### 3.3 Drag Magnetic Snapping

**Where:** StickyMiniPlayer drag behavior
**Animation:** When dragging near screen edges/corners, player magnetically pulls toward snap points with spring tension. Release near a snap point → spring settle to exact position.

### 3.4 Score Counters

**Where:** Quiz results, flashcard progress
**Animation:** Numbers roll/flip upward like an odometer when incrementing. Spring-based with overshoot.

### 3.5 Shimmer Loaders

**Where:** All skeleton loading states (replace `animate-pulse`)
**Animation:** Left-to-right gradient shimmer sweep. Consistent across all loading states.
**Implementation:** CSS gradient animation or Motion-driven opacity mask.

### 3.6 Micro-interactions

**Where:** Global — all interactive elements
**Animation:**
- Button press: scale(0.98) on `:active` with spring return
- Focus rings: expand outward from element with brief glow (not instant appear)
- Empty states: slow floating animation (translateY oscillation, 3s cycle)
- Toast notifications: spring slide from top-right with overshoot, exit by sliding right + fade
- PWA install prompt: slide up from bottom with playful bounce
- File upload zone drag-over: border animates (dashed border flows), background pulses with primary tint
- Upload progress bar: spring-animated with slight overshoot at each step
- File delete: row collapses height→0 while fading + sliding left, siblings spring up
- Send button: arrow icon translates up + fades out, new one springs in from below

---

## Implementation Notes

### Library Setup

```ts
// Install as direct dependency
pnpm add motion-v

// Nuxt plugin: app/plugins/motion.client.ts
import { MotionPlugin } from 'motion-v'
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vApp.use(MotionPlugin)
})
```

### Composables to Build

- `useStaggeredEntrance(count, options)` — reusable stagger delay calculator
- `useSpringValue(initial)` — wraps Motion's spring for reactive values
- `usePageDirection()` — tracks navigation direction for page transitions
- `useReducedMotion()` — respects `prefers-reduced-motion` media query globally

### Accessibility

- All animations respect `prefers-reduced-motion`. When enabled: instant transitions, no springs, no particles.
- No animation should block interaction (all are visual-only, no pointer-events manipulation during animation).
- Flashcard flip must remain keyboard-accessible (Space/Enter triggers flip, not just click).

### Performance Budget

- No animation should cause layout thrashing (prefer `transform` and `opacity` only).
- Particle effects limited to 15 elements max.
- Stagger delays capped at 500ms total (10 items × 50ms).
- Springs: stiffness 200-400, damping 20-30 (settle in <400ms).

### File Organization

```
app/
  composables/
    useMotionPresets.ts    — shared spring configs, stagger helpers
    usePageTransition.ts   — navigation direction tracking
  plugins/
    motion.client.ts       — Motion plugin registration
```

### Priority Order

Phase 1 items deliver the most visible UX lift with the least risk. Phase 2 polishes existing interactions. Phase 3 adds delight but is purely additive — safe to defer or skip under time pressure.
