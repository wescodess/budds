---
name: ui-design-gate
description: Require human visual approval before a new component, page, screen, layout, flow, or material visual or interaction change. If unsure, apply this gate.
---

# UI design gate

Run this gate before any new UI/UX implementation. Pure refactors with no visible change and bug fixes restoring an already-approved design are exempt. UI fixes still follow the model routing below.

Batch related components on one surface into one gate; do not ask for five ideas per button. Keep independent non-UI work moving while the gate waits.

## Model routing

All UI/UX work runs on Opus 5.5: design-system creation, ideas, iteration, implementation, browser comparison, and UI fixes. Use `delegate_task` with provider `claudeAgent`, model `claude-opus-5-5`, and `target.options.effort` chosen for complexity. Other work can go to Sol 6.1: provider `codex`, model `gpt-6.1-sol`, and `target.options.reasoningEffort` chosen for complexity.

If the current agent is not Opus 5.5 and reaches UI work, stop that work and hand it back to the orchestrator for routing. If the required model is unavailable, report that blocker; do not substitute another model. Only the orchestrator talks to the human dev. Child agents return artifacts and options to it, then wait for the human's response through it.

## Round 1

1. First determine whether the project has a design system: inspect design docs, theme tokens, and shared component libraries. Read the real component sources, screens adjacent to the surface, and any project design-skill guidance.
   - **Exists:** every concept, mockup, and build uses the app's real theme, tokens, typography, spacing, radii, components, and interaction patterns. For mockups and builds, prefer existing higher-level app components built from its base components when one fits the use case, otherwise use the app's base typed components (such as shadcn-vue components); compose something new from those base components only if neither fits. Compose mockups from those sources; invent no colours, tokens, or component styling. Flag any necessary addition explicitly in the proposal for human approval before use.
   - **None:** pause UI concepts and create the design system with the human first. The orchestrator and its Opus 5.5 children do the audit, proposals, rendered options, and writing of the design doc and tokens, using `frontend-design` for direction and `design-system` for tokens, components, and patterns. The human only reacts, chooses, and approves. Resume this round only after explicit approval of the system.
2. Brainstorm and render exactly **5 genuinely different concepts**. Vary only layout, information hierarchy, or interaction, composed from the established system. Include enough surrounding context to judge the surface.
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

Compare the finished UI with `approved.html` and the design system in a browser, including empty, loading, error, and mobile states. Record the comparison in the ticket. Fix differences to match the approved design and system, or take them to the dev for approval before completing the UI ticket.
