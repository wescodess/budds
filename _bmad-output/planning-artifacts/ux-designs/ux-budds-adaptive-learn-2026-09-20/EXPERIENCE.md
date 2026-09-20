---
name: Budds Adaptive Learn
status: final
updated: 2026-09-20
sources:
  - docs/learn-anything-adaptive-experience-plan.md
  - _bmad-output/planning-artifacts/prds/prd-budds-adaptive-learn-2026-09-20/prd.md
  - _bmad-output/planning-artifacts/ux-designs/ux-budds-adaptive-learn-2026-09-20/DESIGN.md
---

# Budds Adaptive Learn — implementation-ready experience

## Experience contract

The learner states a need and reaches a useful activity before managing evidence, maps, schedules, or calendars. Budds recommends one next move, explains why, allows safe overrides, grounds factual claims at the point of trust, records only authoritative evidence, and resumes at the unresolved point.

## Information architecture

```text
/app/learn
├── Need composer
├── Resume active thread
├── Worth revisiting (only when materially useful)
└── Other threads (history/search/manage)

/app/learn/thread/:threadId
├── Thread header: outcome, intent, saved status
├── Adaptive Canvas (primary)
├── Artifact/capability history (quiet secondary)
├── Evidence Drawer (contextual)
├── Memory controls (contextual)
└── Advanced path/schedule details (contextual)
```

Existing `/app/learn/today`, `/app/learn/review`, V2 mission workspaces, and `/app/folders/:id/learn/*` remain reachable through coexistence/entitlement rules. They are not removed or silently rewritten.

## Closed route and intent map

| Canonical intent | Home discovery | First thread surface | Continuation | Explicit end/back | Legacy/coexistence path |
| --- | --- | --- | --- | --- | --- |
| Understand | `Understand` suggested chip; inferred suggestion requires confirmation only when ambiguous | `cited_explanation` or `diagnostic_prompt` | explanation, comparison, application | Leave saves unresolved point; End marks thread ended | V2 mission/session remains available via “Open current plan” |
| Prepare | `Prepare` chip or deadline language inference | `diagnostic_prompt` | representative rehearsal, remediation, time override | Leave returns Home resume; End preserves attempt history | `/app/learn/today` remains schedule entry |
| Build or solve | `Build or solve` chip (canonical label; “Build” is not used alone) | `artifact_workspace` | critique, revision, transfer | Leave saves artifact draft; End closes thread without deleting artifact | folder documents/chat remain source entry points |
| Master | `Master` chip or explicit “remember this” request | diagnostic then independent application | review promotion and delayed check | Leave schedules no work implicitly; End disables optional review only | `/app/learn/review` remains review entry |
| Refresh | `Refresh` chip; suggested only when a due vulnerable capability exists | `diagnostic_prompt` in Slice 1; retrieval burst is deferred | remediation or next review | Leave returns Home; End does not change mastery | existing review backlog remains authoritative |
| Explore | `Explore` chip or exploratory question inference | cited explanation/source comparison | branch into a new thread or save current thread | Back returns parent thread; End archives branch state | folder/chat/web source routes remain reachable |

Closed surface ownership:

- Home owns need drafting, intent choice, context attachment, Save draft, Start, Resume, Worth revisiting, thread search/manage, and legacy entry links.
- Thread owns activity, Why this, overrides, response draft, feedback, Leave, explicit End, and drawer entry controls.
- Evidence Drawer owns source inspection and authorized source recovery only.
- Memory Drawer owns learner-visible unresolved point, artifacts, preferences, and optional mastery/review visibility.
- Path Drawer owns advanced map/schedule details and Calendar projection; it never owns the primary activity.
- `/app/learn/thread/:threadId` is the adaptive thread route; `/app/learn/create` remains the V2 advanced setup route; `/app/learn/:learningVoidId` remains the V2 mission route; `/app/folders/:id/learn/*` remains V1. Feature-flag rollback from adaptive Home returns to `/app/learn` V2 hub without data loss.

End/resume contract: `Leave` persists draft, activity boundary, unresolved point, and next action, then returns to Home. `End thread` persists history and marks the lifecycle ended; it never deletes attempts, evidence, or artifacts. Resume restores the same activity draft when valid, otherwise the deterministic fallback/next action. Legacy handoff always has a named return route and does not infer adaptive mastery.

## Surface specifications

### 1. Learning Home — `/app/learn`

Wireframe-ready layout:

