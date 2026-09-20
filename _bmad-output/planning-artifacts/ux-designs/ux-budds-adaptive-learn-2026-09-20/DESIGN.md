---
name: Budds Adaptive Learn
description: Warm Focus learning surfaces that foreground one useful, evidence-aware action.
status: final
updated: 2026-09-20
sources:
  - DESIGN.md
  - docs/learn-anything-adaptive-experience-plan.md
  - _bmad-output/planning-artifacts/prds/prd-budds-adaptive-learn-2026-09-20/prd.md
colors:
  background: '#1c1917'
  foreground: '#fafaf9'
  card: '#292524'
  primary: '#f59e0b'
  primary-foreground: '#1c1917'
  muted-foreground: '#a8a29e'
  accent: '#fcd34d'
  destructive: '#fb7185'
  success: '#6ee7b7'
  warning: '#fb923c'
typography:
  heading:
    fontFamily: 'DM Sans'
    fontSize: '24px'
    fontWeight: '700'
    lineHeight: '1.33'
  body:
    fontFamily: 'DM Sans'
    fontSize: '14px'
    fontWeight: '400'
    lineHeight: '1.6'
  meta:
    fontFamily: 'Inter'
    fontSize: '12px'
    fontWeight: '500'
    lineHeight: '1.5'
rounded:
  sm: '8px'
  md: '10px'
  lg: '12px'
  xl: '16px'
  full: '9999px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '6': '24px'
  gutter-mobile: '16px'
components:
  activity-frame:
    background: '{colors.card}'
    radius: '{rounded.lg}'
    padding: '{spacing.4}'
  primary-action:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.lg}'
  evidence-chip:
    foreground: '{colors.primary}'
    radius: '{rounded.sm}'
---

# Budds Adaptive Learn — UX design foundation

## Direction

Adaptive Learn is a quiet, warm study companion. The interface should make the next useful action obvious while keeping evidence, scoring, and recovery trustworthy. Preserve the existing “Warm Focus” visual language: warm stone surfaces, amber action accents, DM Sans headings, Inter metadata, border-defined elevation, and generous whitespace.

The adaptive experience is not a new visual brand and does not use dashboards, streak pressure, progress theatre, or model-generated interface chrome. The activity is the visual centre; configuration and evidence are contextual support.

## Existing foundation to reuse

| Area | Existing source | Reuse decision |
| --- | --- | --- |
| Tokens | `app/assets/css/tailwind.css` | Reuse semantic CSS variables and Tailwind mappings. |
| Visual rules | `DESIGN.md` | Preserve Warm Focus, typography, spacing, radius, contrast, and focus rules. |
| Primitives | `app/components/ui/{button,card,badge,drawer,sheet,dialog,alert,progress,radio-group,select,textarea,scroll-area,skeleton,spinner,tooltip}` | Compose adaptive UI from these primitives. |
| App shell | `app/layouts/default.vue` | Keep sidebar, sticky header, skip link, theme controls, and responsive Sheet behavior. |
| Evidence | `app/components/learn-v2/EvidenceDesk.vue` | Extract source row/inspector behavior into the contextual Evidence Drawer. |
| Session | `app/components/learn-v2/TodaySession.vue` | Reuse server-scored response, assistance, feedback, retry, and announcement patterns. |
| Mobile input | `app/composables/useMobileKeyboardInset.ts` | Keep the active response and primary action above the virtual keyboard. |

## Token contract

### Inherited tokens

Use `--background`, `--foreground`, `--card`, `--card-foreground`, `--muted`, `--muted-foreground`, `--primary`, `--primary-foreground`, `--accent`, `--border`, `--input`, `--ring`, `--destructive`, `--success`, `--warning`, and `--source-highlight`.

Inherited type and layout values remain authoritative:

- DM Sans 600/700 for headings; Inter 500 for labels/meta; system monospace for source excerpts.
- 4px spacing base; `gap-6` between sections; `gap-3` related items; `p-4` cards.
- 12px default radius; 8px small radius; 16px large container radius.
- Desktop content max width 1200px; mobile content gutters 16px.
- Minimum 44px interactive target; visible amber focus ring.

### Adaptive-specific semantic tokens

