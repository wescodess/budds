# Post-seal teaching read contract

Contract: `learn-v2.post-seal-teaching.v1`. Implements [C1.4 #533](https://github.com/wescodess/budds/issues/533), consuming the [approved Canvas experience](../design/learn-delayed-check/decision.md). The owner chose this post-seal contract on 2026-11-08. All new handlers stay inactive and write nothing.

## Public shape

`learnV2CanvasMeasurementApi.getPostSealTeaching` references `learnV2Assessments.getPostSealTeaching`. Arguments and returns have closed Convex validators in `convex/lib/learnV2PublicContract.ts` and strict, bounded schemas in `shared/learn-v2-assessment-disclosure.ts`.

```ts
type Version = 'learn-v2.post-seal-teaching.v1'
type Reason = 'disabled' | 'unavailable' | 'not_sealed'
  | 'evidence_unavailable' | 'disclosure_unknown'
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
      feedback: { text: string; citations: Citation[] } | null
      lesson: { paragraphs: string[]; citations: Citation[] } | null
      practice: {
        responseSlotId: Id<'learnResponseSlots'>
        revision: number
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
      content: { kind: 'hint' | 'worked_example'; text: string }
    }
```

`learnV2CanvasMeasurementApi.authorizePracticeAssistance` references `learnV2Assistance.authorizePracticeAssistance`. Its result is the only new public channel for practice hints and worked examples. The teaching read has neither field, even after sealing or on replay. Both commands derive the owner from authenticated `tokenIdentifier`, check account deletion, and authorize the referenced opportunity; help also authorizes the response slot and its owning scope. Neither accepts an owner, phase, capability, trusted binding, content or score from the client. Existing Today/Canvas commands and assistance authorization keep their shapes.

Current read result: `{ version, status: 'unavailable', reasonCode: 'disabled' }`. Current help result: `{ version, status: 'denied', reasonCode: 'disabled' }`. They contain no acknowledgement, submission, authorization reference, content or fabricated phase/result. No environment value enables either handler.

Text is nonempty and at most 12,000 JavaScript code units; citation labels are at most 300 and public source references at most 200. Feedback and lessons require 1–16 citations. Lessons have 1–8 paragraphs. Original serialized envelopes are bounded by the existing 64 KiB contract ceiling, without truncation. Revisions are positive safe integers, timestamps are bounded integers, and command keys retain the existing 16–128-character URL-safe format. Convex validators enforce closed structure; the shared parsers additionally enforce these semantic bounds before publication.

## Disclosure and the #373 amendment

This read alone widens [#373's result rule](https://github.com/wescodess/budds/issues/373#issuecomment-6651824980) from its bounded feedback taxonomy to separately published, cited feedback text and a follow-up lesson. It does not widen an existing result, export, help, history, Today or Canvas payload.

| Content | Required authority |
| --- | --- |
| Any content | Owned, accessible evidence; matching immutable pins and delivery grant; approved public publication; an accepted submission and server acceptance time proving sealing |
| Practice prompt/slot/revision | Sealed check and available `canTeachSeparateCase`; an owned practice-stage slot bound to that exact opportunity/submission/revision; verified separate case and nonreserved lineage |
| Feedback text and citations | Authoritative attempt, valid score, scored pass/fail phase, and available `canReadFeedback` |
| Lesson | All feedback authority, with phase `scored_fail` |
| Hint or worked example | All practice authority, followed by the matching practice authorization response |

Preparing, ready, open, cancelled, abandoned and invalid-without-acceptance states release no teaching, regardless of capability booleans or replay. Sealed pending, retryable-failure, reconciliation-required and accepted-invalid states can permit separate-case practice, without score-driven feedback or a lesson. Sealing is derived from canonical acceptance, never an activity status, client receipt or provider outcome.

`projectPostSealTeaching` and `projectPracticeAssistanceAuthorization` freeze these gates for the runtime implementation. Their context is internal server-derived authority, not public arguments. Publication approval means the content has passed the shared disclosure/lineage boundary: no reserved solution, check case, sibling form or private scoring material. Unknown publication, case relation, reservation, ownership, pins or grant remains unavailable. `sourceRef` is a public opaque citation reference; it is not a private source/excerpt ID, locator, URL authorization or access grant. Reads and authorization replay recheck current access/evidence and publication authority.

After authority checks, any stored source/receipt or final-envelope validation failure, including byte ceilings and withheld fields, returns `unavailable`/`denied` with `disclosure_unknown` and no partial content; malformed public arguments and server context continue to throw.

Every return object is allowlisted. Neither successful nor unavailable results can carry score percentages, thresholds, criteria, rubric keys/descriptions/snapshots, weights, per-criterion verdicts, scorer rationale, model confidence/details, answer keys, reference solutions, item/family/case IDs, private source identifiers/locators, or provider payloads. Structural schemas cannot prove arbitrary prose is safe; the runtime publication and lineage checks must establish that before supplying the source DTO. ADR-0009's provenance and T0 restrictions still apply; this contract adds no generation or provenance-policy change.

## Practice assistance and replay

The help target is exclusively `{ responseSlotId }`. The sealed opportunity is authorization context, never the assistance target. The server-only practice binding must prove ownership, `stage: 'practice'`, the exact check submission and slot revision, `caseRelation: 'separate_case'`, and `reservedCase: 'no'`. A same-case, sibling, reserved, unknown, foreign or stale binding releases neither practice nor help.

The internal receipt input freezes the complete request and its authorization result. Same key and canonical request replay the same saved authorization ID, delivery time and content; changed key/payload, slot, revision or help kind cannot reuse it. The authorization's delivery time cannot precede the check's acceptance time. Replay rechecks authorization before reading the receipt content. The helper validates a supplied receipt; it does not create, persist or acknowledge one.

Preserve [#363's three separate exposure facts](https://github.com/wescodess/budds/issues/363#issuecomment-6651831618): prior teaching/case exposure, assistance delivered to the current opportunity before sealing, and later exposure. Practice help is delivered to its practice slot and is later exposure relative to the check. It cannot increment the sealed check's assistance revision, alter its acceptance snapshot, or be passed to its legacy assistance recorder. Denial is not delivered assistance. Later evidence of actual pre-seal contamination still uses an appended integrity event; this read cannot erase or rewrite it. Ordinary session-wide assistance caps and legacy unknown-history semantics are unchanged.

## Runtime follow-up

The runtime ticket must implement the following before the Canvas replaces its temporary teaching binding and #532 leaves draft:

- Resolve ownership, canonical acceptance/sealing, authoritative score validity/current eligibility, capabilities, grant/pins and current evidence/access through Convex. Recheck revocation and account deletion on every read and replay; a query must not mint a grant.
- Publish safe cited feedback and a valid-failure-only lesson, without reconstructing a reserved solution or private criterion rationale. Enforce ADR-0009, source rights, lineage, bounded content and byte ceilings. No unchecked stored JSON or fallback snapshot may bypass the projection.
- Select and persist the different, nonreserved practice case and response slot once, binding their immutable revisions to the sealed check submission. Same-case/sibling/unknown lineage fails closed. Practice remains available during pending, failed and unconfirmed scoring when the server capability permits it, without requiring confidence or score success.
- Serialize help authorization, slot acceptance and delivery/exposure accounting. Persist immutable content-bearing receipts with canonical request fingerprints, reject idempotency conflicts and stale/foreign targets, and replay the same content after renewed authorization. Keep slot assistance and later exposure separate from frozen check assistance. Assess persistence needs through the serial schema owner before adding storage; this inactive contract requires no schema edit.
- Apply source/access purge, retention, owner export, account deletion and telemetry omission to every new content/receipt/binding copy. Export gains no new content permission from this amendment. Cover revocation races, cross-tab retries and help/acceptance races with real persisted records.
- Replace #442's temporary `laterTeaching` channel using these server reads and authorization results, under its existing UI ownership and release gates. Run the runtime endpoint/alias matrix; contract fixtures here do not establish runtime publication, generation, persistence or production readiness.

No schema, frontend, runtime generator/selector, flag, environment, deployment, migration, enrollment or provider operation is introduced by C1.4.
