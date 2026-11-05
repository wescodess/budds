# Surface captures

Run `pnpm design:capture learn-adaptive-canvases` on demand. Install Chromium once with `pnpm exec playwright install chromium`. This command does not run in the regular test or CI browser suite.

Run route captures separately from Nuxt builds and component tests, which share generated Nuxt/Vite caches. A dependency-cache 504 is a capture error; rerun after compilation finishes.

Route captures also take a per-user machine lock in the OS temporary directory (`budds-design-capture-stack-<uid>.lock`) before starting the stack. A simultaneous route capture, including from another checkout or with an explicit frontend port, fails clearly and keeps error staging instead of publishing. The existing stack creates unique disposable worktrees and project-local Convex data directories, but Convex probes backend ports starting at 3210/3211 without reserving them and shares binary/dashboard caches across checkouts. Anonymous mode also uses the fixed deployment name `anonymous-agent` and can fall back to matching legacy state in the user’s home directory. Nuxt also shares generated caches within a checkout. This command therefore permits only one route stack at a time; standalone HTML needs no stack lock. The lock is released after owned stack cleanup. After a hard kill or cleanup timeout, remove a stale lock only after confirming the owner and its descendants have stopped. Other E2E commands do not participate in this lock and should be run separately. `e2e-stack.mjs` is unchanged. A stack exit before readiness (even during a successful HTTP probe) fails through `stackFailure`; failed runs never publish.

Definitions live in `docs/design/surfaces/<surface>.json`. Version 1 requires:

- `kind`: `routes` starts the existing disposable `scripts/e2e-stack.mjs`. Each case has a local `path`. Without `BUDDS_E2E_BASE_URL`, the OS selects a free IPv4 loopback port with `listen(0)`; there is no default shared port. An explicit HTTP loopback URL preserves occupied-port rejection, but coordinating that port between callers is the caller’s responsibility: the probe releases it before startup. The runner never deliberately reuses a server. Existing production, loopback, and disposable-deployment checks still apply.
- `kind`: `html` opens `file` directly (absolute or relative to the repository root), starts no stack, and blocks HTTP requests. Keep mockups self-contained with inline CSS, scripts, images, and fonts. Each case identifies the static content; use separate definitions for different HTML files.
- `notes`: why these cases represent the surface and what is omitted.
- `themes`: `dark` and/or `light`. Each isolated browser context sets its color scheme, root class, and `budds-color-mode` before the page boots. HTML concepts can use those classes or `prefers-color-scheme`.
- `viewports`: CSS-pixel `{ "width": 320, "height": 640 }` objects.
- `cases`: unique `{ "kind": "concept", "state": "ready" }` identities, plus `path` for routes.
- `readySelector`: a visible readiness marker, ideally including a hydration/state attribute. Select a marker specific to the expected content so a loading spinner or error cannot satisfy it.
- `contentSelector`: exactly one visible, nonempty main content element to crop.
- Optional `requiredFonts`: font families that must actually load. All declared font failures, page errors, failed requests, HTTP errors, and unexpected redirects fail capture.
- Optional `surfaceSeparation`: `{ "selectors": ["#bubble", "#canvas"], "minContrast": 1.1 }` pairs. Each selector must match one visible element. The check composites computed background fills through their ancestors in sRGB, then compares relative luminance. Gradients, images, opacity, filters, and blending fail the check as unsupported instead of silently passing. This is a project-specific fill check, not a WCAG text contrast threshold.

Minimal HTML definition:

```json
{
  "version": 1,
  "kind": "html",
  "file": "/tmp/concept.html",
  "notes": "Pre-approval static concept; no server or learner data.",
  "themes": ["dark", "light"],
  "viewports": [{ "width": 320, "height": 640 }],
  "readySelector": "main[data-ready=true]",
  "contentSelector": "main",
  "cases": [{ "kind": "concept", "state": "ready" }]
}
```

Successful output goes to gitignored `.design-captures/<surface>/<short-sha>/`. Each run first writes to a unique sibling `<short-sha>.staging-<unique-suffix>/`, leaving the published capture intact. Only a complete run publishes: a short per-SHA lock serializes renames of the previous folder to a unique backup and staging to the published path, then removes the backup. There can be a brief gap between the two renames; concurrent runs never combine files. A failed or interrupted run exits 1, prints its staging path, and retains an error `floor.json` there for inspection. You can delete that staging folder. A hard kill also leaves staging with its initial error report. Staging, temporary backups, and publication locks are not published captures and cannot be used with `--compare`, even if their report says complete. A stale `<short-sha>.publish-lock/` after a hard kill can be deleted once no run is publishing. All output folders must be direct children of the surface folder; symlink traversal is refused. Copy a published baseline elsewhere to preserve its images; same-directory comparison reads its complete `floor.json` before capturing. `manifest.json` records the full SHA, dirty-worktree flag, definition, runtime, capture status, rendering/font metadata, and each full-frame `file` and `cropFile`. Frames include the full page; content crops preserve 1 CSS pixel per image pixel at DPR 1 with no resizing. Captures wait for readiness, fonts, network quiet, and two animation frames with motion disabled.

`floor.json` records every completed capture identity and axe WCAG A/AA findings (including WCAG 2.2 target spacing), horizontal overflow at every viewport, a stricter 24×24 CSS-pixel target floor, and configured fill separation. The stricter size floor deliberately reports undersized controls even when WCAG spacing or inline exceptions might apply; it is not a conformance verdict. For clipped or 1px native inputs, it measures a visible associated label as the activation target. Visually hidden form transport inputs with `aria-hidden="true"` or negative `tabindex` are skipped because they are not activation targets. Other hidden inputs without a visible label remain findings; reports retain both input and measured target selectors. Axe checks requiring manual review are retained in `incomplete`. Existing product debt is reported without changing product code.

Without comparison, violations exit 0. `--compare <capture-dir>` exits 1 for IDs absent from that baseline's `floor.json` and for any baseline capture identity missing from the current run, naming its case, theme, and viewport. Added coverage is allowed; its findings count as new. Older baselines without capture identities must be recaptured. IDs hash the rule, surface/kind/state/theme/viewport, and selector, excluding SHA and measured values. Custom layout checks prefer a unique `data-testid` to an ID. Before hashing custom selectors and axe targets, Vue/Reka generated ID counters (`v-0`, `v-0-1`, `reka-v-0`, `reka-1`) are normalized; raw selectors stay in the report. Authored IDs and positional selectors remain distinct. An unrelated sibling insertion can change positional IDs and needs human triage. Self-comparison is supported because the baseline is read before output is written. Errors always exit 1 and mark both reports `error`; incomplete or failed baselines are rejected. The stack runs in its own process group. The CLI owns browser signal handling. Ctrl+C and termination forward SIGTERM to that group, wait up to 30 seconds for asynchronous stack cleanup, then kill any surviving descendants; normal completion uses the same cleanup. Automated findings and viewable synthetic renders do not constitute human design approval.
