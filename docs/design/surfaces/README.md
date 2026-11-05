# Surface captures

Run `pnpm design:capture learn-adaptive-canvases` on demand. Install Chromium once with `pnpm exec playwright install chromium`. This command does not run in the regular test or CI browser suite.

Run route captures separately from Nuxt builds and component tests, which share generated Nuxt/Vite caches. A dependency-cache 504 is a capture error; rerun after compilation finishes.

Definitions live in `docs/design/surfaces/<surface>.json`. Version 1 requires:

- `kind`: `routes` starts the existing disposable `scripts/e2e-stack.mjs`. Each case has a local `path`. The runner refuses occupied ports and never reuses a server. Existing production, loopback, and disposable-deployment checks still apply.
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

Output goes to gitignored `.design-captures/<surface>/<short-sha>/`. Re-running at the same SHA overwrites the reports and matching PNGs; copy a baseline elsewhere before changing the definition. `manifest.json` records the full SHA, dirty-worktree flag, definition, runtime, capture status, rendering/font metadata, and each full-frame `file` and `cropFile`. Frames include the full page; content crops preserve 1 CSS pixel per image pixel at DPR 1 with no resizing. Captures wait for readiness, fonts, network quiet, and two animation frames with motion disabled.

`floor.json` records axe WCAG A/AA findings (including WCAG 2.2 target spacing), horizontal overflow at every viewport, a stricter 24×24 CSS-pixel target floor, and configured fill separation. The stricter size floor deliberately reports undersized controls even when WCAG spacing or inline exceptions might apply; it is not a conformance verdict. Axe checks requiring manual review are retained in `incomplete`. Existing product debt is reported without changing product code.

Without comparison, violations exit 0. `--compare <capture-dir>` exits 1 for IDs absent from that baseline's `floor.json`. IDs hash the rule, surface/kind/state/theme/viewport, and selector, excluding SHA and measured values. Self-comparison is supported because the baseline is read before output is written. Errors always exit 1 and mark both reports `error`; incomplete or failed baselines are rejected. If a run is killed, its initial error status prevents unfinished output from looking successful. Automated findings and viewable synthetic renders do not constitute human design approval.
