---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - docs/learn-anything-adaptive-experience-plan.md
  - _bmad-output/planning-artifacts/prds/prd-budds-adaptive-learn-2026-09-20/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-budds-adaptive-learn-2026-09-20/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-budds-adaptive-learn-2026-09-20/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-budds-adaptive-learn-2026-09-20/EXPERIENCE.md
  - _bmad-output/planning-artifacts/implementation-contracts.md
---

# Budds Adaptive Learn - Epic Breakdown

Implementation contract: `_bmad-output/planning-artifacts/implementation-contracts.md`.
Stories implement the named route, schema, API, component, provider, fixture,
and recovery contracts there rather than inventing parallel seams.

## Overview

This document decomposes the approved adaptive learning experience into implementation-ready epics and stories. The adaptive-thread plane is additive, server-authoritative, evidence-grounded, accessible, staged, and reversible; existing V1 courses and V2 missions remain first-class routes and authorities.

## Requirements Inventory

### Functional Requirements

- **FR-001:** Learning Home accepts a goal/question and optional folder, document, URL, pasted material, or no material, creating a valid thread draft without curriculum, rubric, schedule, or Calendar setup.
- **FR-002:** Ask at most one high-value clarification before a first move and preserve the learner's original wording.
- **FR-003:** Represent six supported intents and allow changing intent without deleting prior work or silently changing mastery claims.
- **FR-004:** For eligible ready-content users, present a meaningful activity within 90 seconds; loading, outlines, and schedules do not count.
- **FR-005:** While evidence prepares, offer non-factual diagnostic/goal-shaping/source-selection work; when blocked, explain the state and provide the smallest bounded recovery.
- **FR-006:** Start a ready existing V2 session directly from the new experience without a workspace handoff.
- **FR-007:** Retain outcome, intent, source/evidence state, attempts, assistance, misconceptions, confidence calibration, preferences, artifacts, performances, unresolved point, and next action.
- **FR-008:** Expose one next meaningful action, Adaptive Canvas, compact history, optional evidence/path/schedule details, and learner memory controls.
- **FR-009:** Validate every activity composition against a versioned allowlist of registered primitives and bounded props before render.
- **FR-010:** Persist contract/renderer version, thread/objective/intent, purpose/reason, primitive sequence, learner action, evidence, evaluation, fallback, accessibility metadata, and immutable replay inputs for each activity plan.
- **FR-011:** Reject unknown components, unsupported actions, excess content, invalid evidence links, unsafe URLs, and executable generated content; generated content cannot invoke tools or mutations.
- **FR-012:** Provide deterministic text/card fallback for every primitive and separate semantic activity state from visual rendering.
- **FR-013:** Support bounded format, support, difficulty, practicality, example, source-comparison, answer-now, and available-time controls; record every override.
- **FR-014:** Expose a plain-language “Why this?” explanation and bounded override path for every selected activity.
- **FR-015:** End every meaningful loop in a representative task or useful intent-appropriate artifact; explanation alone never implies mastery.
- **FR-016:** Keep Convex authoritative for ownership/access, revisions, evidence, attempts, scoring, mastery, lifecycle, idempotency, and reconciliation.
- **FR-017:** Link factual teaching claims to accepted evidence with origin, permitted locator/passage, revision identity, and fact/synthesis/inference/unknown status.
- **FR-018:** Evidence drawer distinguishes origins and accepted, insufficient, conflicting, stale, deleted, and unavailable states; snippets/model memory never become evidence.
- **FR-019:** Scope attempts to pinned blueprint revision/objective and persist scorer, rubric, verifier, provider, and activity-contract versions.
- **FR-020:** Public clients cannot supply authoritative score, verdict, or mastery; rationales and misconception labels use validated templates/taxonomy or are rejected.
- **FR-021:** Bound provider payloads, data minimization, retention, timeout, and ambiguous-outcome reconciliation; failures preserve accepted learner state.
- **FR-022:** Phase 2 routing is a pure, versioned decision from pinned intent, response outcome, assistance, confidence, available time, source state, and allowed thread state.
- **FR-023:** Persist replayable routing logs containing decision version, inputs, selected activity, reason code, and fallback outcome.
- **FR-024:** Enforce the explicit mastery table: assisted <= guided; independent requires unassisted server-scored pass; retained requires eligible unassisted transfer at least seven days later; failed checks enter auditable remediation.
- **FR-025:** Confidence, time-on-page, clicks, content views, planning rationale, and unverified model knowledge never raise mastery.
- **FR-026:** Phase 3 persists durable lifecycle, artifacts, unresolved points, learner-visible memory controls, and optional mastery/review without forcing mastery mechanics on immediate/exploratory intents.
- **FR-027:** Resume restores relevant goal, evidence, attempt context, artifact, unresolved point, and next action, preferring unfinished value, vulnerable knowledge, or meaningful source change over recency/streaks.
- **FR-028:** Learners can view and boundedly correct, delete, or disable explicit preferences and saved artifacts without rewriting authoritative attempts.
- **FR-029:** Threads reference existing V2 mission/session records where possible; upgrade is copy-only and never infers mastery, evidence acceptance, or schedules.
- **FR-030:** V1 courses and V2 missions remain first-class entitlement-aware routes with immediate feature-flagged rollback and no data loss.
- **FR-031:** Phase 4 accepts provenance-preserving contributions from Chat, Quiz, Flashcards, Podcast, and documents, exposing source origin when converting interactions.
- **FR-032:** Cross-feature reuse deduplicates attempts and never silently raises mastery or obscures source origin.
- **FR-033:** Emit versioned events for drafting, evidence, activity eligibility/start/response/completion, assistance, representative outcomes, delayed checks, retained, remediation, provider failure/ambiguity, invalidation, abandonment, and explicit end.
- **FR-034:** Every metric declares version, source, eligibility, numerator, denominator, time window, and exclusions; seven-day retention includes only eligible capabilities.
- **FR-035:** Phase 2 supports a controlled experiment against a fixed continuation with routing, completion, usefulness, accessibility, and recovery guardrails recorded separately.
- **FR-036:** Phase 5 provides performance/cost controls, accessibility/security audits, provider activation evidence, rollback, and support procedures before GA expansion.

### Non-Functional Requirements

- **NFR-001:** Convex is authoritative for ownership, access, persistence, revisions, scoring, mastery, lifecycle, idempotency, and reconciliation.
- **NFR-002:** Validation/routing are deterministic and replayable for identical pinned inputs; delayed checks have injectable clocks and DST coverage.
- **NFR-003:** Generated data is untrusted; only registered primitives with exhaustive props validation render, with no generated executable UI or direct tool/mutation invocation.
- **NFR-004:** Every factual claim has accepted evidence or explicit synthesis/inference/unknown status; deleted/unavailable evidence remains an integrity state without protected content leakage.
- **NFR-005:** Every primitive supports keyboard operation, landmarks, visible focus, announcements, reduced motion, non-color labels, 44px targets, and deterministic fallback; mobile responses survive layout changes.
- **NFR-006:** Ready-content first value is <=90 seconds for >=70% of eligible pilot users; preparation is measured separately and render cannot block response persistence/fallback.
- **NFR-007:** Provider/search failure, stale revisions, invalidation, rejection, timeout, and rollback preserve accepted state and expose bounded recovery; offline is not server-scored completion.
- **NFR-008:** Provider payloads/logs exclude private filenames/URLs, identifiers, secrets, tokens, unpublished notes, unnecessary source text, raw queries, and result payloads.
- **NFR-009:** Events and decisions carry schema, contract, source, and metric versions with reproducible denominators.
- **NFR-010:** V1 routes, V2 missions, upgraded states, cohorts, and rollback states remain usable and isolated throughout rollout.
- **NFR-011:** First value requires no Calendar, live search, or specific provider; bounded providers fail closed under unsafe policy/quota/reconciliation conditions.

### Additional Requirements / Architecture Decisions

- **AD-1:** Convex derives identity and commits every adaptive read/write, score, lifecycle change, job admission, and recovery using expected revisions, user-scoped idempotency receipts, immutable plan revisions, and leased/checkpointed jobs.
- **AD-2:** Use an additive adaptive-thread plane referencing immutable V2 identities; keep V1 courses and V2 learningVoids independent; upgrade is copy-only.
- **AD-3:** Resolve the active blueprint pointer; reject missing/foreign/superseded/stale pointers; pin all revision identities; attempts append; mastery uses explicit transitions and deterministic scope.
- **AD-4:** Persist semantic Adaptive Canvas plans separately from rendering; allow seven registered primitives with bounded props, reason/action/evaluation/evidence/accessibility metadata and deterministic fallbacks.
- **AD-5:** `learningThread` owns mutable intent/outcome/source/unresolved/next-action lifecycle; factual or mastery activity requires V2 pins; non-factual activity has no claim support/mastery attempt; artifacts and performances are normalized children.
- **AD-6:** Factual content uses accepted unpurged evidence; deletion/conflict/rights gate eligibility; feedback uses approved templates and controlled misconception taxonomy; private locators/excerpts/raw responses stay protected.
- **AD-7:** Routing receives pinned versioned inputs, returns one action/reason/overrides, persists bounded canonical snapshot plus SHA-256 digest, and emits versioned semantic events; observational signals never change mastery.
- **AD-8:** Adaptive access is default-deny and conjunctive across `LEARN_V2_ENABLED`, V2 entitlement, and adaptive entitlement; every adaptive route is gated; disabling routes to existing V2 without data loss.
- **AD-9:** Typed provider ports enforce minimization, byte/token/time limits, policy/model/request IDs, sanitized errors, safe public HTTPS fetch, quota reservation, fail-closed search, and blocked reconciliation after ambiguity.
- **AD-10:** Every adaptive table has owner/parent/access indexes and bounded export/deletion traversal; normalize events, activities, artifacts, attempts, decisions, and receipts.
- **AD-11:** Keep `/app/learn` Need/Resume/Worth revisiting/Other threads and stable thread shell; use accessible recovery, drawers, live regions, focus, reduced motion, labels, and preserved mobile responses.
- **AD-12:** Canonical gate uses optional `users.learnAdaptiveExperienceEntitlement`, internal cohort mutation, sole `hasAdaptiveExperienceAccess` guard, JWT/status/body ordering, 401/404/503 semantics, tombstones, and one gate matrix.
- **AD-13:** `shared/adaptive-learn-storage-manifest.ts` is consumed by schema/export/deletion; initial tables are threads, activities, artifacts, decisions, events, and receipts; artifact R2 cleanup precedes local deletion.
- **AD-14:** Mastery scope key is `sha256(canonicalJson(["learn-v2-mastery-scope.v1", userId, blueprintRevisionId, objectiveId]))`; sole transition mutation uses `.unique()`, receipt-before-mutation, and one transaction; legacy unscoped rows are read-only/quarantined.
- **AD-15:** Reuse `learnJobs` only for V2-backed factual work with non-null pins; standalone non-factual work is deterministic/provider-free; adaptive provider dispatch belongs only to `learnAdaptiveActions.ts` through `adaptive-provider-port.ts`. Slice-1 dispatch requires a finite default-deny pilot manifest; Slice 5 separately owns GA activation approval.
- **AD-16:** Activities have immutable activity ID, boundary ordinal, plan revision, class, and replacement identity; Phase 1 factual activities reuse published V2 session claims/supports; events use a closed allowlist and bounded metadata.
- **AD-17:** Source purge marks support unavailable, purges protected excerpts/locators, emits one invalidation per boundary, blocks factual activities and fallbacks, and preserves historical attempts/feedback read-only.
- Pilot caps are default-deny and activation-configurable: <=7 primitives, <=32 claims, <=64 snapshots, bounded fanout/payloads, 90s provider timeout, 5m lease, <=2 attempts, ambiguity blocks, and quota/cost ceilings.
- Deployment uses the pinned Nuxt/Vue/TypeScript/Convex/Better Auth/Vitest/Playwright stack and lockfile; Cloudflare Pages Git promotion follows backward-compatible Convex deployment; worker locks remain separate.
- Deployment evidence names tested SHA, hosted gate, cohort/flag owner, provider quota/config, keyboard/screen-reader smoke, and rollback owner; local tests do not stand in for live provider/search/Calendar/spend/assistive-tech evidence.
- Verification covers active pointers, revision-scoped attempts/mastery, transition and DST fixtures, client authority rejection, version pins, controlled feedback, schema fallback, V1/V2 isolation, recovery, rollback, and accessibility; run `pnpm verify:learn-v2-beta` and `pnpm verify`.
- Slice ownership is disjoint: Slice 0 owns FR-009–012, FR-016–021, FR-024–025 and foundational FR-033–034; Slice 1 owns FR-001–008, FR-013–015, FR-029–030; Slice 2 owns FR-022–023, FR-035 and adaptive FR-009–014; Slice 3 owns FR-026–028; Slice 4 owns FR-031–032; Slice 5 owns FR-033–036.
- First-value measurement starts at authoritative `thread_command_committed.v1` and stops only at server-authorized `meaningful_activity_started.v1`; ready-content and preparation denominators are separate.
- Later-slice exposure requires frozen `adaptive-routing-analysis.v1`, `thread-memory-analysis.v1`, and `cross-feature-provenance-analysis.v1`; GA additionally requires finite-limit activation manifest, audits, support/rollback runbooks, and seven-day soak.

