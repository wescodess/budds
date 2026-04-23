---
title: 'Phase 2 Motion Animations — Polish'
type: 'feature'
created: '2026-04-19'
status: 'ready-for-dev'
context:
  - '_bmad-output/implementation-artifacts/animation-plan.md'
---

<frozen-after-approval>

## Intent

**Problem:** Phase 1 added high-impact animations (page transitions, dashboard stagger, flashcard deal, chat slide, mini player spring). Key interaction surfaces — quiz feedback, audio host glow, source panel, and question navigation — still feel static and lack polish.

**Approach:** Add Motion-driven animations to 4 focused areas: (1) quiz answer validation + results score, (2) audio player host glow smoothing via useSpring, (3) sequential quiz question slide transitions, (4) source panel card entrance stagger + citation highlight glow. Defer sidebar spring and dialog/sheet overrides to Phase 3 — those touch Shadcn internals and carry regression risk.

## Boundaries & Constraints

**Always:**
- Respect `prefers-reduced-motion` via MotionConfig already wrapping the app
- Animate only `transform` and `opacity`
- Preserve existing keyboard/touch accessibility

**Ask First:**
- Modifying Shadcn UI component internals (Dialog, Sheet, Sidebar)

**Never:**
- Alter quiz scoring logic or answer validation behavior
- Block interaction during animations

</frozen-after-approval>

## Code Map

- `app/components/quiz/SequentialMode.vue` -- question slide transition on index change
- `app/components/quiz/inputs/MultipleChoice.vue` -- selected option scale + glow, correct/incorrect border animation
- `app/components/quiz/inputs/TrueFalse.vue` -- selected state scale + color transition
- `app/components/quiz/ResultsView.vue` -- score ring fill animation + score counter
- `app/components/audio-overview/AudioOverviewPlayer.vue` -- replace computed glow with useSpring-smoothed magnitude
- `app/components/chat/SourcePanel.vue` -- staggered card entrance
- `app/components/chat/SourceCard.vue` -- highlight glow pulse on citation click

## Tasks & Acceptance

**Execution:**
- [ ] `app/components/quiz/SequentialMode.vue` -- wrap question area in keyed Motion with directional slide (next=from right, prev=from left)
- [ ] `app/components/quiz/inputs/MultipleChoice.vue` -- add transition scale on selected option, animate correct/incorrect border color
- [ ] `app/components/quiz/inputs/TrueFalse.vue` -- add scale feedback on selection
- [ ] `app/components/quiz/ResultsView.vue` -- animate score ring stroke-dasharray + score number counter on mount
- [ ] `app/components/audio-overview/AudioOverviewPlayer.vue` -- replace raw `visualizerMagnitude` in glow styles with useSpring-smoothed value for fluid ring pulsing
- [ ] `app/components/chat/SourcePanel.vue` -- wrap each source card div in Motion with staggered entrance (30ms per card)
- [ ] `app/components/chat/SourceCard.vue` -- add glow pulse animation when `highlighted` transitions to true

**Acceptance Criteria:**
- Given a quiz question change, when navigating next/prev, then the question slides in from the direction of navigation with spring easing
- Given a multiple-choice answer is selected, when the option is clicked, then it scales slightly and gets a highlighted border
- Given quiz results load, when the score ring mounts, then the stroke fills from 0 to the score percentage with spring easing
- Given audio is playing, when the active host switches or volume changes, then the glow rings transition smoothly (no jitter)
- Given the source panel opens with 5 sources, when cards render, then they appear in sequence (staggered), not all at once
- Given a citation is clicked, when the source card highlights, then it gets a brief glow pulse animation

## Verification

**Commands:**
- `pnpm build` -- expected: passes
- `pnpm test` -- expected: existing tests pass

**Manual checks:**
- Take a quiz in sequential mode — questions slide between transitions
- Select MC answers — option highlights with scale
- Complete quiz — score ring fills with animation
- Play audio overview — host glow rings pulse smoothly
- Click citation in chat — source panel card glows briefly
