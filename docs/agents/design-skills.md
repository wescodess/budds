# Design skills

`DESIGN.md` is the brief for all UI work. It wins over every skill listed here, and vendored skill text is never edited to fit it. Conflicts are listed below instead.

## Which skill, in what order

| Step | Job | Use | Notes |
|---|---|---|---|
| 1 | Direction for a new or marketing surface | `frontend-design` | Landing, auth, first-run concepts. Skip for routine app screens. |
| 2 | Designing a product surface | `interface-design` | Voids, sidebar, drawers, dashboards, settings. Not for marketing pages. |
| 3 | Building it | `vue`, `nuxt`, `reka-ui`, `motion`, existing `app/components/ui/` | Use shadcn-vue components and the Vue stack. Implementation references, not design direction. |
| 4 | Worst-case data | `break-ui <component>` | Any surface rendering user data. Always pass a target, or it replies with a greeting and waits. |
| 5 | Drift and hierarchy audit | `improve-ui <route>` | Explicitly ask for rendered inspection, or it discards hierarchy and clarity findings. Stops at three findings. |
| 6 | Accessibility | `fixing-accessibility <file>` | `improve-ui` discards accessibility findings, so it does not replace this step. |
| 7 | Final pass | Checklist below | On the rendered screen, then the diff. |

Use step 1 or step 2 for a given surface, not both.

## Official Anthropic skills

All seven skills in Anthropic's Design plugin are installed, alongside the seven creative/design skills and `webapp-testing` from `anthropics/skills`. Each is available under `.agents/skills/` with a matching `.claude/skills/` symlink. They are also installed at user level for Claude and Codex on this machine.

| Skill | Use |
|---|---|
| `frontend-design` | Visual direction and intentional UI composition. |
| `design-critique` | Feedback on usability, hierarchy, and consistency. |
| `design-system` | Audit, document, or extend the existing component system. |
| `design-handoff` | Document approved layouts, states, tokens, and interactions. |
| `ux-copy` | Labels, errors, empty states, and other interface copy. |
| `accessibility-review` | Design accessibility audit; pair with `fixing-accessibility` for code fixes. |
| `user-research` | Research plans, interviews, surveys, and usability testing. |
| `research-synthesis` | Turn supplied research into evidence-backed findings. |
| `canvas-design` | Standalone posters, illustrations, and static visual assets. |
| `algorithmic-art` | Original generative artwork. |
| `brand-guidelines` | Anthropic-branded artifacts when explicitly requested. |
| `theme-factory` | Themes for standalone artifacts. |
| `slack-gif-creator` | Animated GIF assets. |
| `web-artifacts-builder` | Standalone React HTML artifacts. |
| `webapp-testing` | Playwright guidance for rendered UI validation. |

Choose the skills that fit the task. Installation does not make every skill a required step. For new Budds UI, follow the project UI design gate: five visual concepts, human selection, iteration, and explicit satisfaction before implementation. UI design and implementation use Opus 5.5 under that gate.

The Design plugin's optional connector reference is preserved at [`.agents/CONNECTORS.md`](../../.agents/CONNECTORS.md), with a Claude symlink so upstream relative links resolve. These skills also work from supplied screenshots, files, and descriptions. Installing them configures no MCP servers or external integrations.

## Anti-slop checklist

Look at the rendered screen in dark and light themes first, then scan the diff.

- [ ] Squint: one thing leads the screen, and it is the learning content.
- [ ] Swap: with the Budds name removed, this still reads as a study companion, not a SaaS template.
- [ ] The Void holds only content and input. No stat rows, side panels, or surrounding chrome.
- [ ] Amber marks actions, active states, focus, and citations only. No large amber fills, and one filled primary action per view.
- [ ] Color comes from semantic tokens (`bg-card`, `border-border`, `text-muted-foreground`), not `amber-*`, `orange-*`, or raw hex.
- [ ] No violet, indigo, or new hues beyond the defined palette.
- [ ] Cards use a border, not a shadow. Shadows only on the drawer edge and popovers.
- [ ] No gradients, glass, or blur as decoration.
- [ ] No identical icon + heading + text rows, and no nested cards.
- [ ] No `uppercase tracking-*` eyebrows. Captions are Inter 12px/500 in sentence case.
- [ ] DM Sans for headings and body. Monospace only for source passages.
- [ ] No sparkle icons standing in for "AI". Name what the feature does.
- [ ] Citations stay prominent and link to their source.
- [ ] Motion answers a user action and respects reduced motion. No pulsing, hover lifts, or fade-up on every section.
- [ ] No streaks, points, guilt loops, countdowns, tours, or "what's new" modals.
- [ ] Loading, empty, error, and disabled states exist. An empty state offers one clear next action.
- [ ] Long titles, a count of 1, and a 320px width all hold up.
- [ ] Copy uses plain verbs and sentence case. Errors say what happened and how to fix it. No "unlock" or "elevate".
- [ ] Tailwind utilities only, with no `<style>` block.

