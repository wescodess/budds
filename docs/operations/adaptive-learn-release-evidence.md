# Adaptive Learn release evidence

The release-evidence assembler creates a reproducible metadata bundle for one tested Git commit. It does not run audits, verify external artifacts, approve a release, grant an entitlement, or dispatch provider work. A complete assembly remains unverified and activation-denied until the independent release process supplies actual evidence and responsible approvals.

## Assemble one candidate

Create a metadata-only input that follows [the versioned schema](./adaptive-learn-release-evidence.v1.json). Record release, flag, rollback, and support owners without including credentials, learner content, private source locations, or provider payloads. Use opaque artifact identifiers and content digests to reference separately retained evidence.

Run the CLI from the repository root with the candidate's full lowercase 40-character commit SHA and the input path. The CLI reads fixed repository artifacts from that commit rather than trusting the current working tree, makes no external requests, and prints canonical JSON to standard output.

```bash
# Repository root; replace both placeholders with the candidate and metadata path.
node scripts/adaptive-learn-release-evidence.mjs --sha FULL_TESTED_COMMIT_SHA --input /absolute/path/release-input.json
```

Retain the generated bundle outside the source tree when it contains operational owner or evidence metadata. Repeating assembly with the same commit and equivalent metadata produces the same bundle; no generation timestamp or random identifier changes its identity.

## Interpret the result

The bundle pins repository source digests and version metadata at the selected commit. Its evidence entries link hosted gates, provider quota and configuration checks, keyboard and physical screen-reader smoke checks, WCAG 2.2 AA and security reviews, migration/export/deletion checks, and metric definitions. A source or version link identifies what reviewers must examine; it does not prove that a check ran or passed.

Missing owners, missing evidence, incompatible SHA or source pins, unresolved blockers, and local-only substitutes remain explicit known exclusions. Malformed, unsafe, or over-limit metadata fails with a non-content error and no bundle. A valid incomplete input produces a denied bundle so reviewers can see what remains missing.

The assembler treats every supplied result and reviewer identity as an unverified claim. Even an input that claims all checks passed cannot authorize activation. Actual hosted execution, live provider availability and finite quotas, physical assistive-technology observations, WCAG/security review, and accountable human approval remain separate release gates.

## Preserve runtime authority

ALA 6.4 owns deterministic assembly only. The [cohort activation approval artifact](./adaptive-learn-activation-approval.v1.json) remains separate, and the [canonical entitlement gate](./adaptive-learn-activation-controls.v1.md) remains the only adaptive runtime authority. Bundle generation does not change existing access, revoke owners, reactivate a cohort, resume denied provider jobs, or certify a seven-day production soak.
