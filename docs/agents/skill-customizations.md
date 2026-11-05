# Local skill customizations

`implement` and `implement-spec` are maintained locally. `ui-design-gate` is a project skill. Their `skills-lock.json` entries use `sourceType: "local"` and point to their own directories under `.agents/skills/`.

## Update behaviour

Checked on 2026-11-05 against the published `skills@1.7.6` CLI. Project updates skip `local` entries. For remote entries, `computedHash` compares upstream content with the recorded hash; it does not protect edited installed files from replacement when upstream changes. Changing the hash alone is not protection. See the CLI's [update logic](https://github.com/vercel-labs/skills/blob/1a1d387ed4286e59aa43a2696cf02b3590061c91/src/update.ts) and [local lock format and hashing](https://github.com/vercel-labs/skills/blob/1a1d387ed4286e59aa43a2696cf02b3590061c91/src/local-lock.ts).

Keep these entries local when updating other skills. An explicit `skills add` from upstream can still replace a same-name skill; refresh these two manually and review the diff instead. Recheck this behaviour before adopting a newer CLI version.

## Upstream baselines

Both customized skills came from `mattpocock/skills`. The hashes below are the original folder hashes from this repository's lockfile, not commit IDs.

| Skill | Upstream path | Original computedHash |
| --- | --- | --- |
| `implement` | `skills/engineering/implement/SKILL.md` | `2139cfedf24791adbc839aaab6019cff158af1e28bfead020ec6e0ce01b3e74d` |
| `implement-spec` | `skills/in-progress/implement-spec/SKILL.md` | `91670f6f5239fc64da91c2b2f6ada62a27d2f0e8e18215fefe53feeea7a43801` |

## Reapply after a manual upstream refresh

1. Fetch upstream files outside the repository and merge changes into the local copies. Preserve their existing `agents/openai.yaml` files and relative `.claude/skills/` symlinks.
2. In both skills, before implementation, require [ui-design-gate](../../.agents/skills/ui-design-gate/SKILL.md) for every UI ticket and require reading its saved human-approved HTML and decision note before UI code. Keep independent non-UI work moving while approval waits.
3. In both skills, route UI/UX work and UI fixes to Opus 5.5 (`claudeAgent`, `claude-opus-5-5`), and other tickets to Sol 6.1 (`codex`, `gpt-6.1-sol`). Follow the gate's delegation and handback rules.
4. In `implement-spec` step 1, require a blocking shared-contract ticket agreeing types and API shape before dependent frontend and backend tickets start. In step 4, run those tickets concurrently wherever the frontier allows, with backend work proceeding while UI approval waits once its own blockers resolve.
5. These gate edits leave all other upstream text, including the `/code-review` lines, intact. Preserve any separately documented local customizations too. Keep the gate skill and its pointers in `AGENTS.md` and `CLAUDE.md`.
6. Retain `sourceType: "local"` and `source: "./.agents/skills/<name>"` for each local skill; omit the remote `skillPath`. Recompute `computedHash` using the CLI's folder algorithm: recursively collect files except `.git` and `node_modules`, sort relative paths with JavaScript `localeCompare`, and SHA-256 each relative path followed by its file bytes, with no separators. Include `agents/openai.yaml`.
7. Parse the edited frontmatter and YAML, check symlinks and `git diff --check`, and verify a project-scoped update leaves the local skills unchanged in a temporary copy before committing.
