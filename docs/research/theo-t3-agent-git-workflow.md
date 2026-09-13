# Theo / T3 agent structure and Git workflow research

Date: 2026-09-13

Status: Research and recommendations; this note does not change Budds policy.

## Scope and evidence

The strongest inspectable evidence is the public `pingdotgg/t3code` repository, which Theo links from [t3.gg](https://t3.gg/). Repository files below are pinned to [`0118b52295264a73ef7cd045437181f7b3e5a99f`](https://github.com/pingdotgg/t3code/commit/0118b52295264a73ef7cd045437181f7b3e5a99f), observed on the research date. Findings describe published T3 Code policy and specific public contributions, not an exhaustive account of Theo's private workflow or every T3 project.

Evidence labels:

- **Observed:** directly present in first-party files or GitHub records.
- **Inference:** a conclusion drawn from those records, with its limits stated.
- **Recommendation:** an adaptation for Budds, not a claim that Theo uses it.

## Agent structure: observed patterns

### One task per thread; worktrees when changes need isolation

T3 Code's user guide recommends a new thread for a separate task. New worktree mode gives the task a separate branch and working directory; consecutive background submissions in that mode each create their own worktree. Existing worktrees can also host a new thread. The product exposes an Agents view for delegated work. These are documented capabilities and defaults, not proof that Theo gives every subagent a worktree. [Thread guide](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/docs/user/thread-sidebar.md)

### Shared context across harnesses; a few task-specific skills

The root `CLAUDE.md` contains only `@AGENTS.md`. `.claude/skills` links to `../.agents/skills`. The inspected root skill directory contains four bundles: `test-t3-app`, `test-t3-mobile`, `ios-debugger-agent`, and `ios-simulator-browser`. The inspected Codex configuration enables XcodeBuildMCP workflows; it does not declare a model-tier or agent-role hierarchy. This supports an inference of shared repository guidance with specialized tools added where needed. It does not establish the contents of maintainers' global configurations. [CLAUDE.md](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/CLAUDE.md), [shared skills](https://github.com/pingdotgg/t3code/tree/0118b52295264a73ef7cd045437181f7b3e5a99f/.agents/skills), [Claude skill link](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/.claude/skills), [Codex configuration](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/.codex/config.toml)

### Product intent and operational constraints guide the agent

Theo's note favors simple models and limited scope. The guide makes product surfaces, shared terminology, state ownership, and operational hazards explicit. It assigns the integrated client check to the primary agent and says subagents should not launch dev servers. Local verification targets meaningful changed behavior; CI owns the full suite. PR defaults include one concern, conventional titles, model/harness disclosure, visual evidence for UI work, and validating bot findings before acting. [Agent guide](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/AGENTS.md)

### Worktree isolation includes runtime state

The committed setup action installs dependencies, links environment files, and warms the web dependency cache when a worktree is created. The web-testing skill uses worktree-local `.t3` state or an explicitly chosen temporary directory, reads actual assigned ports, and retains the environment during an ongoing human testing loop. This is useful evidence that source isolation alone is insufficient. Its environment-file linking is T3-specific and should not be copied into Budds without checking backend ownership. [Setup actions](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/t3.json), [web-testing skill](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/.agents/skills/test-t3-app/SKILL.md)

## Git habits: policy and actual contributions

| Finding | Evidence and limit |
| --- | --- |
| Focused branches and PRs | Theo's PRs [#10768](https://github.com/pingdotgg/t3code/pull/10768) and [#11478](https://github.com/pingdotgg/t3code/pull/11478) use `t3code/composer-footer-width-shifts` and `t3code/rethink-device-connection-controls`, both targeting `main`. The earlier guide rewrite [#4782](https://github.com/pingdotgg/t3code/pull/4782) uses `theo/agent-audit-guidance`. These examples do not establish a mandatory prefix. |
| Conventional titles and tool provenance | The sampled PRs use `fix(web):`, `feat(web):`, and `docs:` titles. #10768 and #11478 disclose Claude Fable 5.1 in Claude Code; #4782 discloses gpt-5.6-sol in Codex. These are authored disclosures, not independent verification of all execution details. |
| Focused local checks followed by review | #10768 reports scoped tests, typechecks, and lint. Its [review history](https://github.com/pingdotgg/t3code/pull/10768#pullrequestreview-5142208005) includes CodeRabbit and Macroscope feedback, Theo replies, successive reviewed commits, and a later [Macroscope approval](https://github.com/pingdotgg/t3code/pull/10768#pullrequestreview-5142421137). This verifies an iterative review record, not that every bot comment was correct. |
| Squash-shaped public history | #11478 contains four branch commits and landed as one [single-parent commit](https://github.com/pingdotgg/t3code/commit/2587c8060c103245b4f970b925977008f2592d1d). #10768 contains five and landed as one [single-parent commit](https://github.com/pingdotgg/t3code/commit/7fbc545ae8c7866ac2b39648120cb2a17250d8b4). This is consistent with squash merging these PRs; repository-wide merge settings were not established. |
| Rebase-before-PR is no longer mandatory | [Commit 9e20194 / PR #6479](https://github.com/pingdotgg/t3code/commit/9e201941aaa9cfece3e0ffaa4cc24bbe880d1be4), dated August 13, explicitly removes that requirement. Do not repeat the older instruction as current policy. |
| Checkpoints and delivery commits serve different purposes | The [checkpoint service](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/apps/server/src/checkpointing/CheckpointStore.ts) describes hidden Git refs and a temporary index for capture/restore. The [source-control guide](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/docs/user/source-control.md) separately documents commit, push, and PR actions. Inference: thread recovery does not require cluttering visible history with every agent turn. |

External contribution policy emphasizes small fixes and clear evidence, labels PR size and contributor trust, and discourages unsolicited scope expansion. This is a project governance choice, not a reason to reproduce its contributor restrictions in Budds. [Contributing guide](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/CONTRIBUTING.md)

## A meaningful change: plans moved out of the codebase

On August 21, [PR #7665](https://github.com/pingdotgg/t3code/pull/7665) removed the tracked `.plans` collection after documenting stale checklists, an incomplete index, and obsolete search results. Its replacement puts current architectural reasoning in durable docs, active work in GitHub issues/projects, temporary thinking outside the worktree, and implementation history in merged PRs. The explanation cites Matt Pocock's search-hygiene and Wayfinder guidance, alongside evidence from T3's own history.

Therefore, older descriptions of T3 as maintaining a permanent checked-in collection of agent plans are outdated. This research note follows Budds' existing research convention and requested workflow; it is not claiming compliance with T3's different artifact policy.

## Recommendations for Budds

These recommendations combine the evidence above with the current [Budds issue-tracker conventions](../agents/issue-tracker.md), [CI contract](../ci.md), and [root agent instructions](../../AGENTS.md). They are proposed changes only.

1. **Keep one integration owner per ticket.** The orchestrator assigns scope, integrates changes, resolves review findings, runs the final gate, and handles GitHub delivery. Research and review agents return findings without changing the integration branch. Independent implementation agents receive explicit file ownership and a branch/worktree when they will write concurrently. T3's primary-agent integration rule supports this direction; the exact ownership protocol is our recommendation.
2. **Use a fresh task context and a small handoff.** Give each agent the ticket, acceptance criteria, applicable domain rules, allowed files, validation command, and required output. Keep active decisions in the owning issue. Start a new thread when the task changes rather than carrying unrelated implementation history forward.
3. **Use low/medium effort for bounded work and high effort for difficult review.** This follows the user's requested allocation. The primary sources inspected do not establish it as Theo's standard setup. Increase effort when the evidence or task complexity warrants it.
4. **Centralize repository instructions.** Retain the required Convex guidance. Add concise links to the issue workflow and CI contract, plus ownership and worktree rules, instead of repeating full workflows in multiple harness files. If multiple harnesses are used, have their entry points share the same instructions and skill implementations.
5. **Isolate state as well as files.** Define ports, generated artifacts, test fixtures, and Convex development deployment ownership before enabling concurrent writers. A separate branch/worktree does not automatically isolate the backend, shared services, or credentials.
6. **Keep Budds' existing PR and merge gate.** Run focused checks during implementation, then have the integration owner perform the required complete verification and strict build against the proposed commit. The Budds CI contract currently documents unavailable hosted execution and requires local evidence. T3's shortcut depends on its own [CI workflow](https://github.com/pingdotgg/t3code/blob/0118b52295264a73ef7cd045437181f7b3e5a99f/.github/workflows/ci.yml); it cannot replace our gate.
7. **Keep commits and PRs focused.** Use descriptive task branches from `dev`, conventional commit subjects, explicit staged paths, a short problem/result description, and relevant evidence. Review the final integrated change, address valid findings, squash through the PR, update the issue, and report the remote tip. Rebase only when integration needs it; avoid ceremonial history rewrites.
8. **Give documents a lifecycle.** Use GitHub issues for live plans and durable repository docs for verified constraints. Review existing plans individually before any migration or deletion. Preserve the existing untracked `docs/learn-anything-v2-plan.md`; this research does not authorize its removal.

## Unknowns and limits

- No verified universal Theo hierarchy of planner, builder, reviewer, or a fixed number of agents was found.
- Maintainers' global skills, hidden prompts, private T3 Chat workflows, exact model-routing defaults, and reasoning-effort settings were not available in the inspected public configuration.
- The sampled PRs do not establish a mandatory branch prefix, universal squash-only policy, commit frequency, or every maintainer's personal Git habits.
- T3 Code supporting worktrees and subagents does not prove Theo uses either on every task.
- Theo's [May 27 workflow video](https://www.youtube.com/watch?v=xJaMTo2YgO8) was located, but the first-party transcript was unavailable through the research interface. Secondary summaries and mirrored social posts were used only for discovery; their personal-workflow claims are not treated as verified findings here.
- The recommendations have not changed agent configuration, branch settings, CI, skills, or runtime code. A follow-up implementation should turn the selected recommendations into a small repository-specific contract.