These names are implementation aliases, not new colors. Map them to inherited tokens in CSS/Tailwind.

| Token | Maps to | Use |
| --- | --- | --- |
| `--learn-thread-surface` | `--background` | Thread canvas background. |
| `--learn-activity-surface` | `--card` | Activity cards and response surfaces. |
| `--learn-context-surface` | `--popover`/`--card` | Evidence, memory, and “why” drawers. |
| `--learn-action` | `--primary` | One recommended next action. |
| `--learn-support` | `--accent` | Hints, examples, and non-primary support. |
| `--learn-evidence` | `--source-highlight` | Grounding and source relationship. |
| `--learn-success` | `--success` | Completed representative action. |
| `--learn-attention` | `--warning` | Preparing, stale, or recovery states. |
| `--learn-error` | `--destructive` | Blocked or failed recovery state. |
| `--learn-focus-ring` | `--ring` | Keyboard focus and active activity boundary. |

## Adaptive component grammar

Every component is registered, semantically named, and rendered from validated props. Providers supply content only; they never supply component names, HTML, actions, navigation, grading rules, or executable code.

### Required primitives

| Primitive | Visual treatment | Required affordances |
| --- | --- | --- |
| `cited_explanation` | Reading card with inline source chips and optional “Why this?” disclosure. | Source scope, fallback text, open Evidence Drawer. |
| `diagnostic_prompt` | One focused prompt with response field and one primary submit. | Label, response contract, assistance controls. |
| `worked_example` | Example card visually distinct from learner response. | Explicit “guided support” consequence; source links. |
| `independent_application` | Larger response surface for a representative task. | Submit, save draft, keyboard-safe action bar. |
| `source_comparison` | Side-by-side or stacked evidence cards. | Source identity, conflict/gap state, mobile stack. |
| `artifact_workspace` | Focused artifact editor/preview with saved status. | Draft persistence, recovery, export/leave. |
| `reflection_next_move` | Feedback summary and next recommended action. | What changed, uncertainty, next move, override. |

### Shared adaptive anatomy

Each activity has:

1. A stable activity heading and short purpose sentence.
2. Optional evidence scope row.
3. One primary learner action.
4. Support/override controls below the primary action.
5. Explicit status and error region.
6. Deterministic text/card fallback.

## Surface styling

### Learning Home

Use a single calm content column with a prominent need composer. “Resume” and “Worth revisiting” are secondary cards below it. Avoid a dense analytics dashboard. Empty state uses the same composer, not a separate onboarding wizard.

### Learning Thread

Use a stable thread header containing title/outcome, current intent, and a compact “saved” status. The Adaptive Canvas occupies the main column. Capability/artifact history is a quiet lower section. Evidence, memory, and path/schedule details are drawers or secondary disclosures.

### Activity cards

Use `bg-card`, `border-border`, 12px radius, `p-4`/`p-5`, no decorative shadow. One amber primary action per activity. Use text labels alongside icons. Keep source chips visually prominent but compact.

### Contextual drawers

Desktop drawer: 360–480px, anchored from the right, warm card surface, border and warm shadow. Mobile drawer: full-width Sheet, safe-area padding, labelled close button, focus trap, Escape dismissal, and return focus to the invoking control.

### Status treatment

Status is always text plus optional icon, never color alone:

- ready: “Ready to begin” + success icon;
- preparing: “Preparing evidence…” + spinner/live region;
- blocked: plain-language cause + smallest recovery action;
- stale: “This activity uses older evidence” + review action;
- fallback: “Showing a simpler version while this loads” + status region;
- saved/offline: explicit local-save and sync copy.

## Motion and density

Use existing motion presets only for activity boundary transitions and drawer movement. Respect `prefers-reduced-motion` by removing transforms and rendering content immediately. Never animate a learner response, score, or evidence claim into existence. Keep the canvas visually sparse; progressive disclosure is preferred over simultaneous panels.

## Responsive rules

