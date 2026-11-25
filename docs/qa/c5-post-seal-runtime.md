# C5.6 post-seal runtime

The public version remains `learn-v2.post-seal-teaching.v1`, with the versioned
`learn-v2.post-seal-teaching.v1.runtime.1` and `.runtime.2` contract amendments. Storage uses
the landed #570 contract. Responses, delivery, enrollment and scoring defaults
are unchanged. This implementation adds no frontend, provider invocation,
migration or deployment.

## Preparation and publication

The authenticated mutation `learnV2PostSealTeaching.openPractice` opens practice
for a sealed opportunity. It resolves the pinned instructional session content,
or the original session from a measurement item's generation job, and selects
its single `faded_example` block. The transaction verifies
the block's complete, registered publication and current source graph, including
the case catalogue and its complete reservation decision. It selects the proven
separate case and creates one practice slot, immutable submission binding,
normalized dependencies and prompt delivery exposure together. Retries preserve
that slot and case. Unsupported, same-case, sibling, reserved or unknown input
remains unavailable. No candidate content is generated here.

Retained-transfer checks use the instructional publication from their exact
canonical Independent basis attempt and opportunity. Their current test-only
publication remains excluded from instructional registration. A retained case
allocated later requires a fresh complete comparison against that exact check;
an older catalogue decision alone never authorizes delivery.

Every post-seal artifact uses one separation helper with the same normalized
prompt identity as the sealed check and its registered source lineage. It checks
the actual practice, help, feedback or lesson payload, including saved content
on reads and replay. First delivery requires a complete passing comparison
against that exact check, including ordinary checks outside the reserved corpus.
The publication digest seals the artifact kind, actual payload, identities and
comparison decision. Reads and replay verify that proof and current authority
without invoking a validator. Earlier publications lacking this complete proof
remain unavailable under the immutability rule.

Publication rejects only equal practice/application prompts after canonical
Unicode, case and whitespace normalization. Operators and numbers remain part
of identity. Fuzzy similarity does not reject publication or establish case
separation; delivery requires the complete semantic decision above.

`commitSealedMasteryAttempt` stamps the source with the canonical attempt in its
score transaction. A missing source becomes pending with zero dependencies and
no links. A null stamp on a purged source can be filled without restoring bytes.
Duplicate, malformed and conflicting optional teaching state cannot reject the
canonical score commit.

The scoring action calls `internal.learnV2PostSealTeaching.publishTeaching`
after the authoritative score commits, including on a score retry. Practice
opening retries publication before attempting preparation, independently of its
success, when a valid score already exists. These
publication transactions remain separate from the canonical score commit;
unexpected publication errors propagate without undoing that score. Feedback
and lessons resolve the same pinned instructional publication independently of
practice preparation. Feedback quotes a verified supporting claim with opaque
citations; it does not label canned outcome copy T0. A valid failure additionally receives the source-verified
explanation from the practice content's registered instructional session.
Publication seals the exact payload, complete dependency manifest and validation
digests in the same transaction as all source links. This producer uses verified
T0 content; it does not infer T1 or T2 provenance from unlabelled legacy text.
The schemas retain their ADR-0009 tier restrictions. Feedback copy is versioned
in the existing publication policy pin. Reads verify the sealed stored payload
and current authority without rebuilding text or citation labels.

Preparation requires an existing passing instructional reservation decision.
The default unavailable semantic validator is unchanged. Synthetic decisions
in fixtures establish runtime behavior, not production case equivalence or
permission to activate collection.

## Reads, help and lifecycle

`getPostSealTeaching` reads existing publications and never prepares content or
mints a grant. Every read and help replay rechecks authentication, deletion,
ownership, canonical acceptance, current score eligibility, evidence, grant,
pins, publication and the owner-scoped relevant-check inventory. The bounded
owner/phase/closing-time index ranges serialize with check acceptance. The collector
and scope matcher are shared with C4 help admission and the Today lesson gate. Closed
windows are excluded; up to 64 future windows use a separate allowance from
the eight currently open checks. A second relevant
check, including another horizon on the same assignment, closes teaching and
help. Overflow or unresolved scope remains unknown. Successful envelopes expose
independent, content-free feedback and practice availability, distinguishing
scoring, publication, unopened practice and practice failure. A practice failure
withholds its prompt without hiding independently valid teaching.

Post-seal session admission uses the response's immutable acceptance pins.
Ordinary scoring may complete an `independent_application` or `retained_transfer`
session at exactly the accepted revision plus one. Admission verifies the exact
session/check/submission, unchanged assistance, canonical transition, succeeded
scoring job and consumed execution. Canvas may also advance the opportunity's
delivery anchor to that completed revision; the accepted response stays frozen.
Practice slots retain acceptance pins and tolerate only that proven delivery
anchor. Other disclosure callers keep their strict revision equality.

