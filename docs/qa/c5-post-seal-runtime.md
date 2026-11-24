# C5.6 post-seal runtime

The frozen public version remains `learn-v2.post-seal-teaching.v1`. Storage uses
the landed #570 contract. Responses, delivery, enrollment and scoring defaults
are unchanged. This implementation adds no frontend, provider invocation,
migration or deployment.

## Preparation and publication

An authenticated backend caller can invoke
`internal.learnV2PostSealTeaching.preparePractice` with the sealed opportunity
and an existing instructional `faded_example` block. The transaction verifies
the block's complete, registered publication and current source graph, including
the case catalogue and its complete reservation decision. It selects the proven
separate case and creates one practice slot, immutable submission binding,
normalized dependencies and prompt delivery exposure together. Retries preserve
that slot and case. Unsupported, same-case, sibling, reserved or unknown input
remains unavailable. No candidate content is generated here.

`commitSealedMasteryAttempt` stamps the source with the canonical attempt in its
score transaction. A missing source becomes pending with zero dependencies and
no links. A null stamp on a purged source can be filled without restoring bytes.
Duplicate, malformed and conflicting optional teaching state cannot reject the
canonical score commit.

`internal.learnV2PostSealTeaching.publishTeaching` publishes once after an
authoritative valid score. Feedback gives a bounded outcome statement with
opaque citations. A valid failure additionally receives the source-verified
explanation from the practice content's registered instructional session.
Publication seals the exact payload, complete dependency manifest and validation
digests in the same transaction as all source links. This producer uses verified
T0 content; it does not infer T1 or T2 provenance from unlabelled legacy text.
The frozen schemas retain their ADR-0009 tier restrictions.

Preparation requires an existing passing instructional reservation decision.
The default unavailable semantic validator is unchanged. Synthetic decisions
in fixtures establish runtime behavior, not production case equivalence or
permission to activate collection.

## Reads, help and lifecycle

`getPostSealTeaching` reads existing publications and never prepares content or
mints a grant. Every read and help replay rechecks authentication, deletion,
ownership, canonical acceptance, current score eligibility, evidence, grant,
pins, publication and the owner-scoped relevant-check inventory. The bounded
open-phase index ranges serialize with check acceptance. A second relevant
check, including another horizon on the same assignment, closes teaching and
help. Overflow or unresolved scope remains unknown.

`authorizePracticeAssistance` checks both the public check gate and the exact
live practice binding before first delivery. Hint content comes from its
verified explanation; worked examples use the corresponding verified
instructional block. Each delivery atomically saves an immutable content-bearing
receipt, independent exposure, complete source links and slot assistance
counters. Canonical key/request hashes prevent payload substitution. Replay
passes through `projectPracticeAssistanceAuthorization` after renewed authority
and returns the saved ID, time and content.

Help preserves the response revision and original prompt delivery exposure.
Both exposure kinds carry the binding's practice case and omit
`assessmentOpportunityId`. Practice acceptance freezes its own assistance and
purge dependencies. It changes neither the sealed check nor its assistance
snapshot, session counters, score or report facts.

Every content copy uses the #570 reverse-source purge registration. Entitlement
revocation also schedules eight-row redaction pages; renewed access cannot
restore purged copies. Void/account deletion and direct/ZIP owner exports use
the existing shared registrations. New rows remain metadata-only in export and
are omitted from telemetry.

## Verification boundary

`convex/learnV2PostSealRuntime.test.ts` invokes registered endpoints with real
persisted opportunities, grants, submissions, executions, attempts, case
publications, bindings, slots, receipts and source links. Native transaction
limits are enabled. Coverage includes same-key and changed-key retries,
practice acceptance and competing-check acceptance, source and entitlement
revocation, citation-only dependencies, pending/failure/reconciliation/invalid
states, score stamps, invalid teaching state, issuer isolation, deletion guards,
owner export and Canvas aliases. Existing contract, storage, delivery, response
and C4 parity suites remain separate evidence.

These checks do not establish frontend integration, human provenance labels,
production enrollment, provider/scorer accuracy, empirical form equivalence or
learning outcomes. Independent review remains the orchestrator's gate at the
final PR head.
