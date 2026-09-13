# Production release checklist

Release Budds only from a clean, reviewed, and pushed commit. A passing local build does not prove provider availability, deployed bindings, billing, or production behavior.

## Before promotion

- [ ] If GitHub Actions is available, the repository-owned `CI gate` passes on the pull request.
- [ ] `pnpm verify` and a strict `pnpm build` pass from the exact release commit.
- [ ] Dependency and secret scans report no blocking findings.
- [ ] Schema changes follow the widen-migrate-narrow sequence.
- [ ] Environment changes are documented without values.
- [ ] Provider budgets, quotas, and fail-closed behavior are confirmed.
- [ ] Known limitations and acceptance gates are current.
- [ ] A rollback target and deployment identifiers are recorded.

GitHub-hosted Actions is currently blocked by the account billing or spending restriction, and the private repository cannot use branch protection on the current plan. The owner has declined a paid upgrade. While that remains true, use a pull request, allow squash merges only, do not push directly to `main` or `dev`, and record the complete local gate output and exact tested SHA in the pull request or release record. This is a maintainer protocol, not a server-enforced control.

## Deployment

- [ ] Deploy backward-compatible Convex changes first.
- [ ] Deploy the Audio Overview Worker with remotely managed values preserved.
- [ ] Promote the tested commit through the Cloudflare Pages Git integration.
- [ ] Avoid duplicate manual and Git-integrated Pages deployments.

## Verification

- [ ] Verify public frontend health.
- [ ] Complete an authenticated OAuth and Convex data-loading smoke test.
- [ ] Exercise upload, indexing, grounded chat, and source citations.
- [ ] Run the owner-authorized Audio Overview provider path when it is in release scope.
- [ ] Confirm private media authorization, range playback, telemetry, and cleanup.
- [ ] Confirm scheduled Convex jobs and Worker observability.

## Release record

Record the version, exact commit SHA, deployment identifiers, migrations, configuration changes, evidence links, known limitations, and rollback result. Use a signed release tag after all required gates pass.