```text
[Learn]                                      [Search threads]

[ What are you trying to understand or do?                         ]
[ Add folder/material ] [Understand] [Prepare] [Build] [Master] ...
                                              [Start]

[Resume]  Outcome / unresolved point / promised payoff       [Continue]

[Worth revisiting]  Due only when it protects a capability    [Review]

[Other threads]  compact searchable rows                      [Manage]
```

Behavior:

- Composer accepts a question, goal, or task; context is optional.
- Intent suggestions are chips/buttons, never mandatory wizard steps.
- At most one high-value clarification is shown before the first activity.
- Empty, loading, preparing, and blocked states retain the composer.
- A ready session deep-links directly to the thread canvas.

### 2. Intent Composer

Fields and controls:

- need text area/input;
- optional folder/document/URL picker;
- inferred intent suggestion group;
- available-time control;
- “Start with this” primary action;
- “Save as thread” secondary action when the learner wants continuity.

Validation is inline and non-destructive. Draft text survives context picker and mobile Sheet transitions. Source policy is advanced disclosure, not a first-screen blocker.

Intent semantics: one intent is active at a time; chips are single-select buttons with `aria-pressed`, and inferred intent is labelled “Suggested” until confirmed. Selecting another intent changes only routing preference and never deletes work. `Understand`, `Prepare`, `Build or solve`, `Master`, `Refresh`, and `Explore` are the complete vocabulary. Empty submit is disabled with an inline description; fewer than 8 meaningful characters shows “Tell us what you want to understand or do.” Available time is `15`, `25`, `45`, `60`, or `No limit`, and is optional. “Save as thread” stores a draft without starting an activity. Material picker states are idle, attaching, attached, permission-required, unsupported, and failed; each preserves the need text and offers the smallest recovery action.

### 3. Learning Thread Shell — `/app/learn/thread/:threadId`

Header:

- outcome title;
- mutable intent label;
- saved/offline/sync status;
- “Why this?” control for current activity;
- context drawer buttons: Evidence, Memory, Path.

Canvas:

- one active activity at a time;
- activity boundary is the only point where composition changes;
- response state remains mounted while drawers open;
- feedback always distinguishes immediate performance from retained mastery.

Footer/secondary:

- recommended next move;
- safe overrides;
- leave/resume behavior that records the unresolved point.

### 4. Adaptive Canvas

The client receives a validated activity plan with contract version, renderer version, thread/objective/intent identity, purpose, reason code, primitive sequence, required learner action, evidence links, evaluation contract, fallback, accessibility metadata, and replay inputs.

The client rejects unknown primitive types, unsupported actions, invalid evidence links, oversized content, unsafe URLs, and generated executable content. Rejection renders deterministic fallback plus a recovery notice.

### 5. Evidence Drawer

Desktop: right drawer over the thread with source lanes and selected-source inspector. Mobile: full-screen Sheet.

Contents:

- current evidence scope (“Your folder”, “Added by you”, “Open databases”, “Web research”);
- source title/publisher/retrieval state;
- excerpt/claim support;
- coverage (`strong`, `partial`, `gap`) with text;
- source status (`ready`, `preparing`, `unavailable`, `rejected`, `stale`);
- original-source link where safe;
- replace/retry/accept/reject actions only where authorized.

Opening the drawer never clears the learner response. Closing restores focus to the Evidence button. Factual activity cannot claim grounded support when the selected evidence is unavailable or stale.

### 6. Memory and path controls

Memory drawer shows:

- what changed;
- unresolved point;
- next useful move;
- saved artifact/performance;
- explicit learner preferences;
- optional review/mastery state.

Path/schedule details are advanced views. Calendar remains optional projection; the Budds plan remains authoritative.

## Adaptive Canvas primitive behavior

| Primitive | Required state | Primary action | Completion evidence |
| --- | --- | --- | --- |
| `cited_explanation` | ready/preparing/blocked/stale | Continue, inspect source, ask for example | learner explanation/navigation response |
| `diagnostic_prompt` | unanswered/answered/assisted | Submit response | diagnostic response + confidence |
| `worked_example` | hidden/revealed | Reveal or continue | assistance event; never independent pass |
| `independent_application` | draft/submitted/scoring/feedback | Submit for feedback | rubric-scored representative response |
| `source_comparison` | sources ready/conflict/gap | Choose/justify comparison | comparison decision + rationale |
| `artifact_workspace` | empty/draft/saved/recoverable | Save/apply/share artifact | useful artifact snapshot |
| `reflection_next_move` | feedback/next/review/remediation | Accept or override next move | explicit continuation/end decision |