Dedicated C5 sealing completes its session without advancing its revision.
Dedicated expiry and due-work closure, including `system_due_work_late`, also
preserve it. Closed checks without a submission never acquire post-seal
authority. Ordinary expiry only changes planned/ready sessions, so it supplies
no revision allowance for an accepted in-progress application. Generation,
reflow, retention and post-seal legacy assistance do not acquire a completion
allowance. Any extra revision or mismatched completion proof closes admission.

`authorizePracticeAssistance` checks both the public check gate and the exact
live practice binding before first delivery. Hint content comes from its
verified explanation and shares the lesson's valid-scored-failure gate, including
on replay; worked examples use the corresponding verified
instructional block. Each delivery atomically saves an immutable content-bearing
receipt, independent exposure, complete source links and slot assistance
counters. Canonical key/request hashes prevent payload substitution. Replay
passes through `projectPracticeAssistanceAuthorization` after renewed authority
and returns the saved ID, time and content.

Today-treatment checks with a frozen Canvas surface use the same post-seal
endpoints, including after capability rollback. Surface is read from the frozen
assignment binding, while the measurement treatment remains `v2_today`. The
Today pointer and Canvas receipt keep their own allowlists. Unanswered cancelled
checks do not block teaching. A proven sealed cancellation has only
accepted-invalid separate practice authority; score-driven teaching stays closed.
The ordinary disclosure resolver retains its original behavior.

Help preserves the response revision and original prompt delivery exposure.
Acceptance checks the complete owner/slot exposure history against the slot's
sequence, counters and latest authorization, and freezes the first delivered
timestamp of each assistance kind. New deliveries are limited to eight per slot,
so its prompt and help exposures cannot alone exhaust the 64-row Void history
budget for unrelated cold checks. Saved requests still replay at the limit and
the response remains acceptable; acceptance retains the existing 64-entry bound
for previously saved support histories.
Both exposure kinds carry the binding's practice case and omit
`assessmentOpportunityId`. Practice acceptance freezes its own assistance and
purge dependencies. It changes neither the sealed check nor its assistance
snapshot, session counters, score or report facts.

Both exposures use the canonical prompt case, so enrollment and replacement
selection count prior practice. Novelty excludes the current opportunity's own
exposures only when the caller explicitly supplies that opportunity ID.

Every content copy uses the #570 reverse-source purge registration. Entitlement
revocation also schedules eight-row redaction pages; renewed access cannot
restore purged copies. Void/account deletion and direct/ZIP owner exports use
the existing shared registrations. New rows remain metadata-only in export and
are omitted from telemetry.

## Verification boundary

`convex/learnV2PostSealRuntime.test.ts` invokes registered endpoints with real
persisted opportunities, grants, submissions, executions, attempts, case
publications, bindings, slots, receipts and source links. Native transaction
limits are enabled. A public seal/score/open/read regression covers both trigger
orders, concurrent triggers and retries without invoking the internal writers.
Coverage also includes mixed and repeated help, same-key and changed-key retries,
practice acceptance and competing-check acceptance, source and entitlement
revocation, citation-only dependencies, pending/failure/reconciliation/invalid
states, score stamps, invalid teaching state, issuer isolation, deletion guards,
owner export and Canvas aliases. Existing contract, storage, delivery, response
and C4 parity suites remain separate evidence.

`convex/learnV2PostSealTransitions.test.ts` covers public ordinary scoring with
and without assistance, a Canvas check with live instructional publications,
dedicated sealing/expiry/due-work closure and unrelated stale revisions. It
also rejects missing transition evidence, an unconsumed execution and changed
assistance after acceptance, without changing frozen acceptance records.
It also covers colliding historical publications, sibling and unknown lineage,
incomplete pair decisions, separate-case retries and canonical practice exposures.
Retained-transfer scoring, large future-check inventories, independently
retryable publication, availability transitions, copy stability, hint/lesson
gating and the eight-delivery limit also have persisted regression coverage.
Every help kind, feedback and lesson has collision and replay coverage. Distinct
atlas countries, arithmetic operators and numbers retain publication coverage.
The measurement suite exercises enrollment and replacement selection with
persisted practice exposures that have no assessment opportunity.

These checks do not establish frontend integration, human provenance labels,
production enrollment, provider/scorer accuracy, empirical form equivalence or
learning outcomes. Independent review remains the orchestrator's gate at the
final PR head.
