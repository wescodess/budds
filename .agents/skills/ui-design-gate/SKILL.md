---
name: ui-design-gate
description: Require human visual approval before a new component, page, screen, layout, flow, or material visual or interaction change. If unsure, apply this gate.
---

# UI design gate

Run this gate before any new UI/UX implementation. Pure refactors with no visible change and bug fixes restoring an already-approved design are exempt. UI fixes still follow the model routing below.

Batch related components on one surface into one gate; do not ask for five ideas per button. Keep independent non-UI work moving while the gate waits.

## Model routing

All UI/UX work runs on Opus 5.5: ideas, iteration, implementation, browser comparison, and UI fixes. Use `delegate_task` with provider `claudeAgent`, model `claude-opus-5-5`, and `target.options.effort` chosen for complexity. Other work can go to Sol 6.1: provider `codex`, model `gpt-6.1-sol`, and `target.options.reasoningEffort` chosen for complexity.

If the current agent is not Opus 5.5 and reaches UI work, stop that work and hand it back to the orchestrator for routing. If the required model is unavailable, report that blocker; do not substitute another model. Only the orchestrator talks to the human dev. Child agents return artifacts and options to it, then wait for the human's response through it.

## Round 1

1. Read `DESIGN.md`, `docs/agents/design-skills.md`, and `app/assets/css/tailwind.css`. Use the design skills listed for the task. If a required reference is missing, hand back the blocker.
2. Brainstorm and render exactly **5 genuinely different concepts**. Vary layout, information hierarchy, or interaction models, not just colours or copy. Use the app's real theme tokens from the CSS file and shadcn-vue's look. Include enough surrounding context to judge the surface.
3. Give each concept a name, core idea, and trade-offs. State which concept you recommend and why.
4. Create self-contained HTML mockups outside app code. In T3 Code, the orchestrator shows every concept using `html_preview` then `html_render`. Elsewhere, produce HTML files and give the dev their absolute paths. Markdown-only proposals never count. This gate's five HTML concepts take precedence over `/prototype`'s default count and app-route approach.
5. Have the orchestrator ask the dev to pick one or several concepts, or say what to change. Wait for their response before refining.

## Iterate and approve

Combine and refine the dev's selections and feedback into the next round, with **up to 5 variations**. Render and present them in the same way. Continue until the human dev has picked **exactly one final option and explicitly said they are satisfied**. Picking several options or requesting changes means another round, not approval.

Only the human dev can approve. Silence, a timeout, an auto-answering agent, or the orchestrator's own judgement is never approval. Agent-auto-answer modes do not extend to this gate.

## Record and build

On approval, save these required implementation inputs under `docs/design/<slug>/` and link both from the ticket:

- `approved.html`: the final HTML the dev approved.
- `decision.md`: what was chosen, what was rejected, the dev's exact approval words, and the approval date (`YYYY-MM-DD`).

Before any UI code starts, the implementer must read both files and the ticket's approval record. A missing record blocks UI implementation. If the design materially changes during the build, return to the dev through this gate and update the record after renewed approval.

## Check the build

Compare the finished UI with `approved.html` in a browser, including empty, loading, error, and mobile states. Record the comparison in the ticket. Fix differences to match the approved design, or take them to the dev for approval before completing the UI ticket.