Existing drift, do not copy it (counts of `app/` files, 2026-11-05): `uppercase tracking` 45, `Sparkles` icon 14, `backdrop-blur` 10, gradients 5, `hover:scale` or `hover:-translate` 5, `<style>` 5, violet in `quiz/ReviewPanel.vue`.

## Conflicts with `DESIGN.md`

`frontend-design`:

- Warm Focus is a chosen direction, so its "near-black with one bright accent" and "one radius everywhere" warnings do not apply.
- Do not act on "choose typefaces deliberately" or "distinct palette". Fonts and palette are locked.

Other official skills:

- `brand-guidelines` and the `algorithmic-art` viewer include Anthropic branding. Budds product screens use `DESIGN.md`; use the branding examples only for separately requested artifacts.
- `theme-factory` offers new palettes and fonts for standalone artifacts. Budds keeps its existing tokens and typography.
- `web-artifacts-builder` scaffolds React and shadcn/ui. Use it only for a requested standalone artifact; implement Budds with Nuxt, Vue, and shadcn-vue.
- `design-system` extends the current tokens and components; `DESIGN.md` remains their design record.
- `webapp-testing` includes Python server helpers. For Budds, use the repository's existing Playwright setup and checks where applicable. Installing the skill does not run its scripts or install their dependencies.

`interface-design`:

- Ignore "shadows over borders", "space, not lines", darker input fills, and evocative token names. `DESIGN.md` specifies border elevation, `--card` inputs, and existing tokens.
- Do not create `.interface-design/system.md`. `DESIGN.md` is the record.
- Its tracked uppercase metric label example contradicts the checklist. Press scale and staggered entrances are optional and need a reason.
- It names `/interface-design:design-review` and `design-deslop`. Those commands are not installed, so review inline.

`improve-ui`:

- Plans are written to `design-plans/` when a finding is selected. Only commit them on purpose.

`break-ui`:

- Its plain gray toggle is deliberately off-theme and must stay dev-only.
- Read `dangerouslySetInnerHTML` as `v-html`.
- It names `emil-design-eng` and `review-animations`, which are not installed. Its `prototype` is a different skill from this repo's.

`DESIGN.md` against the code:

- Button radius: the tokens table and `ui/button` use `rounded-xl`, the Buttons section says `--radius-lg`. Follow the component.
- Theme: it says dark is the default, but `useAppTheme` follows the OS and `:root` is a warm light theme. Check both.
- `components.json` says Inter, zinc, and remixicon. The app uses DM Sans, stone values, and `@lucide/vue`, so re-theme anything `shadcn-vue` generates.

## Already available

| Skill or command | Status |
|---|---|
| `frontend-design:frontend-design` | Existing Claude plugin remains installed. The same official skill is now vendored as `frontend-design` for project and Codex discovery; use one copy per task. |
| `vue`, `nuxt`, `reka-ui`, `motion` | Kept as implementation references. User-level. |
| `huashu-design`, `design-foundation`, `design-story`, `design-to-vue` | Not vendored. The `huashu-design` licence is personal-use and requires the author's written permission for company or team use. The other three depend on its output. |
| Stitch skills and legacy `/design*` commands | Removed from user-level skill and command directories. The old workflow requirements now use HTML concepts and human approval. |
| `/generate-asset` | Kept; needs Gemini through Antigravity. References to the removed commands were removed. |

## Rejected

