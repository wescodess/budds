---
status: final
date: 2026-09-20
initiative: Budds Adaptive Learn
---

# Adaptive Learn implementation contracts

This is the normative implementation contract for the stories in `epics.md`.

This document pins the brownfield seams that stories must not reinvent. It uses
the repository's current Nuxt 4/Vue 3/TypeScript stack, Convex 1.45, Better
Auth token identifiers, Vitest, and Playwright. Existing V1/V2 authority and
providers remain unchanged.

## Route and ownership contract

The adaptive route is the static-segment Nuxt page
`app/pages/app/learn/thread/[threadId].vue`, URL `/app/learn/thread/:threadId`.
`app/pages/app/learn/index.vue` owns Home and creates/opens threads. The
existing `app/pages/app/learn/[learningVoidId]/index.vue` and its
`calibration.vue` and `sessions/[sessionId].vue` children remain the V2 mission
routes. A thread ID is never accepted by the V2 page and a learning-void ID is
never accepted by the adaptive page. Static `thread/` precedence is verified
by a route test; unknown IDs return the existing not-found/denied state.

The folder V1 routes under `app/pages/app/folders/[id]/learn/**` remain first
class. Adaptive Home may link to them only through an explicit legacy handoff.
Feature-off, denied, stale, or rollback navigation returns the named V2 route
(`/app/learn/:learningVoidId`) or the folder V1 route, never a silent route
rewrite. Browser back/forward restores the URL-selected thread/activity;
refresh rehydrates from Convex and never treats local state as authority.

Drafts are stored in `localStorage` under `budds.learn.adaptive-draft.v1` as
bounded, non-sensitive composer text/context metadata only. A draft is keyed by
an opaque client draft ID and is cleared after the authoritative draft command
acknowledges it. Response text is kept in component state and, when explicitly
permitted by the activity contract, in the existing offline queue; raw answers
are never telemetry. Opening a second tab is supported: both tabs read the
same authoritative thread, commands use the same user-scoped idempotency key,
and a stale revision returns `conflict` without overwriting either local draft.
The UI offers `use_authority` or `keep_local_draft`; only the former may submit
against the new revision.

## Convex schema contract

All owner fields are the authenticated `identity.tokenIdentifier` string. No
public function accepts a user identity for authorization. Every index name
contains all indexed fields and every list query is bounded or paginated.

The additive tables below are the minimum fields. System `_id` and
`_creationTime` are implicit. Literal unions are implemented with
`v.union(v.literal(...))`; timestamps are Unix milliseconds.

### `learningThreads`

`userId`, `originalNeed`, `intent` (`understand|prepare|build|master|refresh|explore`),
`availableTime` (`15|25|45|60|no_limit`), `authorityKind`
(`standalone|v2_mission`), optional immutable `learningVoidId` when
`authorityKind=v2_mission`, and `sourceScope` (bounded object with
`kind: none|folder|document|url|pasted`, opaque source IDs/URL hash or pasted
content digest/byte count only),
`evidenceState` (`none|preparing|ready|blocked|stale|invalidated|unavailable`),
`lifecycle` (`draft|preparing|ready|active|paused|ended|blocked|rollback`),
`revision`, optional `currentActivityId`, optional `unresolvedPoint`, optional
`nextAction` (`kind`, `label`, `reasonCode`, `activityId`), `createdAt`, and
`updatedAt`. Indexes: `by_userId_and_lifecycle_and_updatedAt` on
`[userId,lifecycle,updatedAt]` and `by_userId_and_updatedAt` on
`[userId,updatedAt]`; direct `_id` reads are owner-checked rather than
requiring an `_id` index.

The V2 anchor is owner-checked at creation and on every factual activity. It
never changes to another Learning Void and does not copy mission, plan,
evidence, session, attempt, or mastery state. Exact session and revision pins
belong to `learningThreadActivities`. A standalone thread can be promoted to a
V2-backed thread only by creating a new thread with an explicit copy-only
handoff; authority is never silently changed in place.

Phase 1 does not persist raw pasted material. The browser may retain a bounded
local draft while an owned document import is requested; Convex stores only the
digest and byte count. Until the existing import pipeline returns an owned
document identity and V2 evidence reaches `ready`, pasted input can drive only
provider-free non-factual goal shaping or diagnostics. It cannot support a
factual claim, provider payload, score, or mastery transition.

### `learningThreadActivities`

`userId`, `threadId`, immutable `activityId`, `boundaryOrdinal`,
`planRevision`, `activityClass` (`factual|non_factual`), `status`
(`eligible|started|submitted|scoring|feedback|blocked|reconciling|ended|replaced`),
`contractVersion`, `rendererVersion`, `purpose`, `reasonCode`, bounded
`primitivePlan`, bounded `requiredAction`, `fallback`, `accessibilityMetadata`,
optional V2 pins (`learningVoidId`, `blueprintRevisionId`, `objectiveId`,
`sessionContentId`), optional `replacesActivityId`, and `createdAt`/`updatedAt`.
Indexes: `by_userId_and_threadId_and_boundaryOrdinal`,
`by_userId_and_activityId`, and `by_userId_and_status_and_updatedAt`.

