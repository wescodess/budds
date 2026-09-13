# Repository history rewrite

The Budds history rewrite removes exposed credentials and generated repository noise while preserving meaningful authorship, dates, and feature topology. A rewrite is a coordinated security operation, not a cosmetic attempt to hide development history.

## Status

**Completed 2026-09-13:** Rewritten `main` and `dev` now share the verified production-baseline tip. Twenty-seven fully merged remote branches were removed, and the three unmerged branches were preserved in rewritten form. The owner reports that the exposed credentials were rotated; authentication with the old values was not independently exercised during repository cleanup.

GitHub-hosted Actions remains unavailable because of the account billing or spending restriction, and private-repository branch protection is not available on the current plan. Those account constraints are recorded rather than represented as working controls; the release substitute is the complete local gate below.

## Dry-run evidence

The 2026-09-13 isolated mirror rehearsal produced this evidence without changing GitHub:

- `git-filter-repo` rewrote 592 commits.
- Every targeted path was absent from surviving branch and tag history.
- Both confirmed credential values had zero occurrences in rewritten patches.
- Gitleaks reported zero findings across rewritten branches and tags with the repository's narrow fixture allowlist.
- The rewritten production-baseline tree matched the verified source tree exactly.

## Execution evidence

- The final rewrite scanned 419 reachable commits with Gitleaks and reported zero findings.
- Both confirmed credential values had zero occurrences in rewritten patches.
- Every targeted root, debug, lockfile, and generated-output path was absent from surviving history.
- `git fsck --full --strict` completed without repository-integrity errors.
- A fresh local checkout matched the tested production-baseline tree exactly.

One local Codex checkpoint pointed directly to an old tree object and could not be rewritten as a commit. It was covered by the private recovery bundle and removed with the other local checkpoint and stash refs after the coordinated rewrite. It was never a remote branch or tag.

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

- [x] Owner reports every exposed credential revoked or rotated.
- [ ] Independently verify that old credentials can no longer authenticate (owner-managed follow-up; not a rewrite blocker after reported rotation).
- [x] Record the unavailable GitHub-hosted gate and current-plan branch-protection limitation.
- [x] Produce a green local `pnpm verify`, strict production build, Gitleaks scan, and rewritten-ref verification from the intended baseline.
- [x] Confirm that there are no open pull requests to coordinate.
- [x] Freeze branch updates for the maintenance window.
- [x] Create an access-controlled recovery bundle that will not be pushed.
- [x] Record all branches, tags, pull-request refs, stashes, worktrees, and local tool refs that retain affected commits.

The repository owner has declined a paid GitHub plan. Do not weaken the code gate to compensate and do not claim that local policy is server-enforced. Until hosted execution is restored or a self-hosted runner is deliberately operated, the maintainer must attach the local command results and exact commit SHA to the release record.

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