Every primitive has a text/card fallback and exposes semantic labels, keyboard order, focus behavior, and live announcement copy.

## State transitions and recovery contract

```text
access_pending -> denied | home_ready
home_empty -> draft -> intent_confirmed -> preparing | ready
preparing -> ready | blocked | stale
ready -> started -> submitted -> scoring
scoring -> feedback | timeout_before_commit | timeout_after_commit | ambiguous
timeout_before_commit -> retry_same_idempotency_key -> scoring | blocked
timeout_after_commit -> reconcile_authoritative_record -> feedback | blocked
ambiguous -> reconcile_authoritative_record -> feedback | retry_same_key | blocked
feedback -> next_activity | remediation | review_offer | ended
offline_draft -> sync_pending -> saved | sync_conflict -> resolve_keep_local | resolve_authority
stale | invalidated -> refresh | replace_source | continue_safe_non_factual | blocked
any_active_state -> leave -> resumable
resumable -> resume_valid_activity | deterministic_fallback | ended
feature_flag_on -> adaptive_home; feature_flag_off -> current_v2_hub
```

| State | Exact copy/role | Primary/secondary action | Preserved data | Idempotency/authority |
| --- | --- | --- | --- | --- |
| Preparing | “Preparing evidence…” / `role=status`, polite | Continue safe diagnostic; Retry | need, context, draft | no factual completion; source state authoritative |
| Blocked | reason-specific sentence / `role=alert` | Retry, replace, folder source, safe continue | all draft/context | retry only with new operation key unless request was not committed |
| Stale/invalidated | “This activity uses older/unavailable evidence.” / alert | Refresh, replace, non-factual continue | response and prior evidence history | no unsupported submit; Convex revision decides |
| Scoring pending | “Your response is being scored.” / status | Retry scoring | response, activity revision | same attempt idempotency key |
| Timeout before commit | “We could not confirm the attempt.” / alert | Retry same attempt | response | authority has no commit; same key is safe |
| Timeout after commit | “Checking whether your response was saved.” / status | Reconcile, then show feedback | response | query authoritative attempt before mutation |
| Ambiguous | “We’re checking the result before retrying.” / status | Reconcile; retry only after no commit | response | no duplicate score; append reconciliation event |
| Assisted | “Guided support used; this attempt is not independent.” / status | Continue/remediate | response + assistance event | evaluator owns guided cap |
| Passed | “You demonstrated this now.” / status | Next move/review | feedback and evidence | immediate pass does not claim retention |
| Failed/remediation | “Let’s try a smaller step.” / alert/status | Remediation, easier, example | attempt + misconceptions | append-only attempt history |
| Offline saved | “Saved on this device; will sync.” / status | Continue/leave | local draft and permitted queue | server-scored action disabled unless contract allows queue |
| Sync conflict | “This thread changed elsewhere.” / alert | Keep local, use authority, inspect diff | both versions | authority wins claims; learner chooses draft |
| Explicit end | “Thread ended; your work is preserved.” / status | Resume/new thread | all artifacts/history | lifecycle mutation authoritative |
| Rollback | “Adaptive Learn is temporarily unavailable.” / alert | Open current V2 hub | thread records | feature flag only; no data migration |

## Learner overrides

Controls are contextual, visible after the recommendation, and safe to use:

- Explain differently
- Show an example
- Let me try
- Quiz me
- Compare sources
- Make this practical
- Make it easier / Make it harder
- Give me the answer now
- Change available time

Rules:

- An override changes the next activity intent, not historical evidence or mastery.
- Assistance is recorded and can cap an attempt at guided status.
- “Give me the answer now” may satisfy immediate intent but never implies mastery.
- The selected override and reason are included in the replayable activity decision log.
- If an override cannot be fulfilled, preserve the current response and offer deterministic fallback.

## Named journeys

### First value: understand now

1. Open Learn Home.
2. Enter “Explain X so I can do Y”; optionally attach a folder.
3. Accept “Understand” intent or change it.
4. Receive cited explanation plus one diagnostic/application prompt.
5. Request an example or answer directly if needed.
6. Complete a representative explanation/navigation task.
7. See grounded feedback, source scope, unresolved point, and next move.
8. Leave; resume card returns to the unresolved point.

