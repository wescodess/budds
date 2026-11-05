---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Before starting any UI ticket, run [ui-design-gate](../ui-design-gate/SKILL.md). Read the saved human-approved HTML and decision note before writing UI code. Keep independent non-UI work moving while approval waits.

Route all UI/UX work, including UI fixes, to Opus 5.5 (`claudeAgent`, `claude-opus-5-5`); other tickets can go to Sol 6.1 (`codex`, `gpt-6.1-sol`). Follow the gate's delegation and handback rules.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit your work to the current branch.

Once the work is committed, have the orchestrator run [review-gate](../review-gate/SKILL.md) instead of /code-review before the PR is ready or merged. Follow its reviewer, fixer, and handback rules.