### `learningThreadArtifacts`

`userId`, `threadId`, `activityId`, `artifactKind` (`note|plan|draft|answer|other`),
`revision`, bounded `title`, bounded `summary`, opaque optional `r2ObjectKey`,
`status` (`draft|saved|deleted`), `createdAt`, `updatedAt`. Indexes:
`by_userId_and_threadId_and_updatedAt` and `by_userId_and_status_and_updatedAt`.
R2 cleanup runs before local deletion and is resumable/idempotent.

### `learnActivityDecisions`

`userId`, `threadId`, `activityId`, `routerVersion`, bounded canonical
`inputSnapshot`, `inputDigest`, selected activity/reason/fallback, bounded
override metadata, `createdAt`. Indexes: `by_userId_and_threadId_and_createdAt`
and `by_userId_and_activityId_and_createdAt`.

### `learnActivityEvents`

`userId`, `threadId`, optional `activityId`, closed `eventType`, `eventVersion`,
`occurredAt`, reason/outcome code, source/contract versions, and bounded
non-content metadata. Indexes: `by_userId_and_threadId_and_occurredAt` and
`by_userId_and_eventType_and_occurredAt`. Raw answers, source text/locators,
provider payloads, queries, credentials, and filenames are rejected/redacted.
The closed event type set includes `thread_command_committed`,
`meaningful_activity_started`, `thread_drafted`, `evidence_ready`,
`evidence_blocked`, `activity_eligible`, `activity_started`,
`meaningful_response`, `assistance`, `activity_completed`,
`representative_pass`, `representative_fail`, `delayed_check_eligible`,
`delayed_check_attempt`, `retained`, `remediation`, `provider_failure`,
`provider_ambiguity`, `evidence_gap`, `evidence_invalidation`, `abandonment`,
and `explicit_end`.

### `learnActivityCommandReceipts`

`userId`, server-derived `idempotencyKeyHash`, `requestFingerprint`, `commandName`,
`targetRevision`, `resultKind`, bounded result/error reference, `createdAt`,
`resultExpiresAt`, and optional `resultRedactedAt`. Unique index:
`by_userId_and_idempotencyKeyHash`. Public commands accept the bounded opaque
key, hash it before lookup/storage, and never persist the raw key.

Receipt identity is retained until its owning thread or account is deleted.
After 30 days a bounded cleanup may redact the result/error payload and set
`resultRedactedAt`, but it preserves the key, fingerprint, command, target,
and terminal kind. A later retry with the same key and fingerprint returns the
terminal kind (or `result_expired` when the detailed payload was redacted); the
same key with a different fingerprint always conflicts. Cleanup can never make
an old key executable again.

### `learningThreadContributions`

`userId`, `threadId`, `sourceFeature` (`chat|quiz|flashcards|podcast|documents`),
`sourceIdentity`, `sourceRevision`, `contributionKind`, `provenanceVersion`,
`provenanceKey`, bounded metadata, `sourceStatus`, `createdAt`. Indexes:
`by_userId_and_threadId_and_createdAt` and
`by_userId_and_provenanceKey`; the latter is unique by owner. No raw answer or
private source payload is stored.

## Function/API contract

`convex/learnAdaptive.ts` owns the public adaptive read/mutation surface. It
derives identity, applies the canonical adaptive gate, validates expected
revision, and writes a receipt in the same mutation as the authoritative
change. Public results use this discriminated union:

```ts
type AdaptiveResult<T> =
  | { kind: 'ok'; value: T; revision: number; receiptId: string }
  | { kind: 'conflict'; code: 'stale_revision'|'duplicate_key'|'activity_boundary_changed';
      expectedRevision: number; actualRevision: number; authority: 'convex' }
  | { kind: 'denied'|'blocked'|'invalid'; code: string; message: string; retryable: boolean }
```

The public queries are `learnAdaptive.getHome`, `learnAdaptive.getThread`,
and paginated `learnAdaptive.listThreadHistory`. The public mutations are
`learnAdaptive.createDraft`, `learnAdaptive.setIntent`,
`learnAdaptive.startActivity`, `learnAdaptive.submitResponse`,
`learnAdaptive.saveArtifact`, `learnAdaptive.applyOverride`,
`learnAdaptive.setMemoryPreference`, `learnAdaptive.leaveThread`,
`learnAdaptive.endThread`, and `learnAdaptive.resolveSyncConflict`. Every
mutation accepts `expectedRevision` and `idempotencyKey`; response submission
also accepts `activityId` and `attemptKey`. Commands reject client score,
verdict, mastery, evidence acceptance, or provider fields.