### UX Design Requirements

- **UX-DR-001:** Reuse Warm Focus: warm stone surfaces, amber actions, DM Sans headings, Inter metadata, border elevation, whitespace, and no dashboard/streak theatre.
- **UX-DR-002:** Use existing semantic CSS variables/Tailwind mappings as authoritative tokens.
- **UX-DR-003:** Map adaptive aliases (`--learn-thread-surface`, `--learn-activity-surface`, `--learn-context-surface`, `--learn-action`, `--learn-support`, `--learn-evidence`, `--learn-success`, `--learn-attention`, `--learn-error`, `--learn-focus-ring`) only to inherited tokens.
- **UX-DR-004:** Preserve 4px spacing, gap-6/gap-3, p-4 cards, 12/8/16px radii, 1200px desktop width, 16px mobile gutters, 44px targets, amber focus.
- **UX-DR-005:** Keep light/dark root `.dark` contract; mocks/YAML are snapshots; no second theme/brand color and use unblended tokens if `color-mix` is unavailable.
- **UX-DR-006:** Compose from existing Button, Card, Badge, Drawer, Sheet, Dialog, Alert, Progress, RadioGroup, Select, Textarea, ScrollArea, Skeleton, Spinner, and Tooltip.
- **UX-DR-007:** Implement Home with threads/resume/revisit/access/flag states, ownership, events, test IDs, and loading/empty/ready/denied/rollback states.
- **UX-DR-008:** Implement Intent Composer with need/context/intent/time, attachment states, draft persistence, inline validation, and start/save events.
- **UX-DR-009:** Implement Thread Shell with outcome, mutable intent, saved/offline/sync state, leave/end, evidence/memory/path drawers, and override controls.
- **UX-DR-010:** Implement Canvas/Activity Frame with validated plans, purpose/reason, evidence/status, one active boundary, response persistence, and all recovery states.
- **UX-DR-011:** Implement Activity Registry with contract version, registered types, bounded validation, rejection, deterministic fallback, analytics, and test IDs.
- **UX-DR-012:** Implement bounded override controls for explain/example/try/quiz/compare/practical/easier/harder/answer/time with selected and disabled reasons.
- **UX-DR-013:** Implement Evidence Drawer with origin lanes, accepted/insufficient/conflicting/stale/deleted/unavailable states, authorized actions, safe links, and focus restoration.
- **UX-DR-014:** Implement Memory Drawer with unresolved point, next move, artifacts/performance, preferences, optional mastery/review, and bounded edit/clear controls.
- **UX-DR-015:** Implement Why/Recovery/Status components for reason, timeout, ambiguity, blocked, stale, invalidated, fallback, save/offline, conflict, sync, and rollback.
- **UX-DR-016:** Implement canonical `/app/learn` and `/app/learn/thread/:threadId` ownership boundaries for Home and Thread; preserve `/app/learn/:learningVoidId` for V2 missions.
- **UX-DR-017:** Preserve `/app/learn/today`, `/app/learn/review`, `/app/learn/create`, `/app/learn/:learningVoidId`, and folder Learn routes with named handoff/rollback.
- **UX-DR-018:** Implement understand, prepare, build or solve, master, refresh, and explore flows without deleting work or inferring mastery on intent change.
- **UX-DR-019:** Implement cited_explanation ready/fallback/completed/mobile behavior.
- **UX-DR-020:** Implement diagnostic_prompt ready/fallback/completed/mobile behavior.
- **UX-DR-021:** Implement worked_example ready/fallback/completed/mobile behavior with guided consequence that cannot become independent.
- **UX-DR-022:** Implement independent_application ready/fallback/completed/mobile behavior with keyboard-safe submit and rubric feedback.
- **UX-DR-023:** Implement source_comparison ready/fallback/completed/mobile behavior with conflict/gap and preserved selection.
- **UX-DR-024:** Implement artifact_workspace ready/fallback/completed/mobile behavior with draft persistence, saved status, recovery, export/leave.
- **UX-DR-025:** Implement reflection_next_move ready/fallback/completed/mobile behavior with accepted/overridden/ended outcomes.
- **UX-DR-026:** Give every activity heading, purpose, evidence row, primary action, support/override, status/error region, labels, keyboard order, announcements, and fallback.
- **UX-DR-027:** Implement copy/roles for access pending, empty, preparing, ready, blocked, stale, invalidated, scoring, assisted, passed, failed/remediation, fallback, offline, ended, and rollback.
- **UX-DR-028:** Implement all draft/preparing/ready/started/submitted/scoring/feedback, timeout, ambiguity, offline conflict, fallback, and rollback transitions without losing response state.
- **UX-DR-029:** Implement WCAG 2.2 AA landmarks, heading hierarchy, labels/descriptions/errors, validation associations, and one main landmark per surface.
- **UX-DR-030:** Implement keyboard-only operation, focus, pressed intent chips, labelled sections, accessible names, visual-order tab sequence, and no pointer-only gestures.
- **UX-DR-031:** Use polite status/live announcements for preparation/save/scoring/transitions and alert for actionable failures with state-specific copy.
- **UX-DR-032:** Implement labelled dialog/Sheet focus trap, inert/hidden background, Escape close, and opener focus restoration.
- **UX-DR-033:** Provide text/icon state labels, forced-color/enhanced-contrast borders/focus, and no unsupported mastery claims.
- **UX-DR-034:** Support reduced motion, 200% reflow, forced colors, enhanced contrast, and >=44px targets; never animate responses/scores/evidence into existence.
- **UX-DR-035:** Implement desktop sidebar/drawers, tablet canvas-primary drawers, and mobile full-screen canvas/full-width Sheets with safe areas.
- **UX-DR-036:** Preserve response draft, activity ID, selected source, and scroll anchor through drawers, layout changes, resize, and rotation.
- **UX-DR-037:** Use `100dvh`, safe-area variables, `--vk-height`, `--vk-safe-bottom`, and `useMobileKeyboardInset` to keep actions above the keyboard.
- **UX-DR-038:** Use existing motion presets only for boundaries/drawers and remove transforms under reduced motion.
- **UX-DR-039:** Implement named desktop/mobile/tablet/state mock reference surfaces with token authority and labelled focus/announcements.
- **UX-DR-040:** Ensure mocks cover Home, Thread, Evidence states, mobile Sheet/action bar, and every required state.
- **UX-DR-041:** Add automated accessibility assertions for keyboard, intent state, validation, activity focus, drawers, recovery, forms, motion/contrast, reflow/targets, and mobile draft preservation.

### Primary traceability map

Each requirement has one primary trace row. Supporting stories may reference a
requirement but do not change its primary slice or ownership.