- Desktop `>=1024px`: app sidebar plus canvas; optional drawer leaves canvas visible but dimmed only when necessary.
- Tablet `768–1023px`: canvas remains primary; context uses a drawer rather than a permanent second column.
- Mobile `<768px`: full-screen thread canvas; sidebar/context are Sheets; response draft survives opening/closing a Sheet and viewport resize.
- Use `dvh`, safe-area bottom padding, and `useMobileKeyboardInset` for response controls.
- Never put the current response inside a component that is conditionally destroyed when the layout changes.
- Keep primary action sticky only when it does not obscure the response; add keyboard inset to its bottom offset.

## Accessibility baseline — WCAG 2.2 AA

- Semantic `main`, `header`, `nav`, `section`, `form`, and labelled activity landmarks.
- Every input has a visible or programmatically associated label and described validation/error text.
- Keyboard-only operation for canvas controls, drawers, source chips, overrides, and response submission.
- Visible focus ring using `--learn-focus-ring`; no focus removal on cards.
- `aria-live="polite"` for preparation, save, scoring, and activity changes; `role="alert"` for actionable failures.
- Drawer focus trap, Escape close, labelled title, and focus restoration.
- Colour is supplemental; state labels and icons carry meaning.
- Respect reduced motion, forced colours, zoom/reflow, and high contrast.
- Announce assistance consequence and score state without exposing unsupported mastery claims.

## Implementation naming

Preferred component names:

- `LearnAdaptiveHome`
- `LearnThreadShell`
- `LearnIntentComposer`
- `LearnResumeCard`
- `LearnAdaptiveCanvas`
- `LearnActivityFrame`
- `LearnActivityRegistry`
- `LearnActivityOverrides`
- `LearnEvidenceDrawer`
- `LearnThreadMemoryDrawer`
- `LearnWhyActivity`
- `LearnRecoveryNotice`
- `LearnThreadStatus`

The existing `LearnV2*` components remain available to advanced/migration views. New components should not silently repurpose “Mission”, “Learning Void”, or “Learning Compiler” in learner-facing copy.

## Static reference mocks

- [`mockups/learning-home-and-thread.html`](mockups/learning-home-and-thread.html) — desktop Home and Thread surfaces, focus order, primary action, resume, “Why this?”, evidence scope, and overrides.
- [`mockups/mobile-thread.html`](mockups/mobile-thread.html) — mobile canvas, visible Evidence Drawer state, focus restoration note, and keyboard-safe action bar.

## Authority and reference-token boundary

The authoritative implementation tokens are the semantic variables in `app/assets/css/tailwind.css` and the Tailwind `bg-*`, `text-*`, `border-*`, `ring-*`, and radius utilities mapped to them. The YAML values in this document and the CSS values in static mocks are reference snapshots only; they must not become a second theme. Adaptive aliases map to the existing variables as follows: `--learn-thread-surface` → `--background`, `--learn-activity-surface` → `--card`, `--learn-context-surface` → `--popover`/`--card`, `--learn-action` → `--primary`, `--learn-support` → `--accent`, `--learn-evidence` → `--source-highlight`, `--learn-success` → `--success`, `--learn-attention` → `--warning`, `--learn-error` → `--destructive`, and `--learn-focus-ring` → `--ring`. Light/dark theme values come only from the root `.dark` contract. Where `color-mix()` is unavailable, use the unblended base token and border; never introduce a new brand color.

## Named component contract

