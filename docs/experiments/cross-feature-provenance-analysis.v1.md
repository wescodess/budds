# Cross-feature provenance analysis v1

Status: DRAFT — UNAPPROVED. Freeze approval and exposure remain blocked.

ALA 5.5 defines a reproducible analysis artifact, not an approved experiment. Product Analytics has not supplied an approved corpus, minimum practical effect, or named owner, approver, and verifier. The checked-in corpus is synthetic and cannot establish server-verified lineage or learner benefit.

## Run and reproduce

```bash
node scripts/cross-feature-provenance-analysis.mjs
node scripts/cross-feature-provenance-analysis.mjs --fixture docs/experiments/cross-feature-provenance-fixture.v1.json
pnpm exec vitest run shared/cross-feature-provenance-analysis.test.ts
```

The read-only CLI emits `cross-feature-provenance-analysis.v1` JSON to stdout. It does not contact Convex, providers, or analytics services, write learner state, or change activation artifacts. Repeat runs over semantically identical input produce identical bytes. SHA-256 digests bind the canonical input and frozen analysis contract; they establish reproducibility, not authorship, independent verification, or approval. Invalid input exits nonzero with a generic diagnostic that does not echo its contents.

## Draft decision contract

| Field | Frozen mechanics | Approval boundary |
| --- | --- | --- |
| Eligible contributions | Immutable Quiz result (`quiz_result`) and accepted-attempt Chat discussion projection (`chat_discussion_projection`), associated with the same activity and accepted attempt. | Synthetic identifiers do not verify actual server lineage. Other producers need their own verified workflow before inclusion. |
| Next-action outcome | Representative next-action task passes and usefulness rating is at least 4 of 5. Clicks and completion alone are not successes. | This is a proposed synthetic metric, not an approved task, rubric, usefulness instrument, or outcome window. |
| Denominator | All eligible assigned activity cases in each baseline/treatment arm, including cases with missing outcome evidence. | Product Analytics must approve the population and assignment/corpus sampling rule. |
| Comparison | Treatment success rate minus baseline success rate, on an absolute proportion scale. | A missing outcome or empty arm prevents a numeric comparison. No uncertainty or statistical qualification is claimed. |
| Minimum practical effect | Nullable input, recorded in the contract and its digest. | Checked-in value is null. A supplied fixture value is not an approved threshold. |
| Corpus size | Total cases, eligible/excluded cases, contribution count, and input digest. | The tiny checked-in corpus is a mechanics fixture, not a frozen evaluation corpus. |
| Duplicate-attempt test | Compare accepted attempt identities before and after reuse; added or removed identities violate preservation. | Snapshot observations are synthetic, not authenticated server exports. |
| Silent-mastery assertion | Authoritative cumulative mastery increment count must remain unchanged across reuse. | Missing snapshots are unknown, not a zero-violation pass. |
| Origin visibility assertion | Original and contributed source origins remain visible with their feature identity preserved after reuse. | Missing snapshots are unknown; no live accessibility or producer-wide provenance proof is claimed. |
| Owner / approver / verifier | Nullable, opaque fixture labels frozen into the contract. | Product Analytics must supply named accountable people and retained independent review records outside this fixture. |

The analysis distinguishes known rates, incomplete evidence (`unknown`), and an empty denominator (`no_denominator`). Safety assertions report observed violations and missing evidence rather than assuming zero. Unrelated activities remain separate; matching source labels or client-provided aliases are not reconciliation authority.

This contract does not replace `cross_feature_improvement.v1` in [the existing outcome registry](../operations/adaptive-learn-outcomes.v1.md). It supplies the separate ALA 5.5 decision artifact. Approved metric/query mapping and any registry revision must be reviewed before corpus freeze.

## Input and privacy

Use the checked-in `cross-feature-provenance-fixture.v1.json` as the input shape. Input is strictly validated synthetic JSON, bounded to 65,536 bytes, 100 cases, and 500 combined case, contribution, attempt-snapshot, and origin-snapshot rows. Identifiers are opaque `fixture-` labels, not production account, activity, attempt, contribution, or source identifiers. Do not include answers, free-form learner content, private locators, provider responses, or personal data. Unknown fields are rejected; digests are not a substitute for redaction.

The fixture records baseline/treatment cases, eligibility, contribution activity/attempt/origin associations, before/after attempt identities, mastery counts and origin visibility, and nullable task-pass/usefulness outcomes. Nullable observations preserve missing-evidence states. The supplied `approved` declaration is untrusted metadata only.

## Approval and exposure

Every result is `approval: "unapproved"`, `exposureAllowed: false`, `synthetic: true`, and `trustedServerLineage: false`. Populating effect values or role labels, setting `approved: true`, or obtaining a positive synthetic difference cannot change these states. This CLI does not create or modify an approval record.

Before ALA 5.6 freeze approval or any exposure, Product Analytics must provide the approved representative corpus and selection/assignment rule; pinned task, rubric, usefulness measure and observation window; approved metric/denominator and minimum practical effect; sample and decision rules; named owner, independent approver and verifier; and retained, independently reviewed provenance and reproducibility evidence. Production approval and exposure remain denied by the existing server artifacts. ALA 5.7 activation is outside this implementation.