| requirement_id | uj_id | slice | primary story | owner | implementation surface | acceptance-test/fixture | evidence artifact | dependencies |
|---|---|---:|---|---|---|---|---|---|
| FR-001 | UJ-1 | 1 | Epic 2 / 2.1 | Product + Convex | draft command + Home composer | draft fixture | draft command evidence | AD-5, AD-11 |
| FR-002 | UJ-1 | 1 | Epic 2 / 2.2 | Product + UI | clarification composer | clarification fixture | first-value journey | FR-001 |
| FR-003 | UJ-2 | 1 | Epic 2 / 2.3 | Product + Convex | intent command | intent-change fixture | intent journey | FR-001 |
| FR-004 | UJ-1 | 1 | Epic 2 / 2.4 | Product + UI/metrics | first-value Canvas | first-value query | pilot metric result | FR-001, FR-009 |
| FR-005 | UJ-5 | 1 | Epic 2 / 2.5 | Product + UI | preparing/blocked recovery | state fixture | recovery journey | FR-017, FR-018 |
| FR-006 | UJ-6 | 1 | Epic 2 / 2.4 | Product + UI | V2 session handoff | browser journey | coexistence evidence | existing V2 route contract, AD-2 |
| FR-007 | UJ-6 | 1 | Epic 2 / 2.6 | Product + Convex | thread projection | resume fixture | thread projection evidence | FR-001 |
| FR-008 | UJ-1 | 1 | Epic 2 / 2.6 | Product + UI | Thread shell | component fixture | shell acceptance | FR-007 |
| FR-009 | UJ-5 | 0 | Epic 1 / 1.1 | Engineering | activity registry | schema fixture | registry validation evidence | AD-4 |
| FR-010 | UJ-5 | 0 | Epic 1 / 1.2 | Engineering | activity plan storage | replay fixture | replay evidence | FR-009 |
| FR-011 | UJ-5 | 0 | Epic 1 / 1.1 | Engineering + Security | plan validation | rejection fixture | safety evidence | FR-009 |
| FR-012 | UJ-5 | 0 | Epic 1 / 1.1 | Engineering + UI | deterministic fallback | fallback fixture | fallback evidence | FR-009 |
| FR-013 | UJ-2 | 1 | Epic 2 / 2.7 | Product + UI | bounded overrides | control fixture | override evidence | FR-003 |
| FR-014 | UJ-1 | 1 | Epic 2 / 2.7 | Product + UI | Why-this dialog | reason fixture | explainability evidence | FR-013 |
| FR-015 | UJ-3 | 1 | Epic 2 / 2.8 | Product + UI | representative task/artifact | completion fixture | first-value journey | FR-004 |
| FR-016 | UJ-5 | 0 | Epic 1 / 1.3 | Engineering | Convex authority | authority fixture | authority test evidence | AD-1, AD-8 |
| FR-017 | UJ-5 | 0 | Epic 1 / 1.4 | Engineering | claim adapter/projection | evidence fixture | evidence integrity evidence | AD-6 |
| FR-018 | UJ-5 | 0 | Epic 1 / 1.4 | Engineering + UI | evidence state/drawer | drawer fixture | source recovery evidence | FR-017 |
| FR-019 | UJ-4 | 0 | Epic 1 / 1.5 | Engineering | attempt revision pins | revision fixture | scoring reproducibility | AD-3, AD-14 |
| FR-020 | UJ-2 | 0 | Epic 1 / 1.7 | Engineering | server feedback authority | rejection fixture | authority evidence | FR-016 |
| FR-021 | UJ-5 | 0 | Epic 1 / 1.6 | Engineering | provider port/admission | timeout fixture | provider recovery evidence | FR-016, AD-9, AD-15 |
| FR-022 | UJ-2 | 2 | Epic 3 / 3.1 | Engineering | pure adaptive router | replay fixture | routing replay evidence | FR-013, FR-019 |
| FR-023 | UJ-2 | 2 | Epic 3 / 3.2 | Engineering | decision ledger | decision fixture | decision replay evidence | FR-022 |
| FR-024 | UJ-4 | 0 | Epic 1 / 1.8 | Engineering | mastery transition | transition fixture | delayed-check evidence | FR-019 |
| FR-025 | UJ-4 | 0 | Epic 1 / 1.8 | Engineering | mastery negative controls | negative fixture | mastery safety evidence | FR-024 |
| FR-026 | UJ-3 | 3 | Epic 4 / 4.1 | Engineering | thread lifecycle | lifecycle fixture | lifecycle evidence | FR-007 |
| FR-027 | UJ-6 | 3 | Epic 4 / 4.3 | Engineering + UI | resume projection | resume fixture | seven-day resume evidence | FR-026 |
| FR-028 | UJ-3 | 3 | Epic 4 / 4.4 | Engineering + UI | memory controls | deletion fixture | privacy/deletion evidence | FR-026 |
| FR-029 | UJ-6 | 1 | Epic 2 / 2.8 | Engineering | V2 reference | coexistence fixture | migration evidence | FR-016 |
| FR-030 | UJ-6 | 1 | Epic 2 / 2.8 | Engineering + Operations | feature gate/routes | rollback fixture | rollback evidence | FR-029 |
| FR-031 | UJ-3 | 4 | Epic 5 / 5.1 | Engineering | contribution contract | provenance fixture | provenance evidence | FR-026 |
| FR-032 | UJ-4 | 4 | Epic 5 / 5.4 | Engineering | cross-feature deduplication | duplicate fixture | duplicate-attempt evidence | FR-031 |
| FR-033 | UJ-6 | 5 | Epic 6 / 6.1 | Operations | semantic event ledger | ledger fixture | event ledger evidence | FR-016 |
| FR-034 | UJ-4 | 5 | Epic 6 / 6.2 | Product Analytics | metric definitions | reproducibility fixture | metric reproduction evidence | FR-033 |
| FR-035 | UJ-2 | 2 | Epic 3 / 3.7 | Product Analytics | controlled experiment | analysis artifact | approved analysis plan | FR-022 |
| FR-036 | UJ-6 | 5 | Epic 6 / 6.5 | Operations + Security | GA activation | evidence bundle | activation approval | FR-030, A-002-A-006 |
| NFR-001 | none (cross-cutting) | 0 | Epic 1 / 1.3 | Engineering | authority boundary | authority fixture | authority evidence | FR-016 |
| NFR-002 | none (cross-cutting) | 0 | Epic 1 / 1.2 | Engineering | deterministic replay | deterministic fixture | replay evidence | FR-010 |
| NFR-003 | none (cross-cutting) | 0 | Epic 1 / 1.1 | Engineering + Security | generated-content validation | rejection fixture | safety evidence | FR-009, FR-011 |
| NFR-004 | UJ-5 | 0 | Epic 1 / 1.4 | Engineering | evidence integrity | integrity fixture | evidence evidence | FR-017 |
| NFR-005 | none (cross-cutting) | 1 | Epic 2 / 2.6 | UI + QA | accessible base shell | accessibility fixture | accessibility evidence | UX-DR-026, UX-DR-041 |
| NFR-006 | UJ-1 | 1 | Epic 2 / 2.4 | Product Analytics | first-value measurement | pilot query | pilot SLA evidence | FR-004 |
| NFR-007 | UJ-5 | 0 | Epic 1 / 1.6 | Engineering | recovery/reconciliation | timeout fixture | recovery evidence | FR-021 |
| NFR-008 | UJ-5 | 0 | Epic 1 / 1.6 | Security + Engineering | provider redaction | redaction fixture | privacy evidence | FR-021 |
| NFR-009 | none (cross-cutting) | 5 | Epic 6 / 6.2 | Product Analytics | event/metric versioning | reproduction fixture | metric reproduction evidence | FR-033, FR-034 |
| NFR-010 | UJ-6 | 1 | Epic 2 / 2.8 | Engineering | V1/V2 coexistence | rollback fixture | rollback evidence | FR-030 |
| NFR-011 | UJ-5 | 0 | Epic 1 / 1.6 | Engineering + Operations | provider admission | quota fixture | cost/quota evidence | FR-021 |
| UJ-1 | UJ-1 | 1 | Epic 2 / 2.4 | Product + QA | first-value journey | browser journey | first-value evidence | FR-001, FR-004 |
| UJ-2 | UJ-2 | 1 | Epic 2 / 2.8 | Product + QA | prepare journey | representative-task fixture | preparation evidence | FR-003, FR-015 |
| UJ-3 | UJ-3 | 3 | Epic 4 / 4.2 | Product + QA | artifact resume journey | artifact fixture | artifact evidence | FR-026, FR-028 |
| UJ-4 | UJ-4 | 3 | Epic 4 / 4.5 | Product + QA | mastery/review journey | delayed-check fixture | retention evidence | FR-024, FR-027 |
| UJ-5 | UJ-5 | 1 | Epic 2 / 2.5 | Product + QA | evidence recovery journey | recovery journey | recovery evidence | FR-017, FR-021 |
| UJ-6 | UJ-6 | 3 | Epic 4 / 4.3 | Product + QA | resume/coexistence journey | browser journey | coexistence evidence | FR-027, FR-030 |

### UX traceability map

Each UX design requirement has one explicit owning story; the UX artifact and
story acceptance criteria remain the source of visual and interaction detail.

| requirement_id | uj_id | slice | primary story | owner | implementation surface | acceptance-test/fixture | evidence artifact | dependencies |
|---|---|---:|---|---|---|---|---|---|
| UX-DR-001 | none (cross-cutting) | 1 | Epic 2 / 2.6 | UI | Warm Focus shell | visual token fixture | DESIGN.md token review | existing DESIGN.md |
| UX-DR-002 | none (cross-cutting) | 1 | Epic 2 / 2.6 | UI | semantic CSS tokens | token mapping fixture | token mapping evidence | UX-DR-001 |
| UX-DR-003 | none (cross-cutting) | 1 | Epic 2 / 2.6 | UI | adaptive token aliases | alias mapping fixture | token mapping evidence | UX-DR-002 |
| UX-DR-004 | none (cross-cutting) | 1 | Epic 2 / 2.6 | UI | spacing/radius/focus | layout token fixture | responsive evidence | UX-DR-001 |
| UX-DR-005 | none (cross-cutting) | 1 | Epic 2 / 2.6 | UI | theme and fallback colors | theme fixture | contrast evidence | UX-DR-002 |
| UX-DR-006 | none (cross-cutting) | 1 | Epic 2 / 2.6 | UI | shared UI primitives | component inventory fixture | component reuse evidence | UX-DR-002 |
| UX-DR-007 | UJ-1 | 1 | Epic 2 / 2.4 | UI + QA | Learning Home states | Home state fixture | browser journey | FR-001, FR-004 |
| UX-DR-008 | UJ-1 | 1 | Epic 2 / 2.1 | UI + QA | Intent Composer | composer fixture | first-value journey | FR-001 |
| UX-DR-009 | UJ-6 | 1 | Epic 2 / 2.6 | UI | Thread Shell | shell fixture | thread evidence | FR-007, FR-008 |
| UX-DR-010 | UJ-1 | 1 | Epic 2 / 2.6 | UI | Canvas/Activity Frame | canvas fixture | first-value journey | FR-009 |
| UX-DR-011 | UJ-5 | 0 | Epic 1 / 1.1 | Engineering + UI | Activity Registry | registry fixture | registry evidence | FR-009 |
| UX-DR-012 | UJ-2 | 1 | Epic 2 / 2.7 | UI | bounded overrides | control fixture | override evidence | FR-013 |
| UX-DR-013 | UJ-5 | 0 | Epic 1 / 1.4 | Engineering + UI | Evidence Drawer | drawer fixture | evidence evidence | FR-017, FR-018 |
| UX-DR-014 | UJ-6 | 3 | Epic 4 / 4.4 | UI | Memory Drawer | memory fixture | privacy evidence | FR-028 |
| UX-DR-015 | UJ-5 | 1 | Epic 2 / 2.5 | UI + QA | status/recovery components | recovery fixture | recovery journey | FR-005, FR-021 |
| UX-DR-016 | UJ-6 | 1 | Epic 2 / 2.6 | UI + Routing | route ownership | route fixture | route evidence | FR-030 |
| UX-DR-017 | UJ-6 | 1 | Epic 2 / 2.8 | UI + Routing | legacy handoff | coexistence fixture | rollback evidence | FR-030 |
| UX-DR-018 | UJ-2 | 1 | Epic 2 / 2.3 | Product + UI | intent flows | intent fixture | intent evidence | FR-003 |
| UX-DR-019 | UJ-1 | 2 | Epic 3 / 3.5 | UI | cited explanation | primitive fixture | primitive state evidence | UX-DR-010 |
| UX-DR-020 | UJ-2 | 2 | Epic 3 / 3.5 | UI | diagnostic prompt | primitive fixture | primitive state evidence | UX-DR-010 |
| UX-DR-021 | UJ-2 | 2 | Epic 3 / 3.5 | UI | worked example | primitive fixture | guided-state evidence | FR-024 |
| UX-DR-022 | UJ-2 | 2 | Epic 3 / 3.5 | UI | independent application | primitive fixture | rubric feedback evidence | FR-019 |
| UX-DR-023 | UJ-5 | 2 | Epic 3 / 3.5 | UI | source comparison | primitive fixture | conflict/gap evidence | FR-018 |
| UX-DR-024 | UJ-3 | 2 | Epic 3 / 3.5 | UI | artifact workspace | primitive fixture | artifact evidence | FR-015 |
| UX-DR-025 | UJ-1 | 2 | Epic 3 / 3.5 | UI | reflection/next move | primitive fixture | continuation evidence | FR-014 |
| UX-DR-026 | none (cross-cutting) | 2 | Epic 3 / 3.5 | UI + QA | activity anatomy | primitive accessibility fixture | accessibility evidence | UX-DR-019–025 |
| UX-DR-027 | UJ-5 | 1 | Epic 2 / 2.5 | UI + QA | state copy/roles | recovery fixture | recovery evidence | FR-005 |
| UX-DR-028 | UJ-5 | 2 | Epic 3 / 3.6 | UI + QA | transition recovery | recovery fixture | recovery evidence | FR-021 |
| UX-DR-029 | none (cross-cutting) | 3 | Epic 4 / 4.7 | QA | landmarks/forms | accessibility fixture | WCAG evidence | NFR-005 |
| UX-DR-030 | none (cross-cutting) | 3 | Epic 4 / 4.7 | QA | keyboard operation | keyboard fixture | keyboard evidence | UX-DR-029 |
| UX-DR-031 | none (cross-cutting) | 3 | Epic 4 / 4.7 | QA | live announcements | announcement fixture | screen-reader evidence | UX-DR-029 |
| UX-DR-032 | none (cross-cutting) | 3 | Epic 4 / 4.7 | QA | drawer focus behavior | drawer accessibility fixture | focus evidence | UX-DR-030 |
| UX-DR-033 | none (cross-cutting) | 3 | Epic 4 / 4.7 | QA | state labels/contrast | contrast fixture | contrast evidence | UX-DR-005 |
| UX-DR-034 | none (cross-cutting) | 3 | Epic 4 / 4.7 | QA | motion/reflow/targets | reflow fixture | responsive accessibility evidence | UX-DR-033 |
| UX-DR-035 | none (cross-cutting) | 3 | Epic 4 / 4.7 | UI + QA | responsive shell | responsive fixture | tablet/mobile evidence | UX-DR-034 |
| UX-DR-036 | UJ-6 | 3 | Epic 4 / 4.7 | UI + QA | draft/anchor preservation | rotation fixture | mobile resume evidence | FR-027 |
| UX-DR-037 | UJ-1 | 3 | Epic 4 / 4.7 | UI | keyboard inset | mobile input fixture | keyboard evidence | UX-DR-035 |
| UX-DR-038 | none (cross-cutting) | 3 | Epic 4 / 4.7 | UI | reduced-motion transitions | motion fixture | reduced-motion evidence | UX-DR-034 |
| UX-DR-039 | none (cross-cutting) | 3 | Epic 4 / 4.7 | Design + UI | named mock surfaces | mock fixture | mock review artifact | DESIGN.md |
| UX-DR-040 | none (cross-cutting) | 3 | Epic 4 / 4.7 | Design + QA | state mock coverage | mock coverage fixture | mock review artifact | UX-DR-039 |
| UX-DR-041 | none (cross-cutting) | 3 | Epic 4 / 4.7 | QA | automated accessibility assertions | accessibility suite | WCAG test report | UX-DR-029–040 |

