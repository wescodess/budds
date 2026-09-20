---
status: final
date: 2026-09-20
initiative: Budds Adaptive Learn
source: epics.md
---

# Adaptive Learn implementation ticket graph

This is the publication graph for the Matt Pocock `to-tickets` handoff. It
turns the 48 requirement stories into 58 implementation tickets sized for one
fresh agent context. Only direct blockers are listed; transitive blockers are
omitted. Tickets are `ready-for-agent` unless explicitly marked otherwise.

The first implementation frontier is 1.1, 1.3, 1.4, and 1.5. Story 1.5 owns
the active-blueprint and revision-scoped-mastery repair and should be selected
first when only one ticket is being implemented.

| Ticket | Direct blockers |
| --- | --- |
| 1.1 Register and validate adaptive activity primitives | None |
| 1.2 Persist immutable activity plans and replay inputs | 1.1 |
| 1.3 Establish Convex authority and command idempotency | None |
| 1.4 Project factual claims and evidence integrity states | None |
| 1.5 Scope attempts to revisions and evaluation contracts | None |
| 1.6 Admit bounded server-scored V2 work | 1.3, 1.5 |
| 1.7 Reconcile V2 provider outcomes and controlled feedback | 1.5, 1.6 |
| 1.8 Implement explicit monotonic mastery transitions | 1.5 |
| 1.9 Emit foundational events and first-value measurement | 1.2, 1.3 |
| 2.1 Create a need-first learning draft | 1.2, 1.3, 1.9 |
| 2.2 Ask at most one high-value clarification | 2.1 |
| 2.3 Select and change one of six learning intents | 2.1 |
| 2.4a Start a ready V2 session through the Phase-1 Canvas | 1.1, 1.5, 1.9, 2.1 |
| 2.4b Measure ready-content first value and preserve response fallback | 2.4a |
| 2.5 Provide useful preparing and blocked recovery states | 1.1, 1.4, 2.1 |
| 2.6a Render the base adaptive thread projection and shell | 1.4, 2.1, 2.4a |
| 2.6b Restore routes and render evidence/status drawers | 2.5, 2.6a |
| 2.7 Record bounded learner controls and explain the next activity | 2.3, 2.6b |
| 2.8 Complete a representative task with V1/V2 coexistence | 1.3, 1.5, 2.4a |
| 2.9 Persist bounded thread artifacts and cleanup | 1.3, 2.1 |
| 3.1 Implement the versioned adaptive-routing contract | 1.5, 2.7 |
| 3.2 Persist replayable routing decisions | 1.3, 3.1 |
| 3.3 Apply safe overrides at activity boundaries | 2.7, 3.2 |
| 3.4 Extend the base Canvas with routed state and recovery | 2.6b, 3.3 |
| 3.5a Render cited explanations and worked examples | 1.1, 1.4, 3.4 |
| 3.5b Render diagnostic prompts and source comparisons | 1.1, 1.4, 3.4 |
| 3.5c Render independent applications and artifact workspaces | 1.1, 1.8, 2.9, 3.4 |
| 3.5d Render reflection and next-move activities | 1.1, 3.4 |
| 3.5e Integrate all seven primitive state contracts | 3.5a, 3.5b, 3.5c, 3.5d |
| 3.6 Verify routed Canvas recovery and accessibility states | 3.5e |
| 3.7 Freeze and instrument the adaptive-routing experiment | 1.9, 3.6 |
| 3.8 Gate exposure and preserve rollback safety | 2.8, 3.7 |
| 4.1 Extend the base thread with durable lifecycle transitions | 2.1, 2.8 |
| 4.2 Add durable unresolved-point and next-action projections | 2.9, 4.1 |
| 4.3 Select and present a meaningful resume target | 4.2 |
| 4.4 Implement learner-visible memory controls | 4.2 |
| 4.5 Offer optional review/mastery promotion without inference | 1.8, 4.3 |
| 4.6a Extend Learning Home with durable resume states | 4.3, 4.5 |
| 4.6b Extend the thread shell with memory and durable-state views | 2.6b, 4.4, 4.5 |
| 4.7a Verify keyboard, focus, landmark, and announcement coverage | 4.6a, 4.6b |
| 4.7b Verify responsive, reflow, motion, and target-size coverage | 4.6a, 4.6b |
| 5.1 Define the cross-feature contribution contract | 1.4, 4.1 |
| 5.2 Persist normalized provenance records | 5.1 |
| 5.3 Convert contributions into attributed activities | 3.1, 5.2 |
| 5.4 Deduplicate cross-feature attempts and outcomes | 1.7, 5.3 |
| 5.5 Define the cross-feature provenance analysis contract | 1.9, 5.4 |
| 5.6 Freeze and approve cross-feature provenance analysis | 5.5 |
| 5.7 Enforce approved cross-feature exposure and rollback | 3.8, 5.6 |
| 6.1 Operate and retain the versioned semantic event ledger | 1.9 |
| 6.2a Publish first-value and operational metric definitions | 3.8, 6.1 |
| 6.2b Publish retention, cross-feature, accessibility, cost, and support metrics | 4.7a, 4.7b, 5.7, 6.1 |
| 6.3a Enforce provider admission, quota, ambiguity, and cost controls | 1.7, 3.8, 6.2a |
| 6.3b Enforce activation, accessibility, and rollback controls | 6.2b, 6.3a |
| 6.4 Generate the versioned deployment evidence bundle | 6.3b |
| 6.5 Collect live release audits and activation approval | 6.4; ready-for-human |
| 6.6 Define staged GA rollout and rollback contract | 6.5 |
| 6.7 Operate support and rollback drills | 6.6; ready-for-human |
| 6.8 Verify reactivation and minimum seven-day soak evidence | 6.7; ready-for-human and time-gated |

## Split-ticket acceptance boundaries

- 2.4a owns one authenticated ready-V2 path from thread start through response
  submission using existing V2 authority. 2.4b owns the frozen timer/query,
  non-blocking response persistence, and deterministic fallback evidence.
- 2.6a owns the base projection, route, and shell. 2.6b owns route restoration,
  Evidence drawer, and preparing/blocked/stale/invalidated status presentation.
- 3.5a-d each ship their named primitives with ready, fallback, completed,
  mobile, and accessibility fixtures. 3.5e proves registry-wide exhaustiveness
  and rejects unregistered or mismatched renderer versions.
- 4.6a owns Home resume, Worth revisiting, and legacy handoff. 4.6b owns Thread
  memory, unresolved-point, artifact, and optional review views.
- 4.7a owns semantic/keyboard/assistive behavior; 4.7b owns viewport, reflow,
  reduced-motion, forced-color, touch-target, and draft-preservation behavior.
- 6.2a owns reproducible first-value, provider, and operational counters. 6.2b
  owns delayed retention, experiment, cross-feature, accessibility, cost, and
  support definitions without redefining the Slice-0 denominator.
- 6.3a owns finite provider/quota/cost/ambiguity admission. 6.3b owns cohort,
  assistive-technology, rollback, and activation controls.

Live hosted-provider, security, WCAG/assistive-technology, approval, support
drill, and elapsed-soak evidence are never inferred from deterministic tests.
