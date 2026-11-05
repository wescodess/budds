<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Agent skills

Before new UI/UX or a material visual or interaction change, run [ui-design-gate](.agents/skills/ui-design-gate/SKILL.md): show five visual concepts and wait for the human dev to choose one and confirm satisfaction before UI code starts.
All UI/UX work, including UI fixes, runs on Opus 5.5 (`claudeAgent`, `claude-opus-5-5`); other work can go to Sol 6.1 (`codex`, `gpt-6.1-sol`). Follow the skill's routing and approval rules.