## Epic List

### Epic 1: Demonstrate the safe, grounded activity prerequisite

Demonstrate the server-authoritative contract for a safe, grounded activity: validation, evidence, scoring, provider bounds, mastery transitions, fallbacks, and foundational events. This is a prerequisite vertical slice proved with contract and fallback fixtures, not a standalone learner release; Epic 2 owns the first exposed thread, Canvas, and shell.

### Epic 2: Start learning immediately from a real need

Let learners state a need, choose intent, attach optional context, reach meaningful first value, complete representative work, inspect evidence, and coexist with V1/V2 routes.

### Epic 3: Receive and control the next best move

Provide deterministic, explainable routing, safe overrides, replayable decisions, controlled experimentation, accessibility/recovery guardrails, and reversible exposure.

### Epic 4: Resume meaningful progress over time

Persist durable thread lifecycle, artifacts, unresolved points, meaningful resume selection, learner memory controls, and optional review/mastery without rewriting authority.

### Epic 5: Carry learning across Budds features

Accept provenance-preserving contributions from Chat, Quiz, Flashcards, Podcast, and documents while deduplicating attempts and preserving source origin.

### Epic 6: Measure, operate, and safely expand Adaptive Learn

Provide reproducible metrics, performance/cost controls, accessibility/security evidence, provider activation, support procedures, rollback, and GA cohort expansion.

## Epic 1: Demonstrate the safe, grounded activity prerequisite

### Story 1.1: Register and validate adaptive activity primitives

**Slice:** 0

As a learning-platform engineer,
I want a versioned registry of the seven approved activity primitives with bounded prop schemas,
So that only safe, renderable learning activities can be composed.

**Coverage:** FR-009, FR-011, FR-012; AD-4; UX-DR-011.

**Acceptance Criteria:**

**Given** a plan names a registered primitive with contract-valid bounded props
**When** the server validates the plan
**Then** validation succeeds and returns the contract/renderer version.

**Given** a plan names an unknown primitive, unsupported action, oversized prop, unsafe URL, or executable content
**When** the server validates the plan
**Then** validation rejects it with a typed reason and no client mutation is performed.

**Given** a primitive plan is rejected
**When** the validation result is returned
**Then** it provides a deterministic text/card fallback contract and typed reason for the Epic 2 Canvas to render.

**And** the registry exposes the contract version, registered type list, stable test IDs, and versioned validation/fallback analytics for valid, rejected, and fallback outcomes.

### Story 1.2: Persist immutable activity plans and replay inputs

**Slice:** 0

As a learning-platform engineer,
I want every accepted activity plan to persist its immutable decision and contract inputs,
So that activity composition can be audited and replayed exactly.

**Coverage:** FR-010; AD-4, AD-7, AD-16; NFR-002.

**Acceptance Criteria:**

**Given** a validated activity is committed
**When** its plan is persisted
**Then** it stores activity identity, thread, objective, intent, purpose, primitive sequence, required action, evaluation contract, fallback, accessibility metadata, and all pinned versions.

**And** it persists accepted evidence/claim references and immutable canonical generation/decision inputs (including their digest) sufficient to replay the plan without consulting mutable current state.

**Given** the thread anchor and activity-plan entities are first introduced
**When** their writer is added
**Then** this story adds their `learningThreads` and `learningThreadActivities` manifest entries, owner/parent indexes, bounded export/deletion traversal, and fixture coverage; Story 2.1 owns creating learner thread drafts on that anchor.

**Given** an activity plan already has a committed revision
**When** a replacement is needed
**Then** a new plan revision and boundary are created without mutating the prior plan.

**Given** identical pinned inputs are replayed
**When** the composition is evaluated
**Then** the same plan, reason code, and fallback result are produced.

**Given** a persisted replay input or evidence/claim reference is altered
**When** replay validation runs
**Then** tampering is detected and the plan is rejected or marked non-replayable without mutating the original revision.

### Story 1.3: Establish Convex authority and command idempotency

**Slice:** 0

As a learning-platform engineer,
I want adaptive reads and writes to be server-authoritative and idempotent,
So that clients cannot forge learning state and retries cannot duplicate effects.

**Coverage:** FR-016; AD-1, AD-8, AD-12; NFR-001.

**Acceptance Criteria:**

**Given** a client submits a score, verdict, mastery transition, lifecycle change, or job admission
**When** the Convex command executes
**Then** identity, access, expected revision, and payload are validated server-side before any write.

**Given** the same user-scoped idempotency key is retried
**When** the command executes
**Then** the stored receipt is returned and no duplicate state change is committed.

**Given** command receipts are first persisted
**When** their writer is added
**Then** this story adds the `learnActivityCommandReceipts` manifest entry, unique owner/key access path, bounded export/deletion traversal, and fixture coverage.

**Given** a client supplies an authoritative score or mastery value
**When** the command executes
**Then** the supplied authority is ignored or rejected and only server-derived state is persisted.

### Story 1.4: Project factual claims and evidence integrity states

**Slice:** 0

As a learner,
I want factual activity claims to show where they came from and whether the source is trustworthy,
So that I can distinguish accepted evidence from gaps, conflicts, and unavailable material.

**Coverage:** FR-017, FR-018; AD-4, AD-6, AD-17; UX-DR-013.

**Acceptance Criteria:**

**Given** a factual claim is included in an accepted activity
**When** it is projected to the learner
**Then** it links to an accepted source origin, permitted locator, revision identity, and fact/synthesis/inference/unknown status.

**Given** evidence is insufficient, conflicting, stale, deleted, or unavailable
**When** its activity-facing projection is requested
**Then** it returns the corresponding integrity state without promoting a snippet or model memory to evidence; Story 2.6 owns displaying it in the Evidence drawer.

**Given** a source is purged or invalidated
**When** affected activities are read
**Then** protected excerpts/locators are removed, current factual eligibility is blocked, and historical attempts remain read-only.

### Story 1.5: Scope attempts to revisions and evaluation contracts

**Slice:** 0

As a learner,
I want my responses evaluated against the exact content and rubric I received,
So that feedback remains fair and reproducible when content changes.

**Coverage:** FR-019; AD-3, AD-14, AD-16; NFR-002.

**Acceptance Criteria:**

**Given** an activity is started
**When** the attempt is created
**Then** it pins blueprint revision, objective, content, rubric, scorer, verifier, provider, and activity contract versions.

**Given** the active pointer is missing, foreign, superseded, or stale
**When** an attempt is admitted
**Then** the server rejects admission with a recoverable revision-state reason.

**Given** the same attempt is submitted twice
**When** the server processes the submissions
**Then** one append-only attempt outcome exists and duplicate effects are prevented.

### Story 1.6: Admit bounded server-scored provider work

**Slice:** 0

As a learner,
I want feedback to be safe, bounded, and recoverable when providers fail,
So that an outage never corrupts my accepted learning state.

**Coverage:** FR-020, FR-021; AD-6, AD-9, AD-15; NFR-007, NFR-008, NFR-011.

**Acceptance Criteria:**

**Given** a response requires provider evaluation
**When** dispatch is admitted
**Then** payload minimization, size limits, timeout, quota, policy, model, and request versions are recorded before I/O.

**And** Slice-1 V2-backed dispatch occurs only when a finite default-deny pilot
manifest is approved; that manifest admits the pilot but does not satisfy the
separate Slice-5 general-availability activation gate.

**And** the provider request/log contract records retention and deletion behavior and rejects private filenames/URLs, identifiers, secrets/tokens, unpublished notes, unnecessary source text, raw queries, and raw provider/result payloads unless an explicitly approved redacted field is used.

**Given** admission exceeds a finite cap or the adaptive gate is unavailable
**When** dispatch is requested
**Then** no provider I/O occurs and the typed `blocked`/`denied` result is returned without mutating accepted learner state.

### Story 1.7: Reconcile provider outcomes and commit controlled feedback

**Slice:** 0

As a learner,
I want provider feedback to be verified and recoverable,
So that an outage or unsafe rationale never corrupts my accepted learning state.

**Coverage:** FR-020, FR-021; AD-6, AD-9, AD-15; NFR-007, NFR-008, NFR-011.

**Acceptance Criteria:**

**Given** the provider returns a rationale or misconception
**When** feedback is committed
**Then** the server accepts only verifier-approved templates/taxonomy and never trusts client-provided authority.

**Given** dispatch times out before or after the provider may have committed
**When** `reconcileProviderOutcome` runs
**Then** the attempt enters `reconciling` or `blocked`, is not auto-replayed, and accepted learner state is preserved.

**Given** the same reconciliation key is retried
**When** the action resolves the outcome
**Then** one typed feedback result and one authoritative attempt outcome are returned.

### Story 1.8: Implement explicit monotonic mastery transitions

**Slice:** 0

As a learner,
I want mastery to reflect demonstrated performance rather than activity signals,
So that progress claims are honest and recoverable.

**Coverage:** FR-024, FR-025; AD-3, AD-14; NFR-002.

**Acceptance Criteria:**

**Given** an assisted attempt passes
**When** mastery is projected
**Then** the learner cannot advance beyond guided.

**Given** an unassisted server-scored qualifying attempt passes
**When** the mastery command runs
**Then** independent is granted using the scoped mastery identity and append-only transition history.

**Given** an eligible unassisted transfer occurs at least seven calendar days after independence
**When** the delayed check passes
**Then** retained is granted using an injectable clock, including DST-safe boundaries.

**Given** confidence, time-on-page, clicks, content views, planning rationale, or unverified knowledge changes
**When** mastery is evaluated
**Then** no mastery increase occurs from those observational signals alone.

### Story 1.9: Emit foundational events and first-value measurement

**Slice:** 0

As an operator,
I want authoritative activity and recovery transitions to be observable,
So that learner outcomes and failures can be diagnosed without exposing private data.

**Coverage:** FR-033, FR-034; AD-7, AD-16; NFR-009, NFR-006.

**Acceptance Criteria:**

**Given** a thread, evidence, activity, attempt, assistance, completion, failure, or provider transition occurs
**When** the server commits the transition
**Then** it emits the corresponding versioned event with bounded metadata and source/contract versions.

**And** the closed taxonomy explicitly includes `thread_command_committed`, `meaningful_activity_started`, `thread_drafted`, `evidence_ready`, `evidence_blocked`, `activity_eligible`, `activity_started`, `meaningful_response`, `assistance`, `activity_completed`, `representative_pass`, `representative_fail`, `delayed_check_eligible`, `delayed_check_attempt`, `retained`, `remediation`, `provider_failure`, `provider_ambiguity`, `evidence_gap`, `evidence_invalidation`, `abandonment`, and `explicit_end`.

