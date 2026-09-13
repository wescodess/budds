# Repository history rewrite

The Budds history rewrite removes exposed credentials and generated repository noise while preserving meaningful authorship, dates, and feature topology. A rewrite is a coordinated security operation, not a cosmetic attempt to hide development history.

## Status

**Blocked:** Do not force-push rewritten refs until the exposed R2 credentials are rotated and GitHub Actions can execute successfully. The latest scheduled workflow is blocked by the account billing or spending limit before any step starts.

## Rewrite scope

Remove these paths from every rewritten branch and tag:

```text
testR2.ts
testFetch.ts
test-vueuse.ts
convex/debugQuery.ts
server/api/debug/testR2.post.ts
server/api/debug/testR2.post.test.ts
package-lock.json
screen_*.png
dist/**
.output/**
```

Replace every confirmed exposed credential value wherever it occurs before removing path-specific content. The replacement manifest must identify secret classes, not retain their values.

Preserve authorship, author dates, commit dates, meaningful feature commits, maintained decisions, and current source files. Do not collapse the project into a synthetic initial commit.

## Preconditions

- [ ] Revoke or rotate every exposed credential.
- [ ] Verify that old credentials can no longer authenticate.
- [ ] Resolve the GitHub Actions billing or spending restriction.
- [ ] Produce a green hosted `CI gate` from the intended baseline.
- [ ] Close or coordinate every open pull request.
- [ ] Freeze branch updates for the maintenance window.
- [ ] Create an access-controlled recovery bundle that will not be pushed.
- [ ] Record all branches, tags, pull-request refs, stashes, worktrees, and local tool refs that retain affected commits.

## Verification

Use a fresh mirror for `git filter-repo`. After filtering:

1. Confirm that the unwanted paths are absent from every branch and tag.
2. Scan every rewritten ref with Gitleaks.
3. Search for the exact revoked values without printing them.
4. Check out each surviving branch and run its appropriate validation.
5. Review the changed-ref manifest and affected pull requests.
6. Force-push once during the coordinated window.
7. Request GitHub cached-view and pull-request-reference cleanup when necessary.
8. Remove affected local stashes and tool checkpoint refs, then re-clone.
9. Verify from a fresh clone that old object IDs are unavailable through normal repository refs.

## Recovery

Keep the recovery bundle offline and access-controlled until the rewritten repository, deployments, and required clones pass verification. The bundle still contains revoked credentials and must never become a normal repository artifact. Destroy it according to the incident-retention decision after the recovery window closes.
