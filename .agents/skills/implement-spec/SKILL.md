---
name: implement-spec
description: "Implement a specification in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The goal is a PR which implements the entire spec on a single branch.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for **maximum concurrency**.

Before starting any UI ticket, run [ui-design-gate](../ui-design-gate/SKILL.md). Read the saved human-approved HTML and decision note before writing UI code. Keep independent non-UI work moving while approval waits.

Route all UI/UX work, including UI fixes, to Opus 5.5 (`claudeAgent`, `claude-opus-5-5`); other tickets can go to Sol 6.1 (`codex`, `gpt-6.1-sol`). Follow the gate's delegation and handback rules.

## Steps

1. Read the spec and tickets. Read enough to understand the task graph. Where frontend and backend tickets share a boundary, agree the shared contract (types and API shape) in a blocking ticket first; both sides depend on it.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create a branch, and a draft PR. The PR should be marked as 'closing' the spec issue and tickets.

4. Use **implementer subagents** to implement each ticket. Each implementer subagent should work in its own worktree, on its own branch. Once the shared contract is agreed and the UI gate is approved, run frontend and backend tickets concurrently wherever the frontier allows. Backend tickets need only their own blockers resolved, so they can proceed while UI approval waits.

5. Once an **implementer subagent** completes, merge its work to the PR branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete and integrated, have the orchestrator run [review-gate](../review-gate/SKILL.md) on the committed PR branch instead of /code-review. Use one gate for the completed PR, not per trivial commit, so ticket implementation stays parallel. Follow the gate's reviewer, fixer, and handback rules.

8. Mark the PR as ready for review.

9. Clean up all **implementer subagent** worktrees.
