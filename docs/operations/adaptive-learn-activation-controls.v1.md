# Adaptive Learn cohort activation and rollback

ALA 6.3b requires reviewed activation evidence before an internal cohort grant. The shipped approval artifact remains denied, with no assigned approving principals or live release evidence. Local tests and browser fixtures do not authorize exposure.

## Approval and runtime authority

`docs/operations/adaptive-learn-activation-approval.v1.json` records the `adaptive-activation-approval.v1` server configuration for scope `adaptive_cohort_entitlement`. Positive approval requires a tested revision, named accessibility, security, operations, and rollback owners, and compatible evidence references for the reviewed release. Missing, malformed, unapproved, or conflicting configuration denies new grants.

The internal cohort mutation derives its owner from authentication and rejects deletion tombstones. A learner cannot supply an approving principal, release revision, evidence record, or another owner's identity as a command argument. Shape validation checks the approved record's contract; it does not independently authenticate an audit or turn a claimed reference into reviewed evidence. The record's `testedSha` is not an independently observed deployed revision.

The canonical runtime guard remains the conjunction required by AD-8 and AD-12: exact V2 rollout flag, existing V2 access, and the owner's adaptive entitlement. The entitlement remains exactly `{ enabled, updatedAt }`; this slice adds no per-epic feature flag, approval table, or public administrative API. Independent V1/V2 authority and provider controls retain their existing boundaries.

## Rollback boundary

An authorized internal entitlement revocation does not require a currently valid positive approval. The next canonical access decision denies adaptive entry, reads, writes, and new job admission. An owner who still has V2 access receives the named `/app/learn?legacy=v2` fallback; otherwise the response names the classic folder entry at `/`.

Revocation does not delete or rewrite threads, activities, saved responses, artifacts, accepted evidence, attempts, mastery, or their provenance. Owner export, thread/account deletion, source purge, and pending cleanup retain their established maintenance authority. A fresh grant cannot authorize replay of previously ambiguous provider work or bypass the separate default-denied provider manifest.

Approval is evaluated at grant, not added as another runtime conjunction. Editing the artifact does not automatically revoke existing entitlements, and this slice does not provide an instantaneous global revocation operation. Operators must not infer global rollback, approval-expiry enforcement for already granted owners, or completed reactivation/soak evidence from these mechanics.

## Local evidence and remaining gates

Positive test configurations are synthetic. Disposable browser bootstrap stays behind the existing loopback platform-URL, mode, and token boundary; production deployments cannot use that bootstrap. Test configuration must not grant users automatically or replace the public canonical access decisions with private-helper assertions.

Public Convex status, commands, and owner export establish the local admission and preservation behavior. Browser checks establish the tested page's visible recovery path, not actual screen-reader speech, WCAG certification, live provider access, deployed release approval, or seven-day production soak.

The staged activation manifest, deployment evidence bundle, independent audits, support drills, and fresh reactivation decision belong to their later issues. Actual evidence owners and approval remain missing until the responsible reviewers supply and approve the release record. Keep the issue and exposure blocked while those gates are unresolved.
