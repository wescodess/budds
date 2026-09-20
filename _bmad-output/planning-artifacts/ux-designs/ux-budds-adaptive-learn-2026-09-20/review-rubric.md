# Adaptive Learn UX implementation-readiness review

Date: 2026-09-20
Scope: `DESIGN.md`, `EXPERIENCE.md`, both static mocks, the canonical adaptive-experience plan, and the Adaptive Learn PRD.
Verdict: **Partial reflection; not yet implementation-ready.**

The spines cover the intended product direction and most of the important safety/accessibility rules. They do not yet provide executable UX evidence for every promised surface and state. The blockers below are documentation/contract gaps, not a request to redesign the experience.

## Gate summary

| Gate | Result | Implementation consequence |
| --- | --- | --- |
| Product/IA coverage | Partial | Six intents, advanced surfaces, and coexistence routes are described, but not all are discoverable or closed in the Home/Thread interaction contract. |
| Activity/state coverage | Partial | The state matrix is strong, while the mocks and per-state action contracts cover mainly the ready path. |
| Recovery and authority UX | Partial | Recovery principles are explicit; user-visible reconciliation, stale/invalidated, scoring, and rollback views are not specified at component level. |
| WCAG 2.2 AA | Directionally complete, evidence incomplete | Requirements are stated, but the static references expose landmark/modal issues and do not prove the required dynamic behavior. |
| Responsive/mobile | Partial | Mobile intent is clear, but tablet, keyboard-inset, rotation, and real Sheet behavior are not demonstrated. |
| Visual inheritance | Mostly complete | Warm Focus tokens and component reuse are clear; mock CSS is a standalone approximation, not an implementation token map. |
| Mock coverage | Blocked | The acceptance checklist claims variants that are absent from the supplied mock files. |
| Implementation ambiguity | Blocked | Several control semantics, state transitions, and surface ownership decisions must be made explicit before stories can be implemented without product judgment. |

## Findings and closure criteria

### 1. Information architecture and journey closure — **P1**

`EXPERIENCE.md` defines Home, Thread, Evidence, Memory, and Path surfaces, and the plan preserves V1/V2 routes. However, the supplied mocks only show Home and a single Thread activity; Memory controls, Path/schedule details, artifact/capability history, search/manage threads, and coexistence/rollback entry points have no interaction treatment. The Home wireframe also shows only `Understand`, `Prepare`, and `Build`, while the plan/PRD define six intents (`Understand`, `Prepare`, `Build or solve`, `Master`, `Refresh`, `Explore`). See `EXPERIENCE.md:17-35,39-76` and plan §4/§6.

Close when:

- the canonical intent vocabulary is chosen (`Build` vs `Build or solve`) and all six intents have a documented selection/discovery rule;
- Home, Thread, Memory, Path, history/search, and legacy-route entry/return paths each have an owner, entry action, exit action, and back/rollback behavior;
- “Save as thread” and “Change available time” are either represented in the composer or explicitly deferred to a named slice;
- one end-to-end IA map traces first value, leave, resume, explicit end, and legacy coexistence without an undocumented handoff.

### 2. State and recovery contract — **P1**

The state matrix lists access pending through explicit end (`EXPERIENCE.md:221-238`) and the recovery section covers provider timeout, stale revisions, unknown primitives, offline drafts, and rollback (`:265-276`). The mock acceptance checklist claims access-pending, empty, preparing, blocked, fallback, scoring-pending, feedback, remediation, offline, and rollback states (`:278-286`), but neither HTML mock contains these variants. The current desktop mock is ready + unsent response; the mobile mock is ready evidence + visible drawer.

Close when each state has, in one place, exact user copy, semantic role/live announcement, primary and secondary actions, preserved data, retry/idempotency rule, and transition target. At minimum add references for:

- evidence preparing/blocked/stale/invalidated/unavailable;
- scoring pending, timeout before/after commit, ambiguous outcome, fallback, and reconciliation;
- assisted, passed, failed/remediation, offline saved/sync conflict, and explicitly ended;
- access pending and feature-flag rollback with no data loss.

### 3. Primitive and activity coverage — **P1**

The seven-primitive grammar is well named in `DESIGN.md:119-140` and behavior is tabulated in `EXPERIENCE.md:136-148`, but mocks exercise only `cited_explanation` and `independent_application`. There is no visual/interaction contract for diagnostic prompt, worked example, source comparison, artifact workspace, or reflection/next move, including their mobile fallbacks.

Close when every primitive has a minimal reference state (ready, error/recovery where relevant, and completed/feedback state), required action, response persistence rule, evidence affordance, accessible name/landmark, and deterministic text/card fallback. This can be a compact state sheet rather than a high-fidelity mock.

### 4. Accessibility/WCAG 2.2 AA — **P1**