### Preparing evidence

1. Submit need with a source that is still preparing.
2. Show non-factual diagnostic or goal-shaping activity immediately.
3. Announce evidence readiness and transition only at the activity boundary.
4. Preserve all learner input and show source scope.

### Evidence blocked/recovery

1. Explain the plain-language reason (auth, robots, unsupported type, size, policy, timeout).
2. Offer the smallest action: retry, add replacement, choose folder source, or continue non-factual.
3. Never imply unsupported source grounding.
4. Record evidence gap/invalidation event.

### Prepare/build/apply

1. Accept “Prepare” or “Build” intent.
2. Diagnose a representative task, not a generic course outline.
3. Render artifact workspace or rehearsal.
4. Save draft artifact and feedback.
5. Resume at the artifact’s unresolved revision.

### Durable mastery

1. Complete immediate representative task.
2. Offer promotion to review/mastery only after learner value is demonstrated.
3. Show review cadence as optional and explain why.
4. Use delayed unassisted checks for retained claims; never infer retention from page completion.

### Return after interruption

1. Open Resume card with outcome, unresolved point, and payoff.
2. Restore current activity and draft response.
3. Offer “Continue”, “Change approach”, or “End thread”.
4. Save explicit end without guilt language or streak pressure.

## State matrix

| State | Learner copy | Action | Rendering/analytics rule |
| --- | --- | --- | --- |
| access pending | “Checking learning access…” | none | polite live region; no controls before authority known |
| no thread | “What are you trying to understand or do?” | compose | composer remains primary |
| preparing | “Preparing evidence…” | continue safe diagnostic / retry | no factual claim until ready |
| ready | “Ready to begin” | start activity | timer starts at authoritative `thread_command_committed.v1` and stops at server-authorized `meaningful_activity_started.v1` |
| blocked | cause + smallest recovery | retry/replace/choose source | alert; preserve draft |
| stale | “This uses older evidence” | review/refresh/continue with notice | do not silently alter evidence scope |
| invalidated | “This source can no longer support this activity” | replace/revise | mark gap; prevent unsupported completion |
| scoring pending | “Your response is being scored” | retry safely | same idempotency key; no duplicate attempt |
| assisted | “Guided support used” | continue | cannot become independent solely from assistance |
| passed | “You demonstrated…” | next move/review | immediate result only; no retention claim |
| failed/remediation | “Let’s try a smaller step” | remediation/override | preserve attempt and misconception evidence |
| fallback | “Showing a simpler version…” | continue/retry | deterministic fallback; log provider/component failure |
| offline saved | “Saved on this device; will sync” | continue/leave | queue only permitted local operations |
| explicitly ended | “Thread ended” | resume/new thread | no guilt or attendance language |

## Responsive and mobile keyboard behavior

- Use the existing application sidebar and mobile Sheet; do not introduce a second navigation rail.
- On mobile, Evidence/Memory/Path are full-screen Sheets with safe-area padding.
- Keep response draft in stable component state; never recreate it on drawer or viewport changes.
- Use `100dvh`, `--vk-height`, and `--vk-safe-bottom` through `useMobileKeyboardInset`.
- When the keyboard opens, scroll the focused input into view and keep submit/continue above the keyboard.
- On rotation, preserve the activity, response, and scroll anchor.
- A drawer opened from a focused control returns focus to that control after close.
- Desktop secondary columns collapse to drawers at tablet width; canvas remains the only primary reading order.

## Accessibility — WCAG 2.2 AA

- One `main` landmark per surface; activity gets a labelled `section`.
- Heading hierarchy starts at the surface title and does not skip levels.
- Inputs use explicit labels, descriptions, validation, and error associations.
- Buttons have text or an accessible name; icon-only buttons include `sr-only` labels.
- Dynamic activity transitions announce purpose and current stage with polite live regions.
- Errors use actionable text and `role="alert"`; preparation/status uses `role="status"`.
- Keyboard order follows visual order; no pointer-only gestures.
- Dialogs/Sheets trap focus, support Escape, restore focus, and expose labelled descriptions.
- Source state, mastery state, and feedback use text plus icon, never colour alone.
- Support 200% zoom, reflow, reduced motion, forced colours, enhanced contrast, and touch targets >=44px.
- Automated tests must cover keyboard traversal, focus restoration, live announcements, reduced motion, and mobile input inset.

## Accessibility behavior/test matrix

