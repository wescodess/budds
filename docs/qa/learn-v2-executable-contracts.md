# Learn Anything V2 executable contracts

**Status:** accepted Phase 0 contract

**Contract version:** `learn-v2.contract.v1`

**Canonical specification:** [GitHub issue #180](https://github.com/wescodess/budds/issues/180)

**Foundation implementation:** [LA2-03](https://github.com/wescodess/budds/issues/165), following [LA2-01](https://github.com/wescodess/budds/issues/163)

This document is the human-readable index for the machine-readable contract in [`shared/learn-v2-contract.ts`](../../shared/learn-v2-contract.ts) and its executable acceptance examples in [`tests/fixtures/learn-v2-contract.ts`](../../tests/fixtures/learn-v2-contract.ts). The validator and focused test fail when a safety-critical invariant drifts.

This contract does not enable V2. LA2-03 implements the additive normalized schema, gated Learning Void/Blueprint lifecycle foundation, durable idempotency, bounded retention seams, and redacted export enumeration. Fetch behavior, source/provider writers, quota transactions, planning, scheduling, and mastery workflows remain later work packages.

## Accepted decisions

- [ADR 0005](../adr/0005-use-an-additive-normalized-learn-v2-model.md) fixes the additive normalized persistence boundary.
- [ADR 0006](../adr/0006-keep-learn-v2-authority-in-convex.md) assigns authority, pure decisions, and external I/O runtimes.
- [ADR 0007](../adr/0007-preserve-learn-v2-evidence-integrity-through-deletion.md) fixes publication, rights, tombstone, and deletion behavior.

## Vocabulary and isolation

A **Learning Void** is the stable, owner- and folder-scoped V2 aggregate. It owns a stable **Blueprint** and **Study Plan**, whose accepted **Blueprint Revisions** and **Study Plan Revisions** are immutable. A **Capability Objective** is one bounded assessable outcome. A **Source Snapshot** pins an authorized source revision, while a **Claim Support** records atomic entailment and conflict evidence. **Mastery Attempts** are append-only server-scored events; a **Mastery Record** is their derived per-objective projection. A **Study Session** has exactly one primary objective. **Search Reservations** claim free-provider capacity transactionally. **Learn Jobs** are machine-owned, bounded continuations.

V2 storage is additive. There is no V1/V2 dual write and no inference of evidence acceptance or mastery from V1 completion. An explicit upgrade copies only title, source identities, and compatible preferences into a new draft and leaves the V1 course unchanged.

The existing [Learn V1 isolation matrix](./learn-v1-isolation-matrix.md) remains the denial contract for unflagged, flagged, upgraded, and rollback states.

## State machines

All lifecycle commands are server-authorized, idempotent, and checked against an expected revision. The machine-readable transition tables define the complete allowed edges for:

- Learning Void: `draft → sourcing → source_review → map_review → calibration → plan_review → scheduled → active → completed`, with guarded pause, attention, failure, retry, and archive paths.
- Blueprint revision: `draft → source_review → map_review → accepted → active | superseded`; accepted content is immutable and replacement creates a new draft revision.
- Source: `candidate → fetched → evaluated → user_accepted | rejected | unavailable`.
- Study session: `planned → ready → in_progress → completed | missed | cancelled`, with scheduled-but-unstarted `planned | ready → missed` edges and guarded `blocked`, `generation_failed`, and `needs_reschedule` recovery.
- Learn job: `queued → leased → running → awaiting_approval | blocked | succeeded | failed`, with bounded cancellation and lease-expiry paths.
- Search reservation: `reserved → consumed | released`; ambiguous provider outcomes remain reserved until reconciliation.

## Normalized persistence proposal

LA2-03 translates this proposal into additive Convex validators and the foundational Learning Void/Blueprint commands. LA2-04 adds the bounded folder-manifest tables and commands described below. The remaining tables stay schema and retention foundations, not provider, quota, planning, scheduling, or mastery implementations.

| Aggregate | Proposed tables | Required bounded paths |
| --- | --- | --- |
| Learning Void | `learningVoids` | owner, owner + folder, owner + status |
| Blueprint | `learnBlueprints`, `learnBlueprintRevisions` | owner + Void; owner + blueprint + revision; owner + Void + status |
| Map | `learnMilestones`, `learnObjectives`, `learnObjectivePrerequisites` | owner + revision + order; owner + objective/prerequisite edges |
| Evidence | `learnSourceIdentities`, `learnSourceSnapshots`, `learnFolderSourceManifests`, `learnFolderSourceManifestFolders`, `learnFolderSourceManifestEntries`, `learnSourceExcerpts`, `learnObjectiveSources`, `learnClaimSupports` | owner + Void/Blueprint, canonical identity, manifest folder/document order and checkpoints, snapshot revision/status, objective coverage, content/support lookups |
| Mastery | `masteryAttempts`, `masteryRecords` | owner + objective + attempt time, idempotency key, next-review time |
| Planning | `studyPlans`, `studyPlanRevisions`, `studySessions`, `studySessionRetrievalObjectives` | owner + Void, plan revision/status, scheduled owner queue, ordered retrieval links |
| Session content | `sessionContent`, `sessionContentBlocks`, `sessionContentClaims` | owner + session + revision/status, ordered blocks and claims |
| Calendar | existing shared `calendarConnections`; new `calendarProjections`, `reminderPolicies` | explicit V2 re-consent and existing provider-first disconnect; no V1 `calendarEvents` reuse; owner + session/event and owner + Void |
| Search quota | `searchQuotaBuckets`, `searchReservations` | provider + scope + period for product caps; owner + provider/period; owner + Void/period; idempotency; expiry/reconciliation |
| Jobs | `learnJobs` | owner + idempotency, owner + status/lease expiry, owner + Void/type |

Every new table includes `userId`, a bounded `by_userId` path, and an explicit retention class. Unbounded child arrays are represented as tables. Account deletion, export, folder deletion, folder move, and source deletion use the retention-class matrix in the machine-readable contract and must be implemented in the same slice as each table. A move preserves stable folder identity and immutable history, revalidates access, recomputes derived projections, and cancels or reconciles future jobs/projections if the new scope is unauthorized.

## Authorized folder-source manifests

`learnV2FolderManifests.freezeManifest` starts a server-owned capture for one
editable Blueprint revision. The caller supplies only selected folder/document
IDs, expected aggregate revisions, and an idempotency key. Convex proves the
owner, live Learning Void root, Blueprint relationship and revisions, and that
every selection remains inside the root subtree. The client cannot provide
folder names, paths, object keys, hashes, source revisions, or authorization
facts.

The command stores a normalized manifest header and selected folder queue, then
`continueCapture` pages child folders and documents in batches of 16. Queue
cursors and monotonically allocated folder/document order values make retries
exact-once. Idempotency stores only a SHA-256 digest of the canonical request;
raw explicit document checkpoints are consumed during capture, cleared at every
terminal state, and pruned by bounded deletion cleanup while paused. Deleting
an uncaptured explicit selection fails the paused capture instead of silently
narrowing it. Input is
capped at eight selected folders and 64 explicit documents;
the assembled manifest fails explicitly above 4,096 documents. Public list
queries cap pages at 16 and omit internal traversal cursors. No new path calls
the legacy `folders.resolveScope` query or an all-user retrieval fallback.
Every continuation re-checks the global gate, cohort entitlement, and account
deletion tombstone before writing. A revoked capture remains resumable but idle;
an identical authorized replay restarts its continuation.

Each captured folder has a deterministic SHA-256 revision over its actual ID,
parent, name, and source-affecting update time. Each document retains its actual
folder ID and is available only when its indexed state is successful, its object
key is nonblank, and `sourceRevision` equals `sha256:<normalized contentHash>`.
Every other in-scope document remains visible as an unavailable entry with a
specific reason. No selected sources produce `coverage: empty`; a selected
scope with no usable documents or only unavailable documents produces
`coverage: gap`; mixed availability is `partial`; a fully usable set is
`complete`.

An explicit document captures only that document and its real folder identity;
it never widens to siblings. Selected folders expand only through their own
descendants, so multiple branches under the Learning Void root are allowed but
same-owner folders outside the root are rejected. Once frozen, later moves,
renames, or re-indexing cannot rewrite the manifest. A later command creates a
new manifest from current state. Blueprint or Learning Void revision drift while
the continuation is running fails the capture instead of attaching evidence to
a changed aggregate. Folder revisions are refreshed only before traversal
starts; a revision change after child or document pagination begins fails the
capture so no page can be stamped with a stale folder revision.

The three manifest tables participate in bounded child-before-parent account
and folder-root deletion. Owner export is paginated and removes private source
paths, filenames, raw selection IDs, idempotency fingerprints, and traversal
cursors. The downloadable ZIP includes all three manifest collections. Deleting
an individual captured document or a captured descendant folder preserves the
historical manifest while asynchronously clearing document, folder, filename,
and object-key identifiers; affected entries become `source_deleted`, their
snapshots become unavailable, and current availability counts are revised. A
Learning Void root deletion still removes the complete manifest foundation.
Source identities and snapshots remain candidates only; fetching, rights
evaluation, source acceptance, excerpts, and web lifecycle transitions belong
to LA2-05.

## Runtime ownership

Convex owns authentication, authorization, persisted state, revisions, transitions, idempotency, quota reservations, leases, checkpoints, and terminal reasons. External network or model work runs only in an approved Convex action, Nitro server route, or Cloudflare Worker boundary. External results are validated before a Convex command persists or advances them. Convex mutations do not make external calls.

Mastery projection, schedule feasibility, query redaction, and fetch admission are pure, versioned decisions. Human approval ends a job at `awaiting_approval`; learner activity starts a new command. Jobs use bounded retries and never rely on an open request or indefinite workflow.

## Evidence, retention, and deletion

- Publication requires user-accepted atomic claim support with a pinned snapshot, bounded permitted excerpt or locator, entailment decision, verifier version, and clear conflict state.
- Search snippets and model memory cannot become evidence.
- Unknown storage or redistribution rights prohibit excerpt persistence.
- Accepted revisions and snapshots are immutable; semantic edits fork future revisions.
- Unresolved conflicts block affected objectives.
- Source or access deletion purges protected content, leaves non-sensitive integrity tombstones, and renders historical citations as `evidence_unavailable`.
- Completed attempts remain historically valid but cannot display purged evidence.
- Account deletion removes owner data; calendar records require provider-first cleanup before local deletion.

## Mastery contract

The server appends attempts and derives objective state independently. Clients never submit authoritative scores or state.

- Calibration yields `provisionally_known` only for an unassisted cold attempt scored at least 80%; a failed or assisted calibration begins at `learning` and may expose misconception evidence.
- A completed taught application may yield `guided`; a substantive hint or answer reveal caps the result at `guided`.
- `independent` requires a server-scored unassisted application or transfer result of at least 80%.
- `retained` requires a separate unassisted transfer attempt at least seven calendar days after the first independent pass, scored at least 80% against the pinned rubric revision.
- A failed independent or retained check yields `needs_review`, schedules remediation, and never erases history.
- Confidence is diagnostic metadata and cannot raise mastery.

## Scheduling contract

Feasibility is a pure, versioned calculation. Availability uses local wall-clock windows plus an IANA timezone; placed sessions store UTC instants plus the plan timezone and chosen offset. Sessions default to 25 minutes and accept 15–60 minutes only.

A feasible dated plan fits learning and review obligations before the deadline while leaving 15% capacity unallocated and at least one buffer block in the final 10% of the plan. Prerequisites precede dependants, reviews follow learning, and retained review cannot be earlier than seven calendar days after independence. DST gaps move to the first valid instant inside the window; repeated times choose the earlier offset; both are disclosed. Reflow changes future incomplete sessions only and prioritizes overdue retained review, prerequisite remediation, due review, new learning, then optional enrichment. External calendar edits are proposals until validation succeeds.

## Zero-paid-search quota contract

The initial public-web provider is `tavily_free`. Periods use UTC. The hard controls are `costCeilingUsd = 0`, no overage, no paid fallback, 800 searches per month, 25 per product day, 4 per user day, 2 broad searches per Learning Void, and 8 results per request.

Reservations are transactional and idempotent. Success consumes; cancellation or terminal pre-request failure releases; an ambiguous outcome remains reserved until reconciliation. Ledger unavailability, exhausted capacity, authentication or policy failure, rate limiting, or kill-switch activation fails closed before any unapproved call. Operational logs contain no raw query or result payload.

## Threat boundaries

External queries must exclude folder excerpts, private filenames and URLs, personal names, email addresses, account identifiers, unpublished notes, secrets, and tokens. Only HTTPS original-publisher fetches can become evidence. Fetch admission must re-resolve DNS and revalidate every redirect; reject private, loopback, link-local, metadata-service, and reserved targets; and bound redirects, time, bytes, decompression, and concurrency. Only allowlisted text, HTML, and PDF content is admitted.

Budds forwards no user cookies or credentials, performs no login or access-control bypass, and respects publisher controls. Retrieved content is untrusted data. Source instructions cannot change system behavior, disclose secrets, broaden scope, or call tools.

## Executable evidence

Run the focused contract test with:

```bash
pnpm vitest run server/utils/learn-v2-contract.test.ts
```

The fixture catalog supplies structured inputs and expected results for accepted and conflicting evidence, unknown rights, deletion tombstones, calibration and mastery thresholds, hints/reveals, retained timing, prerequisite and DST scheduling, infeasibility and reflow, quota reservation outcomes, fail-closed exhaustion, SSRF and rebinding targets, MIME/decompression limits, query redaction, and poisoned-source instructions. The focused test executes each fixture through its reference evaluator; later runtime implementations must satisfy the same cases.