**Given** the event ledger is first introduced
**When** its writer is added
**Then** this story adds the `learnActivityEvents` manifest entry, closed taxonomy, owner/thread/time indexes, bounded export/deletion traversal, and fixture coverage; Epic 6 owns metric definitions and operational retention.

**Given** an event or metric payload contains raw query, provider result, private locator, secret, or learner response
**When** telemetry is written
**Then** the sensitive payload is excluded while the event remains diagnostically useful.

**Given** first-value measurement is registered
**When** `thread_command_committed.v1` and `meaningful_activity_started.v1` are emitted
**Then** Slice 0 owns the frozen event definitions, eligible-ready-content denominator, exclusion codes, and deterministic query fixture in `shared/learn-adaptive-metrics.ts` with tests in `convex/learnAdaptiveMetrics.test.ts`; Epic 6 may extend operational metrics but cannot redefine this denominator.

## Epic 2: Start learning immediately from a real need

Epic 2 owns the initial learner-visible thread aggregate, minimal Canvas, and base Home/Thread shell. It uses a deterministic Phase-1 fixed continuation so it is independently useful before Epic 3 adds adaptive routing, replay, and experiment controls; Epic 4 only extends these base surfaces for durable resume and memory.

### Story 2.1: Create a need-first learning draft

**Slice:** 1

As a learner,
I want to describe what I need to understand or do in my own words,
So that I can start learning without building a course first.

**Coverage:** FR-001, FR-007; AD-5, AD-11; UX-DR-008, UX-DR-016.

**Acceptance Criteria:**

**Given** I provide a goal/question with optional folder, document, URL, pasted material, or no material
**When** I submit the composer
**Then** a valid server-owned thread draft is created without requiring curriculum, rubric, schedule, or Calendar setup.

**Given** I submit the draft
**When** it is persisted
**Then** the original wording, source scope, evidence state, outcome, and lifecycle state are retained.

**Given** the base thread anchor from Story 1.2 is available
**When** this learner draft is created
**Then** this story owns the initial draft/create lifecycle command and base thread projection, without adding a second thread entity or durable resume/memory extensions.

**Given** required input is missing or malformed
**When** I attempt to start
**Then** inline non-destructive validation explains the smallest correction and preserves entered content.

### Story 2.2: Ask at most one high-value clarification

**Slice:** 1

As a learner,
I want Budds to clarify only what materially changes my next activity,
So that starting feels fast and respectful.

**Coverage:** FR-002, FR-004, FR-005; UX-DR-008, UX-DR-018.

**Acceptance Criteria:**

**Given** the draft lacks one decision necessary to choose a useful first move
**When** the thread is prepared
**Then** at most one bounded clarification is shown and my original wording remains visible.

**Given** no clarification is high-value
**When** preparation completes
**Then** the deterministic Phase-1 fixed continuation proceeds directly to a first activity using only the declared draft, intent, and source/evidence state.

**Given** I answer or skip the clarification
**When** the thread starts
**Then** the answer/skip is recorded as learner input, no second clarification interrupts first value, and the same pinned inputs select the same fixed continuation.

### Story 2.3: Select and change one of six learning intents

**Slice:** 1

As a learner,
I want to choose or change whether I understand, prepare, build/solve, master, refresh, or explore,
So that the activity fits my actual need.

**Coverage:** FR-003; UX-DR-008, UX-DR-018, UX-DR-030.

**Acceptance Criteria:**

**Given** a thread draft is open
**When** I choose an intent chip
**Then** exactly one supported intent is selected and the selection is persisted.

**Given** a thread contains prior work
**When** I change intent
**Then** prior attempts, artifacts, evidence, and wording remain intact.

**Given** the selected intent changes
**When** the next activity is composed
**Then** the Phase-1 fixed continuation uses the new intent for the next activity without silently rewriting mastery claims; the versioned router is an additive Slice-2 implementation over this stable input contract.

### Story 2.4: Reach meaningful first value with the Phase-1 Canvas within the ready-content SLA

**Slice:** 1

As a learner,
I want a useful activity quickly after starting,
So that learning begins before I lose momentum.

**Coverage:** FR-004, FR-006; AD-5, AD-8; UX-DR-007, UX-DR-010.

**Acceptance Criteria:**

**Given** I am eligible and ready content exists
**When** I initiate learning
**Then** the fixed continuation creates a server-authorized meaningful activity and the minimal Canvas renders its validated primitive or deterministic fallback within 90 seconds for the eligible pilot path.

**And** the pilot query counts at least 70% of eligible ready-content sessions, where eligibility means access granted and accepted unpurged evidence plus published content or a valid standalone non-factual activity at `thread_command_committed.v1`; preparation, blocked, outline, schedule, and explicit-exclusion sessions are separate or excluded by a recorded code.

**And** the query and frozen denominator are the Slice-0 contract from Story
1.9; Story 6.2 may add operational readouts but may not redefine this gate.

**And** the first-value timer starts at authoritative `thread_command_committed.v1` and stops only at server-authorized `meaningful_activity_started.v1`.

**Given** a ready existing V2 session is available
**When** I choose to continue it
**Then** it starts directly inside the adaptive thread without a workspace handoff.

**Given** the system is still preparing
**When** the preparation view renders
**Then** it does not count loading, an outline, or a schedule as first value and exposes an actionable status.

**Given** the minimal Canvas receives a validated plan or fallback contract
**When** it renders the first activity
**Then** it preserves one active response boundary, exposes the required action and status, and never evaluates generated content as executable UI or a mutation/tool request.

### Story 2.5: Provide useful preparing and blocked recovery states

**Slice:** 1

As a learner,
I want something useful to do while evidence prepares and a clear recovery when blocked,
So that waiting does not become a dead end.

**Coverage:** FR-005; AD-5, AD-17; UX-DR-015, UX-DR-027, UX-DR-028.

**Acceptance Criteria:**

**Given** factual evidence is preparing
**When** the thread renders
**Then** it offers a non-factual diagnostic, goal-shaping, or source-selection activity.

**Given** the learner selects Refresh in Slice 1
**When** the first activity is composed
**Then** the registered `diagnostic_prompt` primitive is used; retrieval burst
remains deferred and is not exposed by the first-release flag.

**Given** evidence is blocked, stale, invalidated, or unavailable
**When** the blocked state renders
**Then** it explains the state, preserves prior response state, and offers the smallest bounded safe recovery action.

**Given** evidence becomes ready during a non-factual activity
**When** the transition is observed
**Then** the activity remains stable and the thread offers the next factual move without discarding work.

### Story 2.6: Render the adaptive thread shell and next action

**Slice:** 1

As a learner,
I want one stable place to see my goal, current activity, history, and next move,
So that I always know what to do and can inspect context when needed.

**Coverage:** FR-007, FR-008; UX-DR-001, UX-DR-002, UX-DR-003, UX-DR-004, UX-DR-005, UX-DR-006, UX-DR-009, UX-DR-010, UX-DR-014, UX-DR-016.

**Acceptance Criteria:**

**Given** a thread is ready or resumed
**When** the shell renders
**Then** it shows outcome, current intent, one next meaningful action, the base Adaptive Canvas, compact history, and status; this story owns these base shell components rather than a later duplicate shell.

**Given** the thread is reloaded after any authoritative activity outcome
**When** its projection is read
**Then** it restores the Slice-1 fields: outcome, intent, source/evidence state, current activity, bounded history, and status without rewriting append-only history; optional artifact, performance, unresolved-point, preference, and durable next-action fields are absent-safe until Epic 4 extends the projection.

**Given** I open evidence, path/schedule, or memory controls
**When** a drawer opens and closes
**Then** the active response, activity ID, selection, and scroll anchor are preserved and focus returns to the invoking control.

**Given** the Evidence drawer opens for accepted, insufficient, conflicting, stale, deleted, or unavailable evidence
**When** it renders the Story 1.4 projection
**Then** it shows origin, permitted locator, revision identity, and integrity status without presenting snippets or model memory as evidence.

**Given** the thread is loading, denied, rolled back, offline-saved, or syncing
**When** the shell renders
**Then** it uses the state-specific accessible status and exposes only permitted actions.

### Story 2.7: Record bounded learner controls and explain the next activity

**Slice:** 1

As a learner,
I want to shape format, support, difficulty, practicality, examples, source comparison, answer timing, and available time,
So that the next activity reflects my constraints without becoming an unbounded configuration task.

**Coverage:** FR-013, FR-014; UX-DR-012, UX-DR-015.

**Acceptance Criteria:**

**Given** an activity offers a supported override
**When** I select it
**Then** the selected option and its source are recorded as learner input and the deterministic Phase-1 fixed continuation produces only a bounded next plan; replayable routing consumes this recorded input in its own Slice-2 story.

**Given** an activity is recommended
**When** I open “Why this?”
**Then** the persisted plain-language purpose/reason and a bounded override path are shown.

**Given** an override is unavailable because of evidence, mastery, state, or policy
**When** I open controls
**Then** the option is disabled with an explanation and no invalid plan is sent.

### Story 2.8: Complete a representative task with V1/V2 coexistence

**Slice:** 1

As a learner,
I want to finish with something I can do, make, or use,
So that an explanation becomes practical value and existing learning routes remain safe.

**Coverage:** FR-015, FR-029, FR-030; AD-2, AD-5, AD-8; UX-DR-017, UX-DR-024, UX-DR-025.

**Acceptance Criteria:**

**Given** a meaningful loop reaches completion
**When** I submit the representative task or save the useful artifact
**Then** the thread records the outcome and next move; direct explanation alone does not imply mastery.

**Given** an existing V2 mission/session can be referenced
**When** the adaptive thread is created
**Then** it stores a copy-only reference to the immutable V2 identity without duplicating authority or inferring evidence, mastery, or schedule.

**Given** adaptive access is disabled or rolled back
**When** I open a legacy V1/V2 route
**Then** the existing route remains reachable and usable with no data loss, and adaptive-only controls are hidden or safely handed off.

### Story 2.9: Persist bounded thread artifacts and cleanup

**Slice:** 1

As a learner,
I want a useful artifact saved safely,
So that I can return to it without coupling artifact storage to attempt authority.

**Coverage:** FR-007, FR-015, FR-026, FR-028; AD-5, AD-10, AD-13; UX-DR-024.

**Acceptance Criteria:**

**Given** a useful artifact is first saved
**When** its writer is added
**Then** this story adds the normalized `learningThreadArtifacts` manifest entry, owner/thread indexes, bounded export/deletion traversal, opaque object reference, and idempotent R2-before-local cleanup defined in `implementation-contracts.md`.

**Given** an artifact is edited, saved, deleted, or retried
**When** the command commits
**Then** it uses the typed result/receipt contract, preserves the activity/attempt history, and never creates a mastery transition.

**Given** owner, folder, source, or account deletion runs
**When** cleanup traverses artifacts
**Then** it is bounded, child-before-parent, resumable, and leaves no orphaned R2 object or local row.

## Epic 3: Receive and control the next best move

Learners receive one deterministic, explainable next activity from pinned state, can override it safely, and retain replayable decisions through fallback, recovery, and controlled experimentation.

### Story 3.1: Implement the versioned adaptive-routing contract

**Slice:** 2
**Coverage:** FR-022; NFR-002, NFR-009; AD-7, AD-14; UX-DR-010, UX-DR-015

As a learner,
I want Budds to select my next activity from my pinned learning state,
So that the recommendation is consistent, relevant, and safe to replay.

**Acceptance Criteria:**

**Given** valid pinned intent, source state, prior activity outcome, assistance, confidence calibration, available time, explicitly allowed thread state, and router version
**When** the pure router evaluates the input
**Then** it returns exactly one recommended activity, reason code, bounded overrides, and fallback outcome.

