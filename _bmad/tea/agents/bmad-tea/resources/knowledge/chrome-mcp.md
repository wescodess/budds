# Chrome MCP — Browser Automation for Coding Agents

## Principle

When an AI agent needs to interact with a live browser — navigate pages, inspect elements, verify redirects, capture screenshots — Chrome MCP provides direct browser control through MCP tool calls. It operates on the user's actual Chrome instance, making it ideal for verifying real application behavior during development and testing workflows.

## Rationale

Chrome MCP is the preferred browser automation tool when:

- The agent already has MCP tool access (no additional installation needed)
- Real browser verification is needed against a running dev server
- Interactive E2E test verification is the goal (not generating Playwright test files)
- The project doesn't have Playwright/Cypress installed

**The trade-off vs alternatives:**

- **Chrome MCP** = zero-install, real browser, interactive verification, rich a11y snapshots
- **Playwright CLI** = session-scoped, element refs, lightweight tokens, requires global install
- **Playwright MCP** = full Playwright API via MCP, requires `@playwright/mcp` package

TEA prefers Chrome MCP first (`tea_browser_automation: "chrome-mcp"`), falling back to Playwright CLI if Chrome MCP is unavailable.

## Available Tools

Chrome MCP provides these tool categories:

### Navigation
- `navigate_page` — Go to URL, back, forward, or reload
- `new_page` — Open new tab (supports isolated browser contexts)
- `list_pages` / `select_page` / `close_page` — Tab management

### Inspection
- `take_snapshot` — A11y tree snapshot with element UIDs (preferred over screenshots)
- `take_screenshot` — Visual capture (full page or element)
- `evaluate_script` — Execute JS in page context

### Interaction
- `click` — Click element by UID from snapshot
- `fill` — Fill input/textarea/select by UID
- `fill_form` — Fill multiple form elements at once
- `type_text` — Type into focused input
- `press_key` — Keyboard shortcuts and special keys
- `hover` — Hover over element
- `drag` — Drag and drop
- `upload_file` — File upload via input element

### Observation
- `wait_for` — Wait for text to appear on page
- `list_network_requests` / `get_network_request` — Network traffic inspection
- `list_console_messages` / `get_console_message` — Console output
- `handle_dialog` — Accept/dismiss browser dialogs

### Analysis
- `lighthouse_audit` — Accessibility, SEO, best practices audit
- `performance_start_trace` / `performance_stop_trace` — Performance profiling
- `take_memory_snapshot` — Heap snapshot for memory analysis
- `emulate` — Device emulation (viewport, network, geolocation)

## What TEA Uses It For

### Selector Verification

Before generating test assertions, TEA snapshots a page to see actual element labels, roles, and names:

```
# Take a11y snapshot of the login page
mcp__chrome-mcp__navigate_page(url="http://localhost:3002/login")
mcp__chrome-mcp__take_snapshot()
# Returns: elements with UIDs, roles, names — e.g., button "Sign in with Google"
```

### Redirect Verification

For auth flow testing, verify that navigation triggers expected redirects:

```
# Navigate to protected route while unauthenticated
mcp__chrome-mcp__navigate_page(url="http://localhost:3002/app/chat")
# Check: page URL should now be /login (redirect happened)
mcp__chrome-mcp__evaluate_script(function="() => window.location.href")
```

### Network Inspection

Verify API calls happen during user interactions:

```
# After triggering an action, inspect network traffic
mcp__chrome-mcp__list_network_requests(resourceTypes=["fetch", "xhr"])
# Check: expected API call was made with correct method/status
```

### Cookie/Session Verification

Check session cookies and storage:

```
mcp__chrome-mcp__evaluate_script(function="() => document.cookie")
mcp__chrome-mcp__evaluate_script(function="() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))")
```

### Screenshot Evidence

Capture visual evidence for test reports:

```
mcp__chrome-mcp__take_screenshot(filePath="_bmad-output/test-artifacts/screenshots/login-page.png")
```

## Session Management

Chrome MCP operates on the user's Chrome instance. Key differences from Playwright CLI:

- **No explicit session creation/cleanup** — operates on browser tabs
- **Use `new_page` with `isolatedContext`** for test isolation between scenarios
- **Use `close_page`** to clean up tabs after verification
- **State persists** between tool calls (cookies, localStorage) unless using isolated contexts

### Isolation Pattern for Testing

```
# Create isolated context for each test scenario
mcp__chrome-mcp__new_page(url="http://localhost:3002/login", isolatedContext="test-ac1")
# ... run verification ...
mcp__chrome-mcp__close_page(pageId=N)

# Next scenario gets clean state
mcp__chrome-mcp__new_page(url="http://localhost:3002/app", isolatedContext="test-ac2")
```

## Mapping to TEA Workflow Operations

| TEA Operation | Playwright CLI | Chrome MCP |
|---------------|---------------|------------|
| Open page | `playwright-cli -s=name open URL` | `navigate_page(url=URL)` or `new_page(url=URL)` |
| Snapshot | `playwright-cli -s=name snapshot` | `take_snapshot()` |
| Screenshot | `playwright-cli -s=name screenshot` | `take_screenshot(filePath=path)` |
| Click | `playwright-cli -s=name click eN` | `click(uid="uid")` |
| Fill | `playwright-cli -s=name fill eN value` | `fill(uid="uid", value="value")` |
| Check URL | Parse CLI output | `evaluate_script(function="() => window.location.href")` |
| Close session | `playwright-cli -s=name close` | `close_page(pageId=N)` |
| Network requests | N/A (not in CLI) | `list_network_requests()` |
| Console messages | N/A (not in CLI) | `list_console_messages()` |
| Wait for content | N/A (poll with snapshot) | `wait_for(text=["expected text"])` |

## When to Fall Back to Playwright

Chrome MCP cannot:

- Generate repeatable `.spec.ts` test files (it's interactive, not a test runner)
- Run tests in CI/CD pipelines (requires a live Chrome instance)
- Run headless in containers (needs desktop Chrome)
- Manage multiple parallel browser contexts efficiently

**Fall back to Playwright when:**
- The goal is generating automated test files for CI
- Tests need to run headless in pipelines
- Complex multi-tab or multi-context scenarios are needed
- The Chrome MCP server is not available

## Integration Points

- **Used in workflows**: `*atdd` (E2E verification), `*automate` (coverage expansion), `*test-review` (evidence collection), `*nfr` (performance/a11y audits), `*test-design` (page exploration)
- **Related fragments**:
  - `playwright-cli.md` — Fallback CLI tool when Chrome MCP unavailable
  - `selector-resilience.md` — Selector strategy applies to Chrome MCP UIDs too
  - `network-first.md` — Network inspection patterns via `list_network_requests`
  - `test-quality.md` — Deterministic verification patterns

_Source: Chrome DevTools Protocol, MCP server integration, TEA browser automation architecture._
