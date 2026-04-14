# Chrome MCP Integration — Remaining Workflow Changes

**Date:** 2026-04-09

## Completed Changes

| File | Change |
|------|--------|
| `_bmad/tea/config.yaml` | `tea_browser_automation: chrome-mcp` |
| `_bmad/tea/agents/bmad-tea/resources/knowledge/chrome-mcp.md` | New knowledge fragment |
| `_bmad/tea/agents/bmad-tea/resources/tea-index.csv` | Added chrome-mcp entry |
| `_bmad/tea/workflows/testarch/bmad-testarch-atdd/steps-c/step-01-preflight-and-context.md` | Added chrome-mcp knowledge loading |
| `_bmad/tea/workflows/testarch/bmad-testarch-atdd/steps-c/step-02-generation-mode.md` | Added chrome-mcp mode + auto fallback |
| `_bmad/tea/workflows/testarch/bmad-testarch-atdd/steps-c/step-04b-subagent-e2e-failing.md` | Added chrome-mcp selector verification |
| `_bmad/tea/workflows/testarch/bmad-testarch-automate/steps-c/step-01-preflight-and-context.md` | Added chrome-mcp knowledge loading |
| `_bmad/tea/workflows/testarch/bmad-testarch-automate/steps-c/step-02-identify-targets.md` | Added chrome-mcp browser exploration |
| `_bmad/tea/workflows/testarch/bmad-testarch-automate/steps-c/step-03b-subagent-e2e.md` | Added chrome-mcp selector verification |

## Previously Remaining Workflows — NOW COMPLETE

All workflows have been updated with chrome-mcp conditionals.

### test-design workflow (DONE)

| File | Change |
|------|--------|
| `_bmad/tea/workflows/testarch/bmad-testarch-test-design/steps-c/step-02-load-context.md` | Browser Exploration section — added chrome-mcp as preferred option |
| `_bmad/tea/workflows/testarch/bmad-testarch-test-design/steps-c/step-02-load-context.md` | Knowledge loading — added chrome-mcp.md |

### test-review workflow (DONE)

| File | Change |
|------|--------|
| `_bmad/tea/workflows/testarch/bmad-testarch-test-review/steps-c/step-01-load-context.md` | Knowledge loading — added chrome-mcp.md |
| `_bmad/tea/workflows/testarch/bmad-testarch-test-review/steps-c/step-02-discover-tests.md` | Evidence Collection section — added chrome-mcp as preferred option |

### NFR workflow (DONE)

| File | Change |
|------|--------|
| `_bmad/tea/workflows/testarch/bmad-testarch-nfr/steps-c/step-01-load-context.md` | Knowledge loading — added chrome-mcp.md |
| `_bmad/tea/workflows/testarch/bmad-testarch-nfr/steps-c/step-03-gather-evidence.md` | Browser-Based Evidence — added chrome-mcp as preferred option with lighthouse_audit |

## Pattern for Each Update

Every step file uses this conditional pattern:

```markdown
**Playwright CLI (if tea_browser_automation is "cli" or "auto" and {detected_stack} is `frontend` or `fullstack`):**
- `playwright-cli.md`
```

Add this block immediately after (or before, for priority):

```markdown
**Chrome MCP (if tea_browser_automation is "chrome-mcp" or "auto" and {detected_stack} is `frontend` or `fullstack`):**
- `chrome-mcp.md`
```

For Browser Exploration / Evidence Collection sections that reference `playwright-cli` commands, add:

```markdown
**If `tea_browser_automation` is `chrome-mcp` or `auto` (preferred):**
- Use `navigate_page(url=...)` to open pages
- Use `take_snapshot()` to inspect element structure
- Use `evaluate_script(function=...)` to check dynamic state
- Use `close_page(pageId=N)` when done
```

## Auto Mode Fallback Chain (Updated)

When `tea_browser_automation` is `auto`, the resolution order is now:

1. **Chrome MCP** — if `mcp__chrome-mcp__*` tools are available
2. **Playwright CLI** — if `playwright-cli` is installed globally
3. **Playwright MCP** — if `@playwright/mcp` server is available
4. **None** — skip browser automation, use AI generation from source code

## Skill Dispatcher Changes

The Claude Code skill files at `~/.claude/skills/bmad-bmm-workflows-testarch-*/SKILL.md` reference `_bmad/core/tasks/workflow.xml` which doesn't exist. These skills work because the step files are self-contained. No skill dispatcher changes are needed — the step files themselves handle the chrome-mcp conditional.