**Given** identical canonical inputs
**When** the router runs repeatedly
**Then** it returns byte-equivalent output, reads no mutable current state, and never uses clicks or time-on-page to raise mastery.

**Given** unsupported intent, activity, evidence, or mastery combinations
**When** routing is evaluated
**Then** it returns deterministic fallback/blocked output and fixtures prove assisted work cannot become independent or retained.

### Story 3.2: Persist replayable routing decisions

**Slice:** 2
**Coverage:** FR-023; NFR-001, NFR-002, NFR-009; AD-1, AD-7, AD-10, AD-16; UX-DR-015

As a learner,
I want Budds to retain why it selected an activity,
So that I can understand, recover, and replay the decision without relying on changed state.

**Acceptance Criteria:**

**Given** a server-authorized routing result
**When** the decision command commits
**Then** Convex persists router/versioned event data, bounded canonical `inputSnapshot`, SHA-256 `inputDigest`, selected activity, reason, fallback, and thread/activity identity.

**Given** routing decisions are first persisted
**When** their writer is added
**Then** this story adds the `learnActivityDecisions` manifest entry, owner/thread/time indexes, bounded export/deletion traversal, and replay fixture coverage.

**Given** the same user-scoped idempotency key and target revision are retried
**When** Convex receives the command
**Then** it returns the original result without duplicate decisions, attempts, or events; replay uses the stored snapshot after thread state changes.

**Given** a client supplies score, mastery, evidence acceptance, or unbounded decision input
**When** validation runs
**Then** the command is rejected without mutation or misleading success telemetry.

### Story 3.3: Apply safe overrides at activity boundaries

**Slice:** 2
**Coverage:** FR-013, FR-014, FR-022, FR-023; NFR-001, NFR-003, NFR-007; AD-4, AD-7, AD-11; UX-DR-010, UX-DR-012, UX-DR-028

As a learner,
I want to change how the next activity is presented,
So that I can choose appropriate support without rewriting history or mastery.

**Acceptance Criteria:**

**Given** a ready activity and bounded override
**When** the learner selects an override such as example, quiz, compare sources, practical framing, difficulty, answer-now, or available time
**Then** the input and reason are recorded and a new decision is created only for the next activity boundary.

**Given** an active response
**When** an override is selected
**Then** the current response, activity ID, selected source, and scroll position remain unchanged until the boundary transition; assistance cannot promote the result beyond guided.

**Given** unsupported evidence, unsafe URL, unknown primitive, or unavailable provider
**When** an override is requested
**Then** the current response is preserved and deterministic fallback or the smallest safe recovery action is shown.

### Story 3.4: Extend the base Canvas with explainable routed state and deterministic recovery

**Slice:** 2
**Coverage:** FR-009–014, FR-022–023; NFR-003–005, NFR-007; AD-4, AD-6, AD-7, AD-9, AD-11; UX-DR-010, UX-DR-011, UX-DR-015, UX-DR-026–034

As a learner,
I want each recommended activity to explain its purpose and recover clearly when something fails,
So that I can continue safely without losing my response or receiving unsupported claims.

**Acceptance Criteria:**

**Given** the Epic 2 base Canvas receives a routed server-validated plan
**When** it renders it
**Then** this story extends the existing surface with the routed “Why this?” reason, bounded override controls, and routed evidence scope without replacing its boundary or response-preservation behavior.

**Given** unknown primitive, invalid props/action, unsafe URL, invalid evidence link, oversized content, or generated executable content
**When** the client receives the plan
**Then** it rejects the unsafe portion, renders deterministic text/card fallback, and emits a versioned failure event.

**Given** preparing, blocked, stale, invalidated, timeout, ambiguous, offline, or rollback state
**When** the state is shown on desktop or mobile
**Then** it uses the required status/alert role, plain-language copy, preserved draft, focus/keyboard behavior, and smallest safe recovery action.

### Story 3.5: Implement the seven primitive renderers and state contracts

**Slice:** 2

As a learner,
I want each approved activity type to have a bounded renderer,
So that routed content remains useful and safe on every supported device.

**Coverage:** FR-009–012, FR-015; NFR-003–005, NFR-007; AD-4, AD-11; UX-DR-019, UX-DR-020, UX-DR-021, UX-DR-022, UX-DR-023, UX-DR-024, UX-DR-025, UX-DR-026.

**Acceptance Criteria:**

**Given** a validated plan names one of the seven registered primitives
**When** its renderer mounts
**Then** it implements the contract-defined ready, completed, mobile, and deterministic text/card fallback states with one primary action and no generated executable UI.

**Given** factual claims, evidence links, or an independent response are present
**When** the primitive renders
**Then** it consumes only the projection from `shared/adaptive-claim-adapter.ts`, preserves response state across drawers/resizes, and cannot create score/mastery authority in the browser.

**Given** a primitive receives unknown props/action, unsafe URL, invalid evidence, or oversized content
**When** validation fails
**Then** only the bounded fallback renders and the typed failure event is emitted.

### Story 3.6: Verify routed Canvas recovery and accessibility states

**Slice:** 2
**Coverage:** FR-009–014, FR-022–023; NFR-003–005, NFR-007; AD-4, AD-6, AD-7, AD-9, AD-11; UX-DR-015, UX-DR-026–034

As a learning-platform engineer,
I want routed Canvas recovery and accessibility states verified independently,
So that failures preserve learner work and every supported surface remains operable.

**Acceptance Criteria:**

**Given** a routed activity is preparing, blocked, stale, invalidated, timed out, ambiguous, offline, or rolled back
**When** the state is rendered on desktop, tablet, or mobile
**Then** the correct status/alert role, copy, focus behavior, keyboard order, preserved draft, and smallest safe recovery action are asserted without replacing the base Canvas boundary.

**Given** accessibility automation runs against each of the seven primitive state matrices
**When** it checks labels, landmarks, announcements, reduced motion, forced colors, reflow, target size, and keyboard inset
**Then** all assertions pass and no unsupported evidence or mastery claim is presented.

### Story 3.7: Freeze and instrument the adaptive-routing experiment

**Slice:** 2
**Coverage:** FR-035, FR-023; NFR-006, NFR-009, NFR-010; AD-7, AD-8; UX-DR-007, UX-DR-015, UX-DR-041

As a product owner,
I want a pre-registered adaptive-routing experiment with reproducible guardrails,
So that adaptive routing is judged by capability and usefulness rather than engagement proxies.

**Acceptance Criteria:**

**Given** the experiment is prepared
**When** `adaptive-routing-analysis.v1` is created
**Then** it freezes fixed continuation, primary representative-task outcome, eligibility/denominator, baseline, minimum effect, sample/stop rule, confidence rule, accessibility/recovery guardrails, owners, and rollback trigger.

**Given** an eligible user and experiment event
**When** assignment and telemetry occur
**Then** server-owned assignment is stable, missing safety prerequisites exclude the user, and events carry cohort/eligibility/exclusion/contract versions without raw answers, source payloads, private locators, or provider payloads.

**Given** an accessibility-completion or recovery-success guardrail degrades by more than three percentage points
**When** the guardrail evaluator runs
**Then** the cohort is non-qualifying and the rollback trigger is emitted independently of the primary outcome.

### Story 3.8: Gate exposure and preserve rollback safety

**Slice:** 2
**Coverage:** FR-023, FR-035; NFR-001, NFR-007, NFR-010, NFR-011; AD-1, AD-2, AD-8, AD-10; UX-DR-015, UX-DR-017, UX-DR-027, UX-DR-028

As a learner,
I want adaptive routing to be reversible without losing my work,
So that a failed experiment or disabled flag returns me to a usable existing Learn experience.

**Acceptance Criteria:**

**Given** the product flag, V2 entitlement, and adaptive entitlement are not all enabled
**When** the learner opens Learn or invokes an adaptive command
**Then** server-side access is denied and the expected V1/V2 route is returned.

**Given** adaptive access is disabled after decisions or responses exist
**When** the learner returns or retries a command
**Then** evidence, attempts, plans, drafts, decisions, and source origin remain intact, retries are idempotent, and the learner receives a named current-V2 route without duplicate events or mastery changes.

## Epic 4: Resume meaningful progress over time

Learners can leave and return to the Epic 2 base thread, recover unresolved points and artifacts, control saved memory, and optionally promote work into review or mastery without rewriting authoritative history. This epic adds durable projections and views; it does not recreate the base thread, artifact storage, Canvas, or shell.

### Story 4.1: Extend the base thread with durable lifecycle transitions

**Slice:** 3
**Coverage:** FR-026, FR-007; NFR-001, NFR-007, NFR-010; AD-1, AD-2, AD-5, AD-10, AD-13; UX-DR-009, UX-DR-016, UX-DR-028

As a learner,
I want my learning thread to survive leaving, ending, and returning,
So that my work remains available without replacing V1 or V2 authority.

**Acceptance Criteria:**

**Given** an Epic 2 base thread exists
**When** the learner leaves, resumes, or explicitly ends it
**Then** Convex extends its base lifecycle with durable transition state, owner/revision checks, timestamp, and idempotency receipt without recreating the draft/create command.

**Given** an existing V2 mission/session reference from Story 2.8 exists
**When** a durable lifecycle transition runs
**Then** it preserves immutable copy-only V2 IDs and never infers mastery, evidence acceptance, or schedules.

**Given** a duplicate durable-lifecycle command or stale revision
**When** the command runs
**Then** stale writes are rejected and retries are idempotent; existing manifest-driven deletion and source-purge paths retain their established maintenance authority.

### Story 4.2: Add durable unresolved-point and next-action projections

**Slice:** 3
**Coverage:** FR-026–027, FR-007; NFR-001, NFR-004, NFR-007, NFR-008; AD-5, AD-6, AD-10, AD-16, AD-17; UX-DR-009, UX-DR-014, UX-DR-015, UX-DR-024, UX-DR-028

As a learner,
I want Budds to save what changed, what remains unresolved, and useful artifacts,
So that returning to the thread restores meaningful work rather than a generic page.

**Acceptance Criteria:**

**Given** a completed, failed, assisted, or ended activity
**When** the outcome commits
**Then** history is appended and unresolved point/next action are updated without rewriting attempts or feedback.

**Given** an existing Story 2.9 artifact is created, edited, saved, or deleted
**When** its durable thread projection updates
**Then** this story adds only the bounded unresolved-point/next-action reference needed for resume and preserves the existing normalized storage and R2-before-local cleanup contract.

**Given** an activity becomes stale or evidence-invalidated
**When** the projection updates
**Then** the unresolved point remains visible, factual continuation is blocked or safely replaced, and allowed non-factual recovery remains available.

### Story 4.3: Select and present a meaningful resume target

**Slice:** 3
**Coverage:** FR-027, FR-026; NFR-002, NFR-005, NFR-006, NFR-010; AD-5, AD-7, AD-10, AD-11; UX-DR-007, UX-DR-014, UX-DR-016, UX-DR-027, UX-DR-028, UX-DR-031

As a returning learner,
I want Resume to open the most useful unfinished point,
So that I can continue without restating context or being driven by streaks.

**Acceptance Criteria:**

**Given** active threads, unfinished activities, vulnerable capabilities, and source changes
**When** the resume projection is computed
**Then** unfinished value, vulnerable knowledge, and meaningful source changes outrank generic recency or streak signals.

**Given** a resumable thread
**When** the learner opens it
**Then** goal/outcome, intent, evidence state, attempt context, unresolved point, artifact, next action, and valid activity boundary are restored.

**Given** stale revisions, invalidated evidence, or rollback
**When** the learner resumes
**Then** deterministic fallback/recovery is shown, historical context is preserved, and no unsupported submission or mastery change occurs.

