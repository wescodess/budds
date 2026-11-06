<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Agent skills

Before an implementation PR is ready or merged, have the orchestrator run [review-gate](.agents/skills/review-gate/SKILL.md) and record its review ledger at the final PR head. Follow its model routing, stop rules, and escalation requirements.

Before new UI/UX or a material visual or interaction change, run [ui-design-gate](.agents/skills/ui-design-gate/SKILL.md): show five visual concepts and wait for the human dev to choose one and confirm satisfaction before UI code starts.
All UI/UX work, including UI fixes, runs on Opus 5.5 (`claudeAgent`, `claude-opus-5-5`); other work can go to Sol 6.1 (`codex`, `gpt-6.1-sol`). One exception: Sol 6.1 may judge UI screenshots, read-only, under the [Design Climb](docs/design/climb.md); judge output is never approval. Follow the skill's routing and approval rules.

## Design skills

For UI design, critique, copy, accessibility, or visual assets, read [docs/agents/design-skills.md](docs/agents/design-skills.md) for skill selection and compatibility with `DESIGN.md`.
