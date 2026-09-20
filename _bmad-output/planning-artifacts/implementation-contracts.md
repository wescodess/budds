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
`availableTime` (`15|25|45|60|no_limit`), `sourceScope` (bounded object with
`kind: none|folder|document|url|pasted`, opaque source IDs/URL hash only),
`evidenceState` (`none|preparing|ready|blocked|stale|invalidated|unavailable`),
`lifecycle` (`draft|preparing|ready|active|paused|ended|blocked|rollback`),
`revision`, optional `currentActivityId`, optional `unresolvedPoint`, optional
`nextAction` (`kind`, `label`, `reasonCode`, `activityId`), `createdAt`, and
`updatedAt`. Indexes: `by_userId_and_lifecycle_and_updatedAt` on
`[userId,lifecycle,updatedAt]` and `by_userId_and_updatedAt` on
`[userId,updatedAt]`; direct `_id` reads are owner-checked rather than
requiring an `_id` index.

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

`userId`, `idempotencyKey`, `commandName`, `targetRevision`, `resultKind`,
bounded result/error reference, `createdAt`, `expiresAt`. Unique index:
`by_userId_and_idempotencyKey`.

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

`convex/learnAdaptiveActions.ts` is the sole adaptive provider dispatcher. It
exports internal `evaluateResponse` and `reconcileProviderOutcome` actions;
both use the existing Cloudflare AI Gateway/OpenRouter configuration through
`shared/adaptive-provider-port.ts`, reserve quota before I/O, and return only
`not_dispatched|definitive_failure|ambiguous|validated_feedback`. No new
provider is introduced and no Nuxt route dispatches provider work.

`shared/adaptive-provider-port.ts` defines the provider-neutral request
(`requestDigest`, provider/model/policy versions, bounded payload, timeout,
reservation ID, reconciliation key) and validated response. `shared/
adaptive-claim-adapter.ts` is the only claim bridge. For factual activities it
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

Pure contracts/routing/claim/provider/storage types: `shared/*test.ts`.
Convex authority, schema, receipts, conflict, deletion/export, source purge,
and provider reconciliation: `convex/learnAdaptive*.test.ts`,
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