### Story 4.4: Implement learner-visible memory controls

**Slice:** 3
**Coverage:** FR-028, FR-026; NFR-001, NFR-004, NFR-008, NFR-010; AD-1, AD-5, AD-6, AD-10, AD-17; UX-DR-014, UX-DR-015, UX-DR-029–034

As a learner,
I want to view, correct, delete, or disable saved preferences and artifacts,
So that I control what Budds remembers without rewriting authoritative history.

**Acceptance Criteria:**

**Given** thread memory contains preferences, artifacts, performances, unresolved points, or optional review state
**When** the Memory drawer opens
**Then** editable memory is clearly separated from immutable attempts, scores, evidence decisions, and mastery history.

**Given** a learner corrects/disables a preference or deletes an artifact
**When** the server command commits
**Then** only the permitted projection/object is changed, cleanup is idempotent, and historical attempts retain only allowed metadata.

**Given** unauthorized ownership or stale revision
**When** a memory command is received
**Then** Convex rejects it without mutation and the UI preserves the view with actionable recovery.

**Given** keyboard-only, screen-reader, reduced-motion, forced-colors, zoom, or mobile-Sheet use
**When** memory controls are operated
**Then** labels, focus trap/restoration, announcements, target sizes, and non-color state semantics pass accessibility assertions.

### Story 4.5: Offer optional review/mastery promotion without inference

**Slice:** 3
**Coverage:** FR-026–028, FR-024–025; NFR-001, NFR-002, NFR-004, NFR-007; AD-3, AD-5, AD-6, AD-14, AD-17; UX-DR-014, UX-DR-018, UX-DR-021–025, UX-DR-027

As a learner,
I want to opt into review or mastery after meaningful work,
So that durable learning is available without forcing mastery mechanics onto immediate or exploratory threads.

**Acceptance Criteria:**

**Given** a representative performance or useful artifact exists
**When** the learner opts into review or mastery
**Then** the system creates an explicit pinned proposal without inferring mastery, retention, or a schedule.

**Given** the thread is non-mastery intent or the learner does not opt in
**When** the thread continues or ends
**Then** no mastery attempt, schedule, or mastery claim is created.

**Given** assistance was used or a delayed check is evaluated
**When** the state transition runs with injectable UTC/IANA/DST-aware time
**Then** assistance cannot exceed guided, retained requires an unassisted transfer pass at least seven calendar days later, and failure enters auditable remediation without erasing history.

### Story 4.6: Extend the base shell with accessible durable-thread views

**Slice:** 3
**Coverage:** FR-026–028; NFR-005, NFR-007, NFR-010; AD-5, AD-8, AD-11; UX-DR-007, UX-DR-009, UX-DR-014, UX-DR-016, UX-DR-026, UX-DR-027, UX-DR-028, UX-DR-029, UX-DR-030, UX-DR-031, UX-DR-032, UX-DR-033, UX-DR-034, UX-DR-035, UX-DR-036, UX-DR-037, UX-DR-038, UX-DR-039, UX-DR-040, UX-DR-041

As a learner,
I want a stable Home and Thread shell for returning to work,
So that resume, memory, recovery, and optional review remain understandable across devices.

**Acceptance Criteria:**

**Given** access is loading, denied, ready, rolled back, or Home has no threads
**When** `/app/learn` renders
**Then** it extends the Epic 2 base Home shell with durable states while preserving the composer and named legacy V1/V2 routes.

**Given** a resumable thread exists
**When** Home renders
**Then** Resume shows outcome, unresolved point, promised payoff, and Continue; Worth revisiting appears only for an eligible capability.

**Given** Evidence, Memory, Path, or recovery context opens on desktop, tablet, or mobile
**When** the drawer/Sheet opens and closes
**Then** the existing base drawer/Sheet preserves response state, focus is trapped/restored, Escape works, and the durable context adds the required live/alert copy without replacing shared shell components.

### Story 4.7: Verify durable-thread responsive accessibility coverage

**Slice:** 3
**Coverage:** FR-026–028; NFR-005, NFR-007, NFR-010; AD-5, AD-8, AD-11; UX-DR-026, UX-DR-027, UX-DR-028, UX-DR-029, UX-DR-030, UX-DR-031, UX-DR-032, UX-DR-033, UX-DR-034, UX-DR-035, UX-DR-036, UX-DR-037, UX-DR-038, UX-DR-039, UX-DR-040, UX-DR-041

As a learning-platform engineer,
I want durable Home/Thread accessibility and responsive behavior tested separately from shell assembly,
So that cross-device regressions are caught without coupling operational memory work to UI implementation.

**Acceptance Criteria:**

**Given** the Epic 4 shell is mounted at desktop, tablet, and mobile widths
**When** drawers/Sheets, rotation, resize, keyboard inset, and rollback states are exercised
**Then** the response draft, activity ID, selected source, scroll anchor, focus restoration, live/alert semantics, and 44px targets remain valid.

**Given** the accessibility matrix runs
**When** it checks landmarks, heading order, keyboard traversal, reduced motion, forced colors, enhanced contrast, reflow, and draft preservation
**Then** every assertion passes without color, streaks, or unsupported mastery claims as the sole signal.

## Epic 5: Carry learning across Budds features

### Story 5.1: Define the cross-feature contribution contract

**Slice:** 4

As a learner,
I want useful context from Chat, Quiz, Flashcards, Podcast, and documents to be attachable to my learning thread,
So that Budds can reuse prior work without losing its origin.

**Coverage/provenance:** FR-031; NFR-001, NFR-004, NFR-008, NFR-010; AD-5, AD-6, AD-10, AD-16; UX-DR-009, UX-DR-013, UX-DR-014, UX-DR-026.

**Acceptance Criteria:**

**Given** a supported feature submits a contribution
**When** the server validates it
**Then** Convex verifies ownership, thread access, contribution type, bounded payload, source record/revision, and idempotency before persistence.

**Given** a valid contribution contains factual material
**When** it is stored
**Then** it references accepted evidence or is explicitly labeled synthesis, inference, unknown, or non-factual; model memory and search snippets cannot become evidence.

**Given** a contribution is foreign, deleted, oversized, or unsupported
**When** it is submitted
**Then** it is rejected without thread mutation and returns a bounded recovery state.

**Metrics/evidence:** Emit versioned cross-feature contribution-recorded and rejection events; test ownership, provenance completeness, redaction, idempotency, export, and deletion fixtures.

### Story 5.2: Persist normalized provenance records

**Slice:** 4

As an operator,
I want cross-feature contributions normalized under owner and thread boundaries,
So that they can be queried, exported, deleted, and audited without unbounded or duplicate state.

**Coverage/provenance:** FR-031–032; NFR-001, NFR-007–010; AD-10, AD-13, AD-16; UX-DR-014, UX-DR-015, UX-DR-027–028.

**Acceptance Criteria:**

**Given** a contract-valid contribution
**When** persistence completes
**Then** the record stores owner/thread indexes, source feature, source identity/revision, contribution kind, provenance version, and bounded timestamps/metadata while excluding raw answers and private source payloads.

**Given** the contribution writer is introduced
**When** its table is added
**Then** this story adds the `learningThreadContributions` manifest entry with its canonical provenance identity, owner/thread/time and owner/provenance indexes, bounded redacted export, owner/thread child deletion, and source-purge retention behavior before any contribution is persisted.

**Given** export, account deletion, folder deletion, or source purge runs
**When** it traverses contribution records
**Then** traversal is owner-scoped and bounded, source-origin metadata follows the documented retention/deletion contract, and protected content is not exposed.

**Given** the same source contribution is retried
**When** its idempotency key or canonical source identity matches
**Then** the existing record is returned and no duplicate contribution is created.

**Metrics/evidence:** Prove bounded pagination, export/deletion completeness, source-purge behavior, and zero duplicate contribution identities using deterministic fixtures.

### Story 5.3: Convert contributions into attributed activities

**Slice:** 4

As a learner,
I want a useful contribution to become a clearly attributed next activity,
So that cross-feature context improves my next learning action without inventing authority.

**Coverage/provenance:** FR-031–032; NFR-001–004, NFR-007, NFR-009; AD-5, AD-6, AD-7, AD-14, AD-16; UX-DR-010, UX-DR-013, UX-DR-015, UX-DR-026–028.

**Acceptance Criteria:**

**Given** a valid contribution and eligible thread boundary
**When** the server converts it
**Then** it creates a new immutable activity identity/boundary with source origin, plan/revision identity, activity class, and replacement relationship where applicable.

**Given** the contribution has no qualifying independent assessment
**When** the activity is created
**Then** it may provide context or practice but cannot raise mastery, imply retention, or overwrite historical attempts.

**Given** required source evidence is stale, conflicting, deleted, or unavailable
**When** the activity is selected
**Then** factual activity is blocked or replaced by safe recovery, and the original provenance/integrity state remains visible.

**Metrics/evidence:** Emit cross-feature-activity-created and blocked/invalidation events; verify accepted evidence links, immutable activity identity, and no unsupported factual activity.

### Story 5.4: Deduplicate cross-feature attempts and outcomes

**Slice:** 4

As a learner,
I want repeated cross-feature actions to resolve to one attempt,
So that retries do not duplicate scores, feedback, or mastery transitions.

**Coverage/provenance:** FR-032; NFR-001, NFR-002, NFR-007, NFR-009; AD-1, AD-3, AD-7, AD-14, AD-16; UX-DR-010, UX-DR-015, UX-DR-028.

**Acceptance Criteria:**

**Given** an activity conversion or submission is retried after timeout
**When** the server receives the same scoped idempotency request
**Then** it returns the existing receipt/result and creates no second attempt, score, event, or mastery transition.

**Given** two source features refer to the same underlying activity
**When** the server reconciles their identities
**Then** it preserves each source origin while mapping to one authoritative attempt boundary.

**Given** a provider outcome is ambiguous
**When** reconciliation is pending
**Then** the attempt remains blocked/reconciling, cannot count as success or mastery, and the learner sees bounded recovery.

**Metrics/evidence:** Assert zero duplicate-authority events, zero silent mastery increments, and complete reconciliation keys in the frozen test corpus.

### Story 5.5: Define cross-feature provenance analysis contract

**Slice:** 4

As a product/data operator,
I want cross-feature outcomes measured from an approved frozen corpus,
So that exposure occurs only when the next action improves without provenance or authority regressions.

**Coverage/provenance:** FR-031–032, FR-034; NFR-002, NFR-004, NFR-009, NFR-010; AD-7, AD-8, AD-10, AD-16; UX-DR-013, UX-DR-014, UX-DR-027–028, UX-DR-041.

**Acceptance Criteria:**

**Given** contribution, activity, attempt, mastery, and source-origin events
**When** cross-feature-provenance-analysis.v1 is generated
**Then** it freezes eligible contribution types, next-action metric, denominator, minimum practical effect, corpus size, duplicate-attempt test, silent-mastery assertion, owner, approver, and verifier.

### Story 5.6: Freeze and approve cross-feature provenance analysis

**Slice:** 4

As a product/data operator,
I want the cross-feature analysis artifact frozen and approved independently,
So that exposure decisions use a reproducible corpus and denominator.

**Coverage/provenance:** FR-031–032, FR-034; NFR-002, NFR-004, NFR-009; AD-7, AD-10, AD-16.

**Acceptance Criteria:**

**Given** contribution, activity, attempt, mastery, and source-origin fixtures exist
**When** `cross-feature-provenance-analysis.v1` is generated
**Then** it freezes eligible contribution types, next-action metric, denominator, practical-effect threshold, corpus size, duplicate-attempt test, silent-mastery assertion, owner, approver, and verifier.