The stated baseline is appropriate (`EXPERIENCE.md:251-263`; `DESIGN.md:184-213`), but the static evidence does not yet satisfy its own contract:

- `learning-home-and-thread.html` places two `main` elements inside one document (`:113-131` and `:134-170`), conflicting with “one main landmark per surface” unless the file is explicitly treated as two independent documents;
- `mobile-thread.html` renders the evidence `role="dialog" aria-modal="true"` open in the same DOM as interactive underlying canvas controls (`:90-108`), so the reference does not demonstrate inert background/focus trapping;
- the mocks describe focus order in prose but do not implement focus management, Escape handling, live announcements, reduced motion, forced-colors/high-contrast behavior, or validation/error associations;
- the desktop skip link is visually moved off-screen without a `:focus` recovery rule (`learning-home-and-thread.html:100-101`).

Close when the reference fixtures (or automated component tests linked from them) prove keyboard traversal, focus trap/restore, `aria-live`/`role=status`/`role=alert` timing, form errors, 200% zoom/reflow, reduced motion, forced colors, and 44px targets for every primitive and Sheet state. Decide whether the static desktop file is one composite showcase or two separately mounted surfaces, then make landmark rules consistent.

### 5. Responsive and mobile behavior — **P1**

The design specifies desktop `>=1024`, tablet `768–1023`, and mobile `<768` with `useMobileKeyboardInset` (`DESIGN.md:175-182`; `EXPERIENCE.md:240-249`). The desktop reference switches at `900px`, has no tablet-specific layout, and the mobile reference uses a permanently visible drawer and an `absolute` action bar rather than demonstrating an actual Sheet, keyboard inset, rotation, or viewport-resize preservation. Its CSS does not consume `--vk-height`/`--vk-safe-bottom` (`mobile-thread.html:1-33`).

Close when breakpoint ownership is aligned between design and implementation, and add a tablet reference plus a mobile interaction fixture covering keyboard open/close, rotation, safe-area bottom padding, scroll-to-focused-input, drawer close/focus restoration, and draft preservation. The action bar must have a specified obscured-content rule when the keyboard or Sheet is open.

### 6. Visual inheritance and design tokens — **P2**

The design correctly reuses Warm Focus tokens, primitives, typography, and shell (`DESIGN.md:72-113`). The standalone mocks duplicate raw color/radius/font values and the mobile body uses a separate `#0f0e0d` backdrop (`mobile-thread.html:1-8`), so an implementer cannot tell which values are illustrative and which are authoritative. The mock also uses `color-mix()` without a fallback.

Close by adding a short “reference-only vs authoritative” note and mapping every adaptive token to existing CSS variables/Tailwind classes. Confirm dark/light/theme behavior, focus-ring contrast, disabled/hover/pressed states, source-highlight contrast, and fallback behavior for unsupported `color-mix()`.

### 7. Implementation ambiguity — **P1**

The experience is conceptually bounded but leaves decisions that would otherwise be made ad hoc in code:

- exact intent chip selection semantics (single-select vs multi-select; inferred vs learner-confirmed; selected/pressed announcement);
- composer validation and empty-submit behavior, URL/material picker states, source permission/auth errors, and available-time control options;
- `Why this?` disclosure behavior and whether it is a popover, inline region, or drawer on mobile;
- evidence source row selection, replace/retry/accept/reject authorization, and how deleted/protected excerpts are shown;
- response draft ownership across route changes, provider timeout, optimistic save, and sync conflict;
- artifact save/apply/share/export semantics and whether “Leave” means save, explicit end, or both;
- exact route/entitlement behavior for `/app/learn/today`, `/app/learn/review`, V2 missions, and folder Learn;
- per-primitive evaluator/feedback display and the boundary between immediate pass, guided status, and delayed retention.

Close by adding a component contract table (props, events, authority owner, loading/error states, analytics event, and test ID) for each named component in `DESIGN.md:196-214`, plus route and state-transition tables for Home and Thread. Any intentionally deferred behavior must name its release slice and fallback.

## Minimum evidence package before implementation starts

1. Revised IA/journey map with all six intents, advanced surfaces, legacy routes, and explicit end/resume paths.
2. State/transition fixture covering every `EXPERIENCE.md` matrix row and the provider commit/reconciliation branches.
3. Primitive coverage sheet or mocks for all seven primitives, including text fallback and mobile behavior.
4. Accessibility test matrix tied to WCAG 2.2 AA behaviors, with corrected landmark/modal references.
5. Desktop/tablet/mobile responsive fixture using the actual breakpoint and keyboard-inset contract.
6. Named-component contract table resolving the ambiguities above and linking each requirement to an implementation/test owner.

Until these are supplied, the artifacts are a strong UX direction and partial reflection of the canonical plan/PRD, but not a complete implementation-ready UX package.
