# Post-seal teaching read contract

Contract: `learn-v2.post-seal-teaching.v1`. Implements [C1.4 #533](https://github.com/wescodess/budds/issues/533), consuming the [approved Canvas experience](../design/learn-delayed-check/decision.md). The owner chose this post-seal contract on 2026-11-08. The original C1.4 handlers below stay inactive and write nothing. The versioned runtime amendments below specify #535's default-off behavior and supersede the affected endpoint, availability, hint, help-limit and replay rules.

## Public shape

`learnV2CanvasMeasurementApi.getPostSealTeaching` references `learnV2Assessments.getPostSealTeaching`. Arguments and returns have closed Convex validators in `convex/lib/learnV2PublicContract.ts` and strict, bounded schemas in `shared/learn-v2-assessment-disclosure.ts`.

```ts
type Version = 'learn-v2.post-seal-teaching.v1'
type Reason = 'disabled' | 'unavailable' | 'not_sealed'
  | 'test_open' | 'evidence_unavailable' | 'disclosure_unknown'
type SourcedTier = 'T0' | 'T1'
type PracticeTier = 'T0' | 'T2'
type Citation = { sourceRef: string; label: string }
type Reference = {
  version: Version
  assessmentOpportunityId: Id<'learnAssessmentOpportunities'>
}
type Teaching =
  | { version: Version; status: 'unavailable'; reasonCode: Reason }
  | {
      version: Version
      status: 'available'
      assessmentOpportunityId: Id<'learnAssessmentOpportunities'>
      feedback: { tier: SourcedTier; text: string; citations: Citation[] } | null
      lesson: { tier: SourcedTier; paragraphs: string[]; citations: Citation[] } | null
      practice: {
        responseSlotId: Id<'learnResponseSlots'>
        revision: number
        tier: PracticeTier
        prompt: string
      } | null
    }

type PracticeHelpRequest = Reference & {
  target: { responseSlotId: Id<'learnResponseSlots'> }
  expectedRevision: number
  kind: 'hint' | 'worked_example'
  idempotencyKey: string
}
type PracticeHelpAuthorization =
  | { version: Version; status: 'denied'; reasonCode: Reason }
  | {
      version: Version
      status: 'authorized'
      assessmentOpportunityId: Id<'learnAssessmentOpportunities'>
      target: { responseSlotId: Id<'learnResponseSlots'> }
      revision: number
      authorizationId: Id<'learnAssessmentExposures'>
      deliveredAt: number
      content:
        | { kind: 'hint'; tier: 'T0'; text: string }
        | { kind: 'worked_example'; tier: PracticeTier; text: string }
    }
```

`learnV2CanvasMeasurementApi.authorizePracticeAssistance` references `learnV2Assistance.authorizePracticeAssistance`. Its result is the only new public channel for practice hints and worked examples. The teaching read has neither field, even after sealing or on replay. Both commands derive the owner from authenticated `tokenIdentifier`, check account deletion, and authorize the referenced opportunity; help also authorizes the response slot and its owning scope. Neither accepts an owner, phase, capability, trusted binding, content or score from the client. Existing Today/Canvas commands and assistance authorization keep their shapes.

Current read result: `{ version, status: 'unavailable', reasonCode: 'disabled' }`. Current help result: `{ version, status: 'denied', reasonCode: 'disabled' }`. They contain no acknowledgement, submission, authorization reference, content or fabricated phase/result. No environment value enables either handler.

Text is nonempty and at most 12,000 JavaScript code units; citation labels are at most 300 and public source references at most 200. Feedback and lessons require 1–16 citations. Lessons have 1–8 paragraphs. Original serialized envelopes are bounded by the existing 64 KiB contract ceiling, without truncation. Revisions are positive safe integers, timestamps are bounded integers, and command keys retain the existing 16–128-character URL-safe format. Convex validators enforce closed structure; the shared parsers additionally enforce these semantic bounds before publication.

Every content object requires its own closed ADR-0009 `tier`: T0 is an accepted source with entailment verified; T1 is attributed fetched web content not yet accepted; T2 is model knowledge. Feedback and lessons accept T0/T1, practice prompts and worked examples accept T0/T2, and hints accept only T0. The ADR defines T1 by its attribution, so it is admitted only on feedback and lessons, the two objects with citations; practice prompts, worked examples and hints have no citation field and reject it. T2 is admitted only for practice prompts and worked examples, which are explicitly permitted forms in the ADR; the contract has no narrower analogy, prerequisite-bridge or simulation discriminator that could authorize generic feedback, lessons or hints as T2. Missing, unknown or forbidden tiers close the whole stored source/receipt, including withheld fields. Publication must validate a uniform tier within each object and prohibit unlabeled blending; high-stakes facts and all mastery/scoring authority remain T0-only, while private keys/rubrics/measurement material remain absent from these returns. The tier is a data channel only; its learner presentation is a later design decision, subject to the ADR's visible-label requirements.

## Disclosure and the #373 amendment

This read alone widens [#373's result rule](https://github.com/wescodess/budds/issues/373#issuecomment-6651824980) from its bounded feedback taxonomy to separately published, cited feedback text and a follow-up lesson. It does not widen an existing result, export, help, history, Today or Canvas payload.

| Content | Required authority |
| --- | --- |
| Any content | Owned, accessible evidence; matching check pins and delivery grant; approved public publication; an accepted submission and server acceptance time proving sealing; `relevantOpenCheck: 'no'` |
| Practice prompt/slot/revision | Sealed check and available `canTeachSeparateCase`; the owned, evidence-available practice authority defined below; verified separate case and nonreserved lineage |
| Feedback text and citations | Stored source attempt matching the authoritative attempt, valid score, scored pass/fail phase, and available `canReadFeedback` |
| Lesson | All feedback authority, with phase `scored_fail` |
| Hint or worked example | All practice authority, followed by the matching practice authorization response |

Preparing, ready, open, cancelled, abandoned and invalid-without-acceptance states release no teaching, regardless of capability booleans or replay. Sealed pending, retryable-failure, reconciliation-required and accepted-invalid states can permit separate-case practice, without score-driven feedback or a lesson. Sealing is derived from canonical acceptance, never an activity status, client receipt or provider outcome.

`projectPostSealTeaching` and `projectPracticeAssistanceAuthorization` freeze these gates for the runtime implementation. Their context is internal server-derived authority, not public arguments. Publication approval means the content has passed the shared disclosure/lineage boundary: no reserved solution, check case, sibling form or private scoring material. Unknown publication, case relation, reservation, ownership, pins or grant remains unavailable. `sourceRef` is a public opaque citation reference; it is not a private source/excerpt ID, locator, URL authorization or access grant. Reads and authorization replay recheck current access/evidence and publication authority.

The internal context requires `relevantOpenCheck: 'yes' | 'no' | 'unknown'`. For an owned accessible scope, `yes` closes both projections with `test_open`, and `unknown` closes them with `disclosure_unknown`, including replay; only `no` permits the remaining gates to run. An old scored check cannot authorize teaching while another relevant check is open. The stored source also requires `attemptId: Id<'masteryAttempts'> | null`, matching `lifecycle.authoritativeAttemptId`; mismatch closes the entire read, and it is null when the lifecycle has no authoritative attempt. This internal binding is never returned. `publicationAllowed` must cover every content dependency, including source purge or access loss behind only a feedback or lesson citation.

The gate runs in a fixed order: ownership and access (`unavailable`), relevant open check, evidence (`evidence_unavailable`), pins and publication (`disclosure_unknown`), capability status (`unavailable`), then sealing and the grant. Evidence and pin loss therefore keep their own reasons when resolver-derived capabilities are already `unavailable` for the same loss.

After authority checks, any stored source/receipt or final-envelope validation failure, including byte ceilings and withheld fields, returns `unavailable`/`denied` with `disclosure_unknown` and no partial content; malformed public arguments and server context continue to throw.

Every return object is allowlisted. Neither successful nor unavailable results can carry score percentages, thresholds, criteria, rubric keys/descriptions/snapshots, weights, per-criterion verdicts, scorer rationale, model confidence/details, answer keys, reference solutions, item/family/case IDs, private source identifiers/locators, or provider payloads. Structural schemas cannot prove arbitrary prose is safe; the runtime publication and lineage checks must establish that before supplying the source DTO. ADR-0009's provenance and T0 restrictions still apply; this contract adds no generation or provenance-policy change.

## Practice assistance and replay

The help target is exclusively `{ responseSlotId }`. The sealed opportunity is authorization context, never the assistance target. The server-only practice binding must prove ownership, `stage: 'practice'`, its own `evidenceAvailable: true`, the exact check submission, `caseRelation: 'separate_case'`, and `reservedCase: 'no'`. A same-case, sibling, reserved, unknown, foreign, evidence-unavailable or stale binding releases neither practice nor help; unavailable/unknown slot evidence must resolve to false.

`binding.revision` is the practice response slot's current revision. The read publishes it, and both a request and its saved receipt must match it at authorization and replay. Once the slot advances, the old request/receipt is denied closed; a fresh matching request uses a new command key. Delivering help is not an advance: the revision check runs before the receipt, so a delivery that bumped it would deny its own same-key retry. Slot identity remains bound to the check submission under this rule.

The internal receipt input freezes the complete request and its authorization result. Same key and canonical request replay the same saved authorization ID, delivery time and content; changed key/payload, slot, revision or help kind cannot reuse it. The authorization's delivery time cannot precede the check's acceptance time. Replay rechecks authorization before reading the receipt content. The helper validates a supplied receipt; it does not create, persist or acknowledge one.

Preserve [#363's three separate exposure facts](https://github.com/wescodess/budds/issues/363#issuecomment-6651831618): prior teaching/case exposure, assistance delivered to the current opportunity before sealing, and later exposure. Practice help is delivered to its practice slot and is later exposure relative to the check. It cannot increment the sealed check's assistance revision, alter its acceptance snapshot, or be passed to its legacy assistance recorder. Denial is not delivered assistance. Later evidence of actual pre-seal contamination still uses an appended integrity event; this read cannot erase or rewrite it. Ordinary session-wide assistance caps and legacy unknown-history semantics are unchanged.

Practice help rows in `learnAssessmentExposures` must leave `assessmentOpportunityId` unset. Their receipt/binding targets the practice slot; the check reference remains authorization context. Otherwise by-opportunity readers and owner export would attribute that help to the sealed check.

## Runtime follow-up

The serial [#570 storage amendment](learn-v2-c1-storage-contract.md#570-post-seal-storage-amendment)
defines the inactive persisted sources, practice bindings, help receipts,
assistance counters, source links and lifecycle registration for this follow-up.
It specifies the future writer transactions without enabling either endpoint.

The runtime ticket must implement the following before the Canvas replaces its temporary teaching binding and #532 leaves draft:

- Resolve ownership, canonical acceptance/sealing, authoritative score validity/current eligibility, capabilities, grant/pins and current evidence/access through Convex. Recheck revocation and account deletion on every read and replay; a query must not mint a grant.
- Derive the relevant-open-check lookup server-side across current opportunities, including another check on the same assignment, before read/help/replay. The lookup and content-delivery/help authorization must serialize with the other check's acceptance; an old activity's phase or a replayed receipt cannot bypass support accounting.
- Publish safe cited feedback and a valid-failure-only lesson bound to the authoritative attempt, without reconstructing a reserved solution or private criterion rationale. Enforce the tier restrictions above, source rights, lineage, bounded content and byte ceilings, including dependencies behind feedback/lesson citations. No unchecked stored JSON or fallback snapshot may bypass the projection.
- Select and persist the different, nonreserved practice case and response slot once, binding their identity to the sealed check submission under the practice/replay rule above. Same-case/sibling/unknown lineage fails closed. Practice remains available during pending, failed and unconfirmed scoring when the server capability and relevant-open-check gate permit it, without requiring confidence or score success.
- Serialize help authorization, slot acceptance and delivery/exposure accounting. Persist immutable content-bearing receipts with canonical request fingerprints, reject idempotency conflicts and stale/foreign targets, and replay the same content after renewed authorization. Keep slot assistance and later exposure separate from frozen check assistance. Assess persistence needs through the serial schema owner before adding storage; this inactive contract requires no schema edit.
- Delivering practice help must not advance `binding.revision`; do not copy the legacy recorder's revision bump. Count slot assistance separately from the slot revision.
- The score-commit transaction stamps the source's `attemptId`, in the same transaction that sets the authoritative attempt, so the read does not close in a gap after a score commits.
- Authorize first-time help with `learnPostSealTeachingDenial`, which needs no sentinel receipt. It covers only the check-level gates above: the runtime must also prove the practice binding before persisting a receipt. Replay stays on `projectPracticeAssistanceAuthorization`.
- Apply source/access purge, retention, owner export, account deletion and telemetry omission to every new content/receipt/binding copy. Export gains no new content permission from this amendment. Cover revocation races, cross-tab retries and help/acceptance races with real persisted records.
- Replace #442's temporary `laterTeaching` channel using these server reads and authorization results, under its existing UI ownership and release gates. Run the runtime endpoint/alias matrix; contract fixtures here do not establish runtime publication, generation, persistence or production readiness.

No schema, frontend, runtime generator/selector, flag, environment, deployment, migration, enrollment or provider operation is introduced by C1.4.

## Runtime amendment: `learn-v2.post-seal-teaching.v1.runtime.1`

This amendment completes the backend contract consumed by [#442](https://github.com/wescodess/budds/issues/442).
It keeps the public request version `learn-v2.post-seal-teaching.v1`, adds closed
availability metadata to successful runtime reads, and records the practice-opening
mutation already implemented by #535. It adds no storage fields or indexes.
The capability remains default-off. Disabled responses are byte-identical to
the original contract; this amendment authorizes no activation or frontend work.

| Registered endpoint | Canvas alias | Transaction and result |
| --- | --- | --- |
| `learnV2Assessments.getPostSealTeaching` | `learnV2CanvasMeasurementApi.getPostSealTeaching` | Query. Takes `Reference`; returns `Teaching` with the availability amendment below. Reads existing records only. |
| `learnV2PostSealTeaching.openPractice` | `learnV2CanvasMeasurementApi.openPostSealPractice` | Authenticated mutation. Takes `Reference`; returns the same amended `Teaching`. Independently retries teaching publication before attempting practice preparation. |
| `learnV2Assistance.authorizePracticeAssistance` | `learnV2CanvasMeasurementApi.authorizePracticeAssistance` | Authenticated mutation. Takes `PracticeHelpRequest`; returns `PracticeHelpAuthorization`. |

There are no Today aliases for these endpoints. None accepts owner, score,
content, case, publication approval or trusted binding from the client. The
existing response-acceptance endpoint accepts the practice slot; it is not an
additional post-seal content channel.

Every `status: 'available'` runtime teaching envelope now also contains:

```ts
availability: {
  feedback: 'scoring_pending' | 'feedback_publishing' | 'available' | 'unavailable'
  practice:
    | { status: 'not_opened' | 'available' }
    | { status: 'unavailable'; reasonCode: Reason }
}
```

These states carry no content, private scoring detail or case identity. The
feedback and practice states are independent: opening practice need not await
a score, and publishing feedback need not succeed in preparing practice.
Content remains exclusively in the existing nullable feedback, lesson and
practice fields, after their original authority and disclosure checks.

| State | Meaning and next transition |
| --- | --- |
| `feedback: scoring_pending` | Accepted, sealed work has pending, retryable or reconciliation-required scoring. No feedback or lesson is released. Practice may be opened independently. |
| `feedback: feedback_publishing` | An authoritative valid score permits feedback but the source is still pending. `publishPostSealFeedback` retries publication only (runtime.3). `openPostSealPractice` also retries it, but opens practice. |
| `feedback: available` | The immutable source has been published and currently permits feedback. A lesson additionally requires a valid scored failure. |
| `feedback: unavailable` | The accepted work currently has no eligible scored feedback, such as an invalid result. This is not publication progress. |
| `practice: not_opened` | No binding exists. The caller can invoke `openPostSealPractice`; the query creates nothing. This is distinct from failed disclosure. |
| `practice: available` | The existing binding and saved prompt pass current authority and separation checks. |
| `practice: unavailable` | Preparation or renewed practice authority failed. The content-free `reasonCode` identifies that failure; independently valid feedback and lesson remain readable. |
| Outer `status: unavailable` | Shared check authority, source publication, evidence, access, sealing or relevant-open-check admission failed, with the existing `Reason`. No content is released. |

Before scoring or practice opening, an authorized sealed read therefore reports
`scoring_pending` and `not_opened`, with all content null. Missing optional
pre-score storage is not `disclosure_unknown`. A missing source after an
authoritative score, duplicate sources, malformed publication or mismatched
attempt still fail closed. There is no query-side repair or inferred publication.

The scoring action attempts publication after the authoritative score commit.
An authorized practice-opening mutation always attempts that bounded, idempotent
publication first, independently of practice preparation. If another check
defers publication, a later call retries once authority permits it. No retry
rewrites an available or purged source, stamps an attempt outside score commit,
or requires a second score. Pending sources retain zero dependencies and no
links until the one atomic publication. Same-submission concurrent calls produce
one publication and at most one binding/slot. Unexpected failures escape the
transaction; domain denials do not erase independently published teaching.

The relevant-check inventory uses owner/phase/closing-time indexed reads and
excludes closed windows before applying its bound. At most eight currently
open checks and 64 future checks can be inspected. Future preparing rows do not
consume the open-check allowance. Unresolved scope or overflow of either bounded
set stays unknown; an actual relevant open check closes reads, help, replay,
practice preparation and practice acceptance until it seals or closes.

Retained-transfer checks are included. Their test-only publication, including
`transfer_challenge`, remains the sealed check and cannot acquire instructional
lineage. Teaching resolves the original instructional publication from the exact
canonical Independent basis attempt and its opportunity. That publication must
match the owner, Void, Blueprint and objective. Its teaching blocks still need
the same complete separation, reservation and evidence proof against the retained
check as for an ordinary application. The existing proven scoring-completion revision allowance
applies; unrelated revisions remain denied.

The retained check may be allocated after that instructional publication. The
older catalogue comparison is not evidence of separation from the new check:
first delivery must obtain the complete passing comparison against the exact
retained check, and replay must verify that sealed pair proof. This targeted
allowance does not change instructional registration, current reservation and
lineage checks, or any other disclosure caller.

New feedback uses the accepted, entailment-verified claim supporting the cited
instructional explanation, rather than labeling a canned outcome sentence T0.
The score outcome stays in the existing assessment result channel. New feedback
publications use `learn-v2.post-seal-feedback-copy.v1` in the existing publication
policy pin. Reads and retries validate the saved payload's sealed digest,
complete dependency manifest, separation proof and current authority. They never
reconstruct text or citation labels from the latest copy producer. A future copy
version must retain verification for existing approved publication versions;
it must not rewrite prior payloads. T0 feedback must match a currently verified
supporting claim independently of the copy producer. A canned outcome that
lacks that entailment remains unavailable, including in a previously saved
payload; it cannot be repaired by rewriting its immutable content.

The current hint producer delivers the verified explanation. It therefore has
the same valid-score, scored-failure and feedback-capability gate as the lesson,
on first delivery and replay. Pending, invalid and passing checks cannot obtain
that explanation through a hint. Separate-case worked examples retain the
practice gate and remain available without valid scoring. Every kind still
requires its shared exact-check separation proof and a content-bearing receipt.

New help is limited to eight distinct help contents per practice slot, as
counted by runtime.3. Prompt delivery plus a full slot therefore contributes at
most nine exposures to the existing 64-row Void history budget, rather than
exhausting it alone. All deliveries remain recorded, replayable at the limit,
and counted for case novelty. Acceptance retains its existing bounded 64-entry
verification for saved histories; the cap does not discard earlier support
timestamps or invalidate an existing receipt. It introduces no new evidence
exemption or storage schema.

## Integration amendment: `learn-v2.post-seal-teaching.v1.runtime.2`

This reconciles the runtime amendment with [#574's Today/Canvas API amendment](learn-v2-c1-public-api-contract.md#573-serial-amendment-today-points-to-canvas).
The public version, three endpoints and availability envelopes above stay the
same. No new storage or capability is introduced.

Post-seal admission, C4 help admission and the Today lesson gate share the same
bounded open-check collector and scope matcher. Owner/phase/closing-time index
ranges exclude expired windows. Unopened future preparing or ready checks use
the separate 64-row allowance; only current windows or an actual `test_open`
check use the eight-row open allowance. Baseline instructional checks are
excluded only by the guard's existing exact content binding. Overflow and
unresolved scopes remain unavailable. Post-seal admission also retains the
same-assignment rule. Cancelled checks never enter this collection. Today's
projection, lesson start and content delivery continue to use one lesson gate;
the startable/delivers invariant and the 136-case sweep remain required.

Measurement `flow` describes the teaching treatment. The frozen assignment
binding determines the check surface through `learnCheckUsesCanvasSurface`;
assignment and context bindings must agree. A `v2_today` treatment with Canvas
checks seals, scores and uses all three post-seal endpoints on the Canvas
surface, including after the Today capability is turned off for new enrollment.
The treatment is not rewritten to `v2_canvas`. Today pointers remain
`summary_or_own_work` and acquire no teaching, practice, help, question or score
content. The #574 Canvas receipt also keeps its own closed allowlist; these
post-seal endpoints are separate content channels for #442.

`closeUnplayableLearnCheck` closes only unanswered checks. It cannot cancel an
accepted submission or change its snapshots. A cancelled check without an
accepted submission releases no teaching. If a stored cancellation retains an
exact owned canonical submission and delivery grant, only the post-seal resolver
classifies it as accepted-invalid. Current access, evidence, pins and instructional publication
are still mandatory. It may retain separate-case practice and worked-example
replay; it releases no score-driven feedback, lesson or hint. Other disclosure
callers and the strict lifecycle schema keep their existing terminal behavior.
No response, attempt, phase, immutable payload or acceptance pin is repaired.

## Help and publication amendment: `learn-v2.post-seal-teaching.v1.runtime.3`

This amendment completes the help and retry surface consumed by
[#442](https://github.com/wescodess/budds/issues/442). The public request version,
storage and capabilities are unchanged. It supersedes runtime.1's raw-delivery
cap, its statement that only `openPostSealPractice` retries publication, and the
original rule that a changed key cannot reuse a saved delivery.
Changed payload, slot, revision or kind still cannot reuse one.

| Registered endpoint | Canvas alias | Transaction and result |
| --- | --- | --- |
| `learnV2PostSealTeaching.publishFeedback` | `learnV2CanvasMeasurementApi.publishPostSealFeedback` | Authenticated mutation. Takes `Reference`; returns the amended `Teaching`. Retries teaching publication only. |

`publishPostSealFeedback` derives the owner from authentication, checks account
deletion and opportunity ownership, then runs the same bounded, idempotent
publication as scoring and practice opening, which rechecks the full check
authority and relevant-open-check gate. It never creates a practice binding,
slot or exposure. A #442 client in
`feedback_publishing` uses this endpoint. Practice exposure happens only when the
learner opens practice through `openPostSealPractice`, preserving #363's
separate later-exposure fact. Denials return the existing outer `Reason`; a
disabled capability returns the original disabled envelope.

Practice help denials gain one reason. `PracticeHelpAuthorization` denials use:

```ts
type HelpReason = Reason | 'help_limit_reached'
```

`help_limit_reached` means the slot already holds the maximum number of distinct
help contents. It is distinct from `unavailable`, which still means the request is
not allowed yet or any longer, such as a hint before a valid scored failure.
Teaching read reasons are unchanged.

Every `status: 'available'` teaching envelope adds a content-free help state:

```ts
availability.help: null | {
  remaining: number
  hint: HelpState
  worked_example: HelpState
}
type HelpState =
  | { status: 'available' | 'delivered' }
  | { status: 'unavailable'; reasonCode: HelpReason }
```

`help` is `null` unless practice is `available`. `delivered` means the slot holds
a delivery of that kind; a request with any fresh key replays it. `available`
means a request would deliver new content, subject to renewed authorization.
`unavailable` uses `unavailable` for a closed or answered slot and for a gated
hint, and `help_limit_reached` when new content would exceed the cap.
`remaining` is the number of further distinct contents the slot can receive.
The state carries no text, receipt, authorization ID, time or sequence. It is
advisory: the help command remains authoritative and rechecks every gate.

The cap counts distinct help contents, by kind and exact saved payload, not raw
requests. A request whose kind and current payload match a saved receipt for the
same slot and revision replays that receipt's authorization ID, delivery time
and content after the full replay authorization. It creates no receipt, exposure,
source link or assistance counter, so it consumes no capacity. A replay under a
fresh key does not reserve that key. The current producers deliver one fixed
explanation per hint and one fixed worked example, so a slot holds at most two
help deliveries until a producer adds distinct content. The eight-content cap,
saved-request replay at the limit and acceptance's 64-entry history bound are
otherwise unchanged.

Accepted residual: one Void's 64-row exposure budget is shared across all of its
checks, prompts and help, so many checks in one Void can still exhaust it; this
amendment bounds each slot's share and does not change that budget.

## Receipt reference amendment: #587

Enabled Canvas saved-check receipts expose `postSealReference: Reference`,
including `result_unconfirmed` and `closed`, as specified in the
[public API contract](learn-v2-c1-public-api-contract.md#587-additive-canvas-timing-and-practice-reference).
This reference addresses the same existing endpoints and creates no new authority.
An owned accepted receipt can retain this identity when its content is unavailable;
post-seal access and publication still fail closed under runtime.1–runtime.3.
Practice remains reachable during pending, failed or unconfirmed scoring, and for
an accepted-invalid cancellation where runtime.2 permits it. Closed receipts due
to access/evidence loss or other failed gates cannot release practice merely by
carrying the reference. Relevant open checks, canonical sealing and delivery,
current pins, revocation, publication and exact separate-case proof remain
mandatory. Feedback retains its valid-score gate; lessons and hints retain their
valid-failure gate. No endpoint arguments, disabled response, stored record,
acceptance snapshot or capability default changes.