Phase 0/1 do not add an adaptive provider dispatcher. A V2-backed activity
uses the existing `startStudySession`, `recordAssistanceUse`, and
`submitMasteryAttempt` authority through shared server-side helpers extracted
from those paths; both the existing V2 APIs and adaptive orchestration call the
same helpers. Adaptive code may persist only its activity reference and a
projection of the committed V2 result. It cannot create a second scoring job,
provider request, attempt, feedback verdict, or mastery transition. Standalone
non-factual activities are deterministic and provider-free.

`convex/learnAdaptiveActions.ts` and `shared/adaptive-provider-port.ts` are
deferred until a later slice explicitly approves standalone provider-backed
activity work, its job table/manifest, lease and reconciliation behavior,
quota, deletion/export contract, and activation evidence. No Nuxt route
dispatches adaptive provider work.

`shared/adaptive-claim-adapter.ts` is the only claim bridge. For factual activities it
accepts immutable published V2 `sessionContentId` plus claim/support IDs and
returns permitted origin/locator/revision/status projections. For standalone
non-factual activities it returns `{ kind: 'non_factual', claims: [] }`; it
cannot manufacture evidence or mastery pins.

`shared/adaptive-learn-storage-manifest.ts` is owned by Slice 0. It is imported
by `convex/schema.ts`, `convex/dataExport.ts`, `convex/accountDeletion.ts`, and
source/folder purge tests. A writer may not add a table/object without its
manifest entry, owner/parent indexes, bounded export shape, deletion order,
and fixture. Story 1.2 adds thread/activity entries; Story 1.3 receipts;
Story 1.9 events; Story 2.9 artifacts; Story 3.2 decisions; Story 5.2
contributions.

## Feedback contract

Provider rationale is untrusted input and is never rendered or persisted as
learner-facing feedback. The initial controlled misconception taxonomy is
`missing_required_step`, `unsupported_claim`, `confused_concepts`,
`incorrect_sequence`, `scope_overgeneralization`, `incomplete_transfer`,
`calculation_or_unit_error`, and `evidence_mismatch`; no misconception is an
empty list. Unknown, duplicate, or over-limit tags reject the provider result.

The server maps verifier-approved criterion outcomes and allowed tags to these
versioned templates: `criterion_met`, `criterion_not_met`,
`evidence_insufficient`, `response_incomplete`, and `provider_unavailable`.
Templates may interpolate only a bounded criterion label from the pinned
assessment contract. They may not interpolate provider prose, source text,
private locators, or raw learner content. `provider_unavailable` explicitly
states that the response was saved and no mastery change was made. Template
and taxonomy version are pinned on every committed feedback projection.

## Component contract

`app/components/learn-adaptive/LearningHome.vue` owns Home rendering and emits
`start({ need, intent, availableTime, sourceScope })`, `resume(threadId)`, and
`legacy-handoff(route)`. `LearningThreadShell.vue` accepts `thread`,
`activity`, `status`, and `readOnly`; emits `leave`, `end`, `open-context(kind)`,
`override(control)`, and `boundary-action(payload)`. `AdaptiveCanvas.vue`
accepts only the validated plan and semantic activity state; it emits
`response-change`, `submit`, `fallback(reason)`, and `boundary-complete`.
`ActivityFrame.vue` owns heading/purpose/status/primary-action anatomy.
`EvidenceDrawer.vue`, `MemoryDrawer.vue`, and `WhyActivityDialog.vue` accept
projection-only props and emit authorized intent events; they never mutate
Convex directly. Existing `UiButton`, `UiCard`, `UiDrawer`, `UiSheet`,
`UiDialog`, `UiAlert`, `UiTextarea`, and `useMobileKeyboardInset` remain the
primitive and keyboard-inset owners.

## Fixtures and test ownership

Pure contracts/routing/claim/storage types: `shared/*test.ts`.
Convex authority, schema, receipts, conflict, deletion/export, source purge,
and delegation to existing V2 session/scoring authority:
`convex/learnAdaptive*.test.ts`,
`convex/accountDeletion.test.ts`, and `convex/dataExport.test.ts`.
Home/thread/canvas and drawer contracts: `tests/component/learn-adaptive/*.test.ts`.
Route precedence, refresh, back/forward, duplicate-tab conflict, and rollback:
`tests/component/learn-adaptive/routes.test.ts` plus
`e2e/learn-adaptive-journey.spec.ts`. Primitive fixtures are one fixture per
primitive and state; accessibility assertions are colocated with the
component fixture, not one unbounded test.

Slice 0 owns the first-value event definitions and deterministic fixture/query
(`shared/learn-adaptive-metrics.ts`, tested by
`convex/learnAdaptiveMetrics.test.ts`, from
`thread_command_committed.v1` to `meaningful_activity_started.v1`), so Slice 1
can verify its SLA. Epic 6 Story 6.2 extends the same definitions with
operational, retention, cost, support, and experiment metrics; it does not
move or redefine the Slice 1 denominator.
