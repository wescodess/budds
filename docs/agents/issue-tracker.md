# Issue tracker: GitHub

Issues and specs for this repository live as GitHub issues in `wescodess/budds`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue:** `gh issue create --title "..." --body "..."`.
- **Read an issue:** `gh issue view <number> --comments`, including labels.
- **List issues:** use `gh issue list` with explicit state, label, and JSON fields.
- **Comment on an issue:** `gh issue comment <number> --body "..."`.
- **Apply or remove labels:** `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue:** `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` resolves it automatically inside this clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Publishing and fetching

- When a skill says to publish to the issue tracker, create a GitHub issue.
- When a skill says to fetch a relevant ticket, read its body, comments, and labels.

## Wayfinding operations

The map is one issue labelled `wayfinder:map`; decision tickets are its child issues.

- **Map:** create one issue containing Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket:** create an issue labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Link it through GitHub sub-issues when available; otherwise add it to the map task list and put `Part of #<map>` at the start of the child.
- **Blocking:** use GitHub native issue dependencies where available. The dependency API expects the blocker issue's numeric database ID, not its issue number or node ID. If unavailable, record `Blocked by: #<n>` in the child body.
- **Frontier:** the ordered set of open, unassigned child issues with no open blockers.
- **Claim:** assign the selected ticket to the driving developer before work begins.
- **Resolve:** post the complete answer, close the child, and add a one-line linked gist to the map's Decisions-so-far section.

Refer to maps and tickets by linked title in human-facing text rather than by a bare issue number.
