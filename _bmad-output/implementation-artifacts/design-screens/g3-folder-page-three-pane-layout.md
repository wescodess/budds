---
spec: g3-folder-page-three-pane-layout
phase: design
generated_at: 2026-04-13T13:45:00Z
generator: stitch-ui-story-design
stitch_project_id: 2926819289448574055
design_system: Warm Focus (assets/11175050301981891392)
---

# G3 — Folder Page 3-Pane Layout · Stitch Screens

Replaces the prior markdown-only proposal. All five screens generated via Stitch (`mcp__stitch__batch_generate_screens`) inside the existing **Warm Focus** project, so palette/typography/radius match the dashboard, knowledge drawer, and chat/flash/quiz voids.

**Reference screenshot:** `docs/screenshots/Screenshot 2026-04-12 at 11.52.19 PM.png`

---

## Screen set

| # | State | Device | Stitch screen ID |
|---|---|---|---|
| 1 | Default — Helper closed, Chat tab active, assistant message with `[1][2]` citations | Desktop 1440 | `4bc72d3bd5ae451e80e3450fbb5499c7` |
| 2 | Helper open — citation click reveals 2 source cards (Bruice + Lecture notes) | Desktop 1440 | `3a5e62149a4b495f87baedc1368586e2` |
| 3 | Flipped — Helper in middle, Primary on right | Desktop 1440 | `e29135ced58046dcb6762fe11201f5ef` |
| 4 | Tablet — A + B side-by-side, Helper overlays as right sheet | Tablet ~900 | `30a7ec0137c14820a4a5ae6aaa8a5ee6` |
| 5 | Mobile — stacked, Folder ▾ dropdown header, Helper as bottom sheet | Mobile 390 | `e197f4e451684e1d8975b90295d24fc7` |

Open in Stitch:
- https://stitch.withgoogle.com/projects/2926819289448574055/screens/4bc72d3bd5ae451e80e3450fbb5499c7
- https://stitch.withgoogle.com/projects/2926819289448574055/screens/3a5e62149a4b495f87baedc1368586e2
- https://stitch.withgoogle.com/projects/2926819289448574055/screens/e29135ced58046dcb6762fe11201f5ef
- https://stitch.withgoogle.com/projects/2926819289448574055/screens/30a7ec0137c14820a4a5ae6aaa8a5ee6
- https://stitch.withgoogle.com/projects/2926819289448574055/screens/e197f4e451684e1d8975b90295d24fc7

(Use `mcp__stitch__fetch_screen_image` with these IDs for inline previews.)

---

## Intent (carried from prior proposal)

3 panes to the right of the G2 Atlas rail:

- **Pane A — Folder context** (~240px, resizable). Folder badge + name, breadcrumb, ellipsis menu, `Knowledge tree (G4)` placeholder card.
- **Pane B — Primary** (flex-1). Existing Tabs (Chat / Flash Cards / Quiz / Documents). Header has a `Sources` button + flip-toggle icon.
- **Pane C — Helper** (~360px, hidden by default). Citations panel; opens on inline `[n]` click or `Sources` button; close X inside.

Flip toggle swaps Pane B ↔ Pane C order. Per-folder layout state persisted in `localStorage` (sizes, helperOpen, flipped).

Responsive: tablet collapses Pane C to right sheet overlay; mobile stacks with Folder ▾ dropdown and Helper as bottom sheet.

---

## Resolved decisions

1. Citation click → opens Pane C and scrolls to source. Inline expansion only on `<768px`.
2. Pane A G3 content: folder header + Knowledge placeholder. No subfolder tree (G4).
3. Persistence: `localStorage` only, per-folder key.

---

## Open questions for approval

1. Helper default size 360px — confirm or override.
2. Flip toggle visible only when Helper is open? (recommended yes)
3. Source card content density — 1 snippet per card (current) vs collapsible passages.

---

## Code map preview

- `app/pages/app/folders/[id].vue` — refactor to `<UiResizablePanelGroup>` with three `<UiResizablePanel>`s; hoist Tabs into middle, hoist `SourcePanel` into right.
- `app/components/folders/FolderContextPane.vue` — NEW.
- `app/composables/useFolderLayout.ts` — NEW. SSR-safe localStorage persistence.
- Tests: `tests/component/folders/folder-three-pane.test.ts` — defaults, flip swaps order, helper toggle, per-folder persistence.