**Given** the artifact is absent, unapproved, or not reproducible from the frozen corpus
**When** approval is requested
**Then** approval fails with an actionable reason and no exposure decision is emitted.

### Story 5.7: Enforce approved cross-feature exposure and rollback

**Slice:** 4

As a product/data operator,
I want only an approved provenance artifact to control runtime exposure,
So that cross-feature reuse cannot bypass authority or source-origin safeguards.

**Coverage/provenance:** FR-031–032; NFR-001, NFR-007, NFR-010; AD-8, AD-10, AD-16.

**Acceptance Criteria:**

**Given** the approved analysis artifact is present and zero-violation assertions pass
**When** exposure is requested
**Then** the server gate admits only the approved cohort and records the artifact/version.

**Given** a zero-violation assertion fails or exposure is rolled back
**When** the cohort flag is disabled
**Then** no new conversion is admitted, accepted evidence/attempts/mastery/provenance remain readable, and V1/V2 routes remain available.

**Metrics/evidence:** Report next-action improvement separately from duplicate attempts, silent mastery, hidden origin, accessibility completion, recovery success, latency, and support contacts.

## Epic 6: Measure, operate, and safely expand Adaptive Learn

### Story 6.1: Operate and retain the versioned semantic event ledger

**Slice:** 5

As an operator,
I want the foundational event ledger retained, audited, and operationally verified,
So that behavior, safety, and rollback can be assessed without reimplementing event writers or retaining sensitive content.

**Coverage/provenance:** FR-033; NFR-001, NFR-007–009; AD-1, AD-7, AD-10, AD-16, AD-17; UX-DR-007, UX-DR-009, UX-DR-015, UX-DR-027–028.

**Acceptance Criteria:**

**Given** the Story 1.9 event ledger is operating
**When** its retention and operational checks run
**Then** the existing closed-taxonomy events are verified for one-per-boundary idempotency, redaction, bounded pagination, export/deletion, invalidation, timeout, ambiguity, and rollback fixtures.

**Given** operational events reach their retention boundary
**When** the maintenance job runs
**Then** it purges them in bounded owner-scoped batches after 90 days without changing event taxonomy, writers, or metric definitions.

**Metrics/evidence:** Validate taxonomy, duplicate suppression, redaction, bounded pagination, export/deletion, invalidation, timeout, ambiguity, and rollback fixtures; purge operational events in bounded owner-scoped batches after 90 days.

### Story 6.2: Publish reproducible metric definitions

**Slice:** 5

As a product analyst,
I want every Adaptive Learn metric to have an immutable definition and query,
So that decisions cannot change through denominator drift or mastery proxies.

**Coverage/provenance:** FR-034; NFR-002, NFR-006, NFR-009; AD-7, AD-10; UX-DR-007, UX-DR-015, UX-DR-027.

**Acceptance Criteria:**

**Given** a metric is published
**When** its definition is stored
**Then** it includes version, event source, eligibility, numerator, denominator, time window, exclusions, query/fixture identity, owner, and approval state.

**Given** first-value measurement is calculated
**When** the query runs
**Then** timing starts at thread_command_committed.v1 and stops only at server-authorized meaningful_activity_started.v1; ready-content and preparing denominators remain separate.

**And** the release gate fails unless at least 70% of eligible ready-content sessions reach the event by 90 seconds, with the denominator and every exclusion code reproducible from frozen fixtures.

**Given** seven-day retention is calculated
**When** eligible capabilities are selected
**Then** only capabilities eligible for a delayed unassisted check are included with clock and delayed-check evidence.

**Given** clicks, time-on-page, confidence, generated-content views, DAU, streaks, or completion percentages are present
**When** mastery metrics are computed
**Then** none can qualify as mastery or retention evidence.

**Metrics/evidence:** Re-run queries against frozen fixtures for identical results; publish first-value, meaningful-loop, usefulness, retention, cross-feature, accessibility, recovery, cost, latency, fallback, ambiguity, and support countermetrics.

### Story 6.3: Enforce finite activation and provider controls

**Slice:** 5

As an activation owner,
I want finite default-deny performance, cost, quota, and provider controls enforced at runtime,
So that Adaptive Learn cannot expand beyond tested safety and budget boundaries.

**Coverage/provenance:** FR-036; NFR-003, NFR-005–009, NFR-011; AD-8, AD-9, AD-12, AD-15, AD-16; UX-DR-015, UX-DR-027–034, UX-DR-041.

**Acceptance Criteria:**

**Given** an activation manifest is loaded
**When** configuration is validated
**Then** byte/token limits, timeout, concurrency, retry, quota, cost ceiling, provider/model/policy identity, cohort, and rollback owner are finite and versioned; missing/malformed values fail closed.

**Given** provider work is admitted
**When** dispatch begins
**Then** quota is reserved, dispatch is recorded before I/O, payloads are minimized/redacted, timeouts and leases are bounded, and post-dispatch ambiguity blocks automatic replay.

**Given** a cap is exceeded or budget is denied
**When** a provider request is attempted
**Then** no unsafe dispatch occurs and the learner receives bounded recovery while accepted state is preserved.

**Metrics/evidence:** Exercise bounded-payload, timeout, quota, redacted-log, unsafe-URL, accessibility, forced-color, reduced-motion, and ambiguity fixtures; alert/review above 1% ambiguity or 5% budget denial among eligible starts.

### Story 6.4: Generate the versioned deployment evidence bundle

**Slice:** 5

As a release owner,
I want a complete, versioned release evidence bundle,
So that cohort expansion is based on hosted, accessibility, security, and provider evidence rather than local tests alone.

**Coverage/provenance:** FR-036; NFR-005–011; AD-8, AD-9, AD-12, AD-15; UX-DR-007, UX-DR-016–017, UX-DR-027–034, UX-DR-041.

**Acceptance Criteria:**

**Artifact/process owner:** the release-evidence generator and schema live in
`scripts/adaptive-learn-release-evidence.mjs` and
`docs/operations/adaptive-learn-release-evidence.v1.json`; this story owns
deterministic assembly only, not live approval or rollout decisions.

**Given** a release candidate is proposed
**When** the evidence bundle is assembled
**Then** it names tested SHA, release/flag/rollback/support owners, hosted gate evidence, provider quota/configuration evidence, keyboard and screen-reader smoke evidence, WCAG 2.2 AA result, security review result, and known exclusions.

**Given** deterministic local tests pass but live provider, hosted gate, or assistive-technology evidence is absent
**When** activation is reviewed
**Then** the release remains denied and the missing evidence is explicitly recorded.

**Given** a release changes schemas, event versions, or provider policy
**When** evidence is generated
**Then** the bundle links the exact manifest, migration/export/deletion checks, and metric-definition versions used by that SHA.

**Given** the bundle generator receives incomplete or conflicting evidence inputs
**When** it builds the bundle
**Then** it records each missing/conflicting item as a known exclusion and cannot mark the release activation-ready.

**Metrics/evidence:** Verify reproducible bundle generation, exact-SHA traceability, live-vs-local separation, and no activation with unresolved authority, data-loss, or accessibility blockers.

### Story 6.5: Collect live release audits and activation approval

**Slice:** 5

As a release owner,
I want live hosted, provider, assistive-technology, and security evidence reviewed separately from bundle generation,
So that local test success cannot be mistaken for production readiness.

**Coverage/provenance:** FR-036; NFR-005–011; AD-8, AD-9, AD-12, AD-15.

**Acceptance Criteria:**

**Artifact/process owner:** live audit records are attached to the exact SHA in
`docs/operations/adaptive-learn-live-audits/` using the Story 6.4 schema;
release/support owners approve or deny the bundle through the documented
review record, while this story does not change runtime gates.

**Given** deterministic local tests pass
**When** live provider, hosted gate, assistive-technology, WCAG 2.2 AA, and security evidence are reviewed
**Then** each result is attached to the tested SHA and activation remains denied until all required evidence is present and approved.

**Given** an authority, data-loss, accessibility, provider, or security blocker remains unresolved
**When** approval is requested
**Then** the decision is denied with the blocker and owner recorded; no cohort expansion occurs.

### Story 6.6: Define staged GA rollout and rollback contract

**Slice:** 5

As a release and support owner,
I want staged activation, rollback, and support procedures,
So that GA expansion is reversible and learner and legacy data remain safe.

**Coverage/provenance:** FR-030, FR-036; NFR-001, NFR-007, NFR-009, NFR-010; AD-2, AD-8, AD-10, AD-12, AD-17; UX-DR-007, UX-DR-016–017, UX-DR-027–028, UX-DR-041.

**Acceptance Criteria:**

**Artifact/process owner:** the finite activation manifest is
`docs/operations/adaptive-learn-activation-manifest.v1.json`; the canonical
server gate remains the only runtime switch. This story owns manifest schema,
cohort steps, thresholds, and rollback triggers, not provider dispatch code.

**Given** all prior slice gates and audits are approved
**When** GA is proposed
**Then** the bundle names cohort steps, rollback triggers, finite provider quota/cost ceilings, and a minimum seven-day staged soak with no unresolved severity-1/2 authority, data-loss, or accessibility issue.

**Given** a gate failure, authority/accessibility blocker, data-loss issue, ambiguity breach, or cost/performance breach
**When** rollback triggers
**Then** the canonical server gate disables adaptive access and routes users to existing V1/V2 experiences without deleting or rewriting adaptive data.

**Given** rollback has completed
**When** reactivation is requested
**Then** it requires a new approved manifest/evidence decision and cannot silently resume previously denied provider work.

**Metrics/evidence:** Record staged progression, rollback drill, support drill, seven-day soak, no-data-loss verification, legacy-route reachability, accessibility/recovery guardrails, cost/latency/fallback/ambiguity counters, and exact deployed SHA.

### Story 6.7: Operate support and rollback drills

**Slice:** 5

As a release and support owner,
I want support and rollback procedures exercised independently from GA approval,
So that incidents preserve learner state and expose only safe recovery.

**Coverage/provenance:** FR-030, FR-036; NFR-001, NFR-007, NFR-010; AD-2, AD-8, AD-12, AD-17.

**Acceptance Criteria:**

**Artifact/process owner:** the support and rollback runbook is
`docs/operations/adaptive-learn-support-rollback.md`; drill results are
append-only records under `docs/operations/adaptive-learn-drills/` and are
linked to the tested SHA and activation manifest.

**Given** a support incident involves stale, blocked, ambiguous, invalidated, offline, or rolled-back state
**When** the runbook is followed
**Then** support identifies version/cohort/state, offers only the smallest safe recovery, preserves accepted attempts/evidence, and never exposes private payloads.

**Given** a rollback drill is executed
**When** the canonical server gate is disabled
**Then** adaptive access routes to existing V1/V2 experiences, no adaptive data is deleted or rewritten, and legacy-route reachability plus no-data-loss evidence is recorded.

### Story 6.8: Verify reactivation and staged-soak evidence

**Slice:** 5

As a release owner,
I want reactivation and staged-soak evidence to require a fresh approval,
So that previously denied provider work cannot silently resume.

**Coverage/provenance:** FR-036; NFR-009, NFR-010; AD-8, AD-12.

**Acceptance Criteria:**

**Artifact/process owner:** staged-soak and reactivation records are stored in
`docs/operations/adaptive-learn-soak/` using a versioned evidence schema;
reactivation is a fresh approval record and cannot directly resume denied jobs.

**Given** rollback has completed
**When** reactivation is requested
**Then** a new approved manifest/evidence decision is required and previously denied provider work remains blocked.

**Given** a minimum seven-day staged soak is proposed
**When** progression is reviewed
**Then** cohort steps, guardrail counters, cost/latency/fallback/ambiguity counters, exact deployed SHA, and absence of unresolved severity-1/2 authority, data-loss, or accessibility issues are recorded.