| Behavior | Required implementation | Test assertion |
| --- | --- | --- |
| Landmark/skip | One `main` per mounted surface; skip link has visible `:focus` style | keyboard Tab reaches skip link and target; exactly one `main` per fixture |
| Intent chips | `button[aria-pressed]`, single-select, selected announcement | select each intent; assert pressed state and polite announcement |
| Validation | `aria-invalid`, `aria-describedby`, inline error; submit remains non-destructive | empty/short need announces error and preserves text |
| Activity boundary | labelled `section`, status announcement, focus moves to heading only on boundary | assert heading focus and `aria-live` copy after transition |
| Drawer | focus trap, `role=dialog`, labelled title, inert/hidden background, Escape close, restore focus | Tab cycles inside; background cannot receive focus; close restores opener |
| Recovery | `role=status` for pending, `role=alert` for actionable failure | assert exact copy and retry availability per state |
| Forms | visible labels and error association | axe/manual keyboard check for every primitive fixture |
| Motion/contrast | `prefers-reduced-motion`, forced-colors, enhanced contrast styles | media emulation asserts no transform and visible borders/focus |
| Reflow/touch | 200% zoom/reflow; controls >=44px | viewport/zoom snapshot and computed target-size check |
| Mobile input | focus scroll, keyboard-safe action bar, draft preserved | open keyboard, resize/rotate, assert draft and unobscured primary action |

## Recovery, rollback, and coexistence

- V1 folder courses remain first-class at `/app/folders/:id/learn/*`.
- Existing V2 missions remain reachable at their current routes and data plane.
- Adaptive threads initially reference existing V2 mission/session records; do not duplicate authority.
- Feature flag controls Home/thread entry and can immediately route users to the current V2 hub.
- Upgrade is copy-only and never infers mastery, evidence acceptance, or schedule.
- Provider timeout before authoritative commit shows retry; after commit, reconciliation reads authority before retrying.
- Unknown primitive/action renders fallback and records a versioned failure event.
- Stale blueprint/content revision blocks unsafe submission and offers refresh/review.
- Offline mode may preserve drafts and approved local operations, but server-scored attempts remain unavailable unless the existing contract explicitly permits queuing.
- Rollback preserves thread drafts, unresolved points, attempts, and V1/V2 records without destructive migration.

## Responsive and keyboard-inset contract

| Width | Layout owner | Context behavior | Action/keyboard rule |
| --- | --- | --- | --- |
| `>=1024px` | existing app sidebar + thread canvas | Evidence/Memory/Path right drawer 360–480px; canvas may dim | primary action in activity; no keyboard inset unless platform reports one |
| `768–1023px` | sidebar may collapse; canvas remains primary | all context surfaces are drawers; never a permanent second column | drawer width `min(85vw, 480px)`; response remains mounted |
| `<768px` | full-screen thread + existing mobile Sheet sidebar | context is full-width Sheet with focus trap | action bar bottom = `env(safe-area-inset-bottom) + --vk-height`; scroll focused input above it |

`useMobileKeyboardInset` owns `--vk-height` and `--vk-safe-bottom`; the action bar must add both and reserve matching bottom padding in the canvas. On rotation or resize, retain the activity ID, response draft, scroll anchor, and selected source. Opening a Sheet does not unmount the response. Closing restores opener focus. A sticky action may not cover focused content; if available height is insufficient, it becomes in-flow below the response.

## Mock/wireframe acceptance checklist

- Static references: [`mockups/learning-home-and-thread.html`](mockups/learning-home-and-thread.html) and [`mockups/mobile-thread.html`](mockups/mobile-thread.html).
- Primitive/state sheet: [`mockups/primitive-state-sheet.html`](mockups/primitive-state-sheet.html).
- Tablet reference: [`mockups/tablet-thread.html`](mockups/tablet-thread.html).
- Home mock shows composer, optional context, intent suggestions, resume, revisit, and compact history.
- Thread mock shows stable header, one activity, “Why this?”, evidence scope, overrides, and next move.
- Evidence Drawer mock shows ready/preparing/blocked/stale/unavailable source variants.
- Mobile mocks show full-screen canvas, Sheet drawer, safe-area/keyboard-safe action bar, and restored response draft.
- State mocks include access pending, empty, preparing, blocked, fallback, scoring pending, feedback, remediation, offline save, and rollback.
- Every mock labels the primary action, landmark, focus order, and announcement copy.
