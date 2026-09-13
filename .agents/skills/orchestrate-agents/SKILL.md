---
name: orchestrate-agents
description: Coordinate multi-agent repository work with one integration owner, bounded assignments, isolated writers and runtime state, independent review, and clean Git delivery. Use when the user asks for subagents, delegation, parallel agent work, or orchestrated research, implementation, or review.
---

# Orchestrate Agents

Own the result end to end. Subagents extend the available context and concurrency;
they do not dilute responsibility for scope, correctness, or delivery.

## Establish the contract

Before dispatching work:

1. Read the governing request, issue, specification, and repository instructions.
2. Record the current branch, base commit, remote target, and dirty worktree. Treat
   unrelated tracked and untracked files as protected user work.
3. State the acceptance boundary and the evidence required to call the task done.
4. Identify shared resources such as ports, dev servers, fixtures, generated files,
   credentials, and backend deployments. Source isolation does not isolate runtime
   state.

For Budds issue operations, read
[the issue-tracker contract](../../../docs/agents/issue-tracker.md). Before delivery,
read [the CI contract](../../../docs/ci.md). Before touching Convex code, read
[`convex/_generated/ai/guidelines.md`](../../../convex/_generated/ai/guidelines.md).

## Keep one integration owner

The primary agent owns scope, task decomposition, integration order, conflict
resolution, final review, the exact-commit verification gate, GitHub delivery, and
the final report. Do not assign two agents responsibility for the same outcome.

Use the smallest useful agent set. Parallelize only work that is independently
bounded. Serialize tightly coupled changes or assignments that would edit the same
files or share mutable runtime state.

If another invoked skill calls for a merger subagent, keep it mechanical: pin the
commits and order, prohibit unrelated edits, inspect the resulting diff, and rerun
the relevant checks. Never integrate two writer branches concurrently.

## Route work and reasoning effort

- **Low effort:** deterministic inventories, link checks, mechanical edits, and
  narrow tests with an explicit expected result.
- **Medium effort:** bounded implementation, test design, codebase exploration,
  and research that requires ordinary judgment.
- **High effort:** subtle specification, standards, security, architecture, or
  correctness reviews where missed interactions would be costly. Use independent
  reviewers so implementer context does not bias the result.

Escalate based on ambiguity and risk, not prestige. No public evidence establishes
these tiers as Theo/T3 policy; they are this repository's routing convention.

## Give every agent a bounded packet

Include only what changes the agent's decisions:

- objective and acceptance criteria;
- context pointers to the issue, spec, source files, and governing instructions;
- allowed files or explicit ownership boundaries;
- prohibited actions and external-mutation limits;
- expected validation commands;
- required return contract: findings or changes, files and commits, commands and
  results, remaining risks, and blockers;
- assigned branch/worktree and runtime-state ownership when the agent may write.

Prefer pointers over duplicating long documents. A research agent distinguishes
observed facts, inference, recommendations, and unknowns. A review agent is
read-only and pins its diff or evidence baseline. An implementation agent may edit
only its assigned surface.

## Isolate writers and shared state

Read-only agents may inspect the same checkout. Concurrent writers require separate
branches and worktrees when the execution environment supports them. The primary
agent creates the worktree, supplies its absolute path and branch, and assigns
non-overlapping ownership.

Also assign unique ports, local state directories, fixtures, and backend targets.
Never point a subagent at live or shared state merely because its source tree is
isolated. Do not copy or link credentials into a worktree without explicit
authority and a repository-approved mechanism.

If governing context is untracked, surface that fact. Either give agents an
explicit read-only pointer to the protected source or obtain authority to publish
it; do not silently omit it or copy it into task branches. Reserve dependency and
lockfile ownership for the integration owner, including updates required by
tool-specific guidance such as Convex testing packages.

Subagents may run bounded checks but should not launch independent long-lived dev
servers. After integration, the primary agent owns one coherent browser or client
validation pass when the task needs it.

## Integrate and review

Require each writer to return a clean, focused commit plus validation evidence.
Inspect the commit and diff before integrating it. Reject scope creep, hidden
generated output, unexplained dependency changes, and claims unsupported by tests
or direct evidence.

Run focused checks throughout implementation. After all changes are integrated:

1. review the complete diff against both repository standards and the originating
   request or spec;
2. fix valid findings and re-review the affected surfaces;
3. run the repository's complete gate against the exact proposed commit;
4. distinguish local, synthetic, preview, hosted-CI, provider, and production proof.

For Budds, compare `docs/ci.md`, `.github/workflows/test.yml`, and the current
package scripts before running the gate. Confirm that aggregate commands cover
every required stage. The current local evidence set includes `pnpm verify`, the
Worker strict environment check, a full-history Gitleaks scan, and `pnpm build`
with the workflow's synthetic configuration. Do not replace this gate with T3
Code's focused-check shortcut while hosted execution is unavailable.

## Deliver clean Git history

- Use one focused integration branch from the repository's correct base (`dev` for
  Budds feature work unless the owning issue says otherwise).
- Stage explicit paths so protected user work cannot enter a commit accidentally.
- Use conventional, plain-language commit and PR titles.
- Keep one concern per PR. If the body needs an unrelated "also," split the work.
- Write the PR body as: the problem in one or two sentences, how it was fixed,
  concise verification evidence, and the model/harness provenance at the end.
- Include before/after images for visible UI changes and a short recording for
  motion or timing changes. Keep PR-only evidence out of the repository.
- Rebase or rewrite history only when integration requires it and authorization
  permits it; do not do ceremonial rewrites.
- Verify bot findings against source, fix real issues, and explain dismissed false
  positives.
- Bind final pre-merge evidence to the tested PR head and record the target base.
  Before merging, confirm the target still matches that validated base. If the base
  moved, integrate it and rerun the full required gate on the new candidate. A
  squash merge creates a new SHA: report the tested head and the resulting remote
  SHA separately rather than claiming the squash commit itself was tested.
- After merge, verify the remote target SHA and resulting tree, then update or
  close the owning issue. Remove task worktrees only after every intended change
  and item of evidence is accounted for; do not rely on commit ancestry after a
  squash merge.

Creating a PR, merging, deploying, changing provider state, or deleting data still
requires authority from the user or the governing repository workflow. A request
to delegate work is not blanket permission for external mutations.

Report only model and harness provenance actually exposed by the environment. Put
PR-only screenshots, recordings, and bulky logs in GitHub uploads, comments, or
the repository's configured artifact store rather than committing them.

## Keep artifacts useful

Use issues or project items for active plans. Keep durable repository documentation
only for cross-cutting decisions, constraints, operations, or user tasks that code
and tests do not explain. Research artifacts follow the owning repository's
convention; do not preserve agent scratch files as permanent documentation.

The evidence behind this adaptation is recorded in
[the Theo/T3 workflow research](../../../docs/research/theo-t3-agent-git-workflow.md).