| Candidate | Reason |
|---|---|
| Impeccable (`pbakaus/impeccable`) | Setup runs a launcher that downloads and executes a binary, and it can install project hooks. |
| `web-design-guidelines` (`vercel-labs/agent-skills`) | Fetches unpinned rules from `main` on every review, and the rules use React idioms. |
| `antislop` (`miqdadbadjuber/anti-slop`) | Blocks UI work on an interactive question, reads home-directory settings, and ships a Python MCP server. |
| `anti-ui-slop` (`github/awesome-copilot`) | Funnels to a vendor's paid MCP and catalogue. |
| `anti-slop-design` (`ferousco-dev/anti-slop-design`) | 300KB overlapping the concept skills, and its instant rejects hit Warm Focus (card borders, dark mode). |
| `design-taste-frontend` (`Leonxlnx/taste-skill`) | Marketing sites only, 39MB, with Node scripts making network calls. |
| `ui-ux-pro-max` (`nextlevelbuilder/ui-ux-pro-max-skill`) | Depends on running Python scripts, and recommends from a style catalogue that fights a locked theme. |
| `claude-design` (`jiji262/claude-design-skill`) | Unclear licence: it is adapted from a system prompt its README says is Anthropic's. |
| `baseline-ui` (`ibelick/ui-skills`) | Mandates `motion/react` and React primitives. |
| `fixing-motion-performance` (`ibelick/ui-skills`) | Performance scope, and a fifth skill is not justified. |
| `emil-design-eng` (`emilkowalski/skill`) | 676 lines with React and Framer Motion examples, overlapping `interface-design` and `motion`. |
| `userinterface-wiki` (`raphaelsalaja/userinterface-wiki`) | Motion for React rules and sound synthesis, off-target for Vue. |
| `accessibility` (`addyosmani/web-quality-skills`) | Directs global npm installs and `npx` audits, at three times the length of `fixing-accessibility`. |
| `web-ui-best-practices` (`jamditis/claude-skills-journalism`) | React examples with hard-coded light colors, and already covered. |
| `refactoring-ui`, `ux-heuristics`, `top-design` (`wondelai/skills`) | Amazon affiliate tags in the skill text. |
| `ui-design-review`, `nielsen-heuristics-audit`, `wcag-accessibility-audit` (`mastepanoski/claude-skills`) | Long scored reports with hour-scale steps, and `ui-design-review` also rates "modern" conventions. |
| `taste-design` and others (`google-labs-code/stitch-skills`) | Require Stitch MCP or target React. |

## Installed

Files are verbatim from the pinned commit. Skills without an upstream `agents/openai.yaml` were left without one so the lock hash matches a fresh install.

| Skill | Source | Commit | Licence |
|---|---|---|---|
| `interface-design` | <https://github.com/Dammyjay93/interface-design> | `2f9be3206855bcb2d1d0af262c8bae25cba6658d` | MIT, © 2026 Damola Akinleye |
| `improve-ui` | <https://github.com/ibelick/ui-skills> | `73fb128d046d1f0d74c2909cd26eb616e3415567` | MIT, © 2026 Julien Thibeaut |
| `fixing-accessibility` | <https://github.com/ibelick/ui-skills> | `73fb128d046d1f0d74c2909cd26eb616e3415567` | MIT, © 2026 Julien Thibeaut |
| `break-ui` | <https://github.com/emilkowalski/skill> | `c8a79627b59d72d764d6ab6f2c87c09a48169833` | MIT, © 2026 Emil Kowalski |

Official sources, all pinned and vendored verbatim:

| Skills | Source | Commit | Licence |
|---|---|---|---|
| `algorithmic-art`, `brand-guidelines`, `canvas-design`, `frontend-design`, `slack-gif-creator`, `theme-factory`, `web-artifacts-builder`, `webapp-testing` | <https://github.com/anthropics/skills> | `ca45fc496a3436251f191354091d557da31c15b5` | Apache-2.0; bundled fonts retain their individual licences. |
| `accessibility-review`, `design-critique`, `design-handoff`, `design-system`, `research-synthesis`, `user-research`, `ux-copy` | <https://github.com/anthropics/knowledge-work-plugins/tree/main/design> | `d900840716eb262e1feb17c6f4406c9ce0e06bcf` | Apache-2.0; [licence text](../../.agents/licenses/anthropic-knowledge-work-plugins.txt). |

<details>
<summary>MIT licence text</summary>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

</details>