| Component | Props | Events | Authority owner | States | Analytics | Test IDs |
| --- | --- | --- | --- | --- | --- | --- |
| `LearnAdaptiveHome` | `threads`, `resume`, `revisit`, `accessState`, `featureFlag` | `startNeed`, `resumeThread`, `review`, `search`, `openLegacy` | Convex thread/access projection | loading, empty, ready, denied, rollback | `thread_home_viewed`, `thread_drafted`, `thread_resumed` | `learn-adaptive-home`, `learn-need-input`, `learn-start` |
| `LearnIntentComposer` | `draft`, `context`, `intentOptions`, `availableTime` | `updateDraft`, `selectIntent`, `attachContext`, `start`, `saveDraft` | Convex draft; client owns transient form | empty, invalid, attaching, blocked, ready | `thread_drafted`, `intent_selected`, `context_attached` | `learn-intent-composer`, `learn-intent-*`, `learn-save-draft` |
| `LearnThreadShell` | `thread`, `activity`, `syncState`, `featureFlag` | `leave`, `end`, `openEvidence`, `openMemory`, `openPath`, `override` | Convex thread lifecycle/next action | loading, ready, offline, stale, ended, rollback | `thread_opened`, `thread_ended`, `activity_override_selected` | `learn-thread`, `learn-thread-leave`, `learn-thread-end` |
| `LearnAdaptiveCanvas` | validated `activityPlan`, `registry`, `fallback` | `start`, `submit`, `assist`, `complete`, `fallback` | Convex activity contract/evaluator | preparing, ready, submitting, scoring, feedback, fallback | `activity_eligible`, `activity_started`, `activity_completed`, `provider_failure` | `learn-canvas`, `learn-activity`, `learn-activity-submit` |
| `LearnActivityFrame` | `heading`, `purpose`, `reason`, `evidence`, `status`, `primitive` | `why`, `openEvidence`, `changeFormat` | Server reason code; client rendering | ready, stale, blocked, invalidated | `activity_reason_viewed` | `learn-activity-frame`, `learn-why-activity` |
| `LearnActivityRegistry` | `contractVersion`, `registeredTypes`, `fallbacks` | `rejectUnknown`, `renderFallback` | Versioned allowlist owned by application | valid, unknown, invalidProps, unsafe | `activity_fallback_rendered` | `learn-activity-fallback` |
| `LearnActivityOverrides` | `options`, `selected`, `disabledReasons` | `selectOverride`, `changeTime`, `cancel` | Server router; learner owns preference | available, pending, unavailable, applied | `activity_override_selected` | `learn-overrides`, `learn-override-*` |
| `LearnEvidenceDrawer` | `sources`, `selected`, `permissions`, `activityClaims` | `close`, `select`, `retry`, `replace`, `accept`, `reject` | Convex evidence/access authority | ready, preparing, blocked, stale, invalidated, unavailable | `evidence_drawer_opened`, `evidence_gap`, `evidence_invalidated` | `learn-evidence-drawer`, `learn-source-*` |
| `LearnThreadMemoryDrawer` | `unresolvedPoint`, `artifacts`, `preferences`, `mastery` | `close`, `editMemory`, `clearPreference` | Convex thread memory; learner controls visibility | loading, ready, empty, conflict | `memory_viewed`, `memory_edited` | `learn-memory-drawer`, `learn-memory-*` |
| `LearnWhyActivity` | `reasonCode`, `inputs`, `evidence`, `fallbackCopy` | `open`, `close`, `override` | Persisted decision log | closed, open, unavailable | `activity_reason_viewed` | `learn-why-activity` |
| `LearnRecoveryNotice` | `state`, `message`, `retryKey`, `preservedDraft` | `retry`, `replace`, `continueSafe`, `rollback` | Convex commit/reconciliation state | blocked, timeout-before-commit, timeout-after-commit, ambiguous, fallback | `provider_failure`, `activity_reconciled` | `learn-recovery-notice`, `learn-recovery-*` |
| `LearnThreadStatus` | `syncState`, `sourceState`, `saveState` | none | Convex projection plus local sync queue | saved, saving, offline, conflict, stale | `thread_sync_conflict` | `learn-thread-status` |

## Primitive coverage and fallback

| Primitive | Ready reference | Required fallback | Feedback/completed state | Mobile rule |
| --- | --- | --- | --- | --- |
| `cited_explanation` | explanation + source chips | plain text + “Evidence unavailable” | learner restatement/next move | one column; source drawer |
| `diagnostic_prompt` | labelled prompt + response | text prompt + textarea | response/confidence recorded | response remains mounted above keyboard |
| `worked_example` | example with assistance consequence | static worked text | guided status, never independent | disclosure remains inline |
| `independent_application` | task + textarea/editor | plain textarea | rubric feedback/retry | sticky action uses keyboard inset |
| `source_comparison` | two source cards | stacked source summaries | choice + rationale | stack cards, preserve selection |
| `artifact_workspace` | editor + saved indicator | textarea + download/save | saved artifact/recovery | drawer never destroys draft |
| `reflection_next_move` | feedback + next action | text feedback + continue | accepted/overridden/ended | action bar remains reachable |
