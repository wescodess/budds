# Learner map editor: design decision

Spec: [#515](https://github.com/wescodess/budds/issues/515). Blocks C4: [#514](https://github.com/wescodess/budds/pull/514). Approved mockup: [`approved.html`](./approved.html). Rounds and reasoning: [`notes.md`](./notes.md).

**Chosen:** Outline with an order bar (round 2, 3b). The Learning map tab reads as an outline: each objective is plain text with its citations, grouped by milestone. Selecting an objective puts its title and what you'll be able to do in text boxes, with Move earlier, Move later, Split and Remove above them and time, depth, what comes first and sources as chips. Every change to that objective is held and saved together with one Save. One slim bar sits at the foot of the window, like the chat input. It holds Order and Accept learning map, so neither is ever far away. Order opens a pop-over that lists every objective by milestone, marks the one in view and flags source gaps; tapping one jumps to it. When an objective has unsaved changes, the bar names it with "Go to it", and Accept waits until it is saved or cancelled. Sources close the page, and Accept appears only in the bar.

**Rejected:**

- Round 1: [Side panel](./rejected-1-side-panel.html), [Unfold](./rejected-1-unfold.html), [Milestone board](./rejected-1-milestone-board.html), [One at a time](./rejected-1-one-at-a-time.html).
- Round 2: [Outline, refined](./rejected-2-outline-refined.html) (3a), [Outline with a titles-only switch](./rejected-2-outline-titles.html) (3c).

**Owner's words on approval:** `Approve 3b as is (Recommended)`

**Also in the owner's words:**

- Round 1: `recommended answers` (Outline, with the orchestrator's recommended side effects).
- Round 2: `reccommended answers` (3b).
- States 3b does not draw follow 3a, with Accept only in the bar: `Yes, follow 3a (Recommended)`.
- 2026-11-18: `fit`. At 320 wide the bar stays on one row: Order becomes an icon-only button (its existing icon, named "Order", 36px) next to Accept, so the first objective's citations stay in view. It narrows only when the bar is under 21rem; wider bars keep the approved Order button.

**Date:** 2026-11-17

## Approved additions

Everything else comes from what already exists in the app.

- A bar pinned to the foot of the Learning map tab (`sticky bottom-0`), a bordered `--card` row like the chat input, holding Order and the filled Accept learning map. `DESIGN.md` allows a fixed bottom input but no persistent panels; the owner approved this bar as one line of navigation plus Accept.
- On this tab, Accept in the bar replaces the shell's Keep moving action, and the Keep moving and Readiness column is not drawn.
- The order pop-over, using the existing popover `shadow-md`. It is navigation only; moving happens on the objective.
- Remove keeps a `--destructive` icon, with a `text-foreground` label in light and a `--destructive` label in dark, because light `--destructive` on the selected tint measures below AA.
- The selected objective's editor sits on `--card`. The current objective in the order pop-over and the sidebar's Learn item use the `DESIGN.md` active state: amber left rail and 8% amber tint.

## Build choices the mockups don't draw

Owner's words, 2026-11-17: `No Add on empty map, Time/depth pop-overs, One objective at a time, Warning-colour spinner`, and for Split: `Hold until Save (Recommended)`.

- The empty map has no Add objective action, because a map saves only with 6 to 15 objectives.
- Time and depth use the same pop-over shape as the other chips.
- While one objective has unsaved changes, another can't be selected; the bar's Go to it returns to it.
- The saving spinner uses `--learn-attention`, as `DESIGN.md` requires for in-progress states.
- Split is held with the objective's other changes and sent on Save.

## Product decisions carried into the build

- Learners never see or edit criteria, rubrics or weights. The editor has no assessment section, and learner copy never mentions one.
- Map-edit candidates carry no contract fields.
- The server keeps existing objectives' contracts and generates contracts for new objectives. It never accepts contracts from the client.
- All changes to one objective (words, time, depth, what comes first, sources, moves and splits) are held and sent as one candidate.

## Known debt

- **A1:** light `--muted-foreground` measures below AA on the light surfaces. The owner keeps the token locked.
- **A1b:** light `--destructive` measures 4.37:1 on `--background`, in the page's existing `role="alert"` error.
- The Void workspace tab strip is in tension with the `DESIGN.md` "No tabs" rule. It belongs to the shell, not this surface: [#553](https://github.com/wescodess/budds/issues/553).

## Building it

Read this file and `approved.html` before writing UI code. `approved.html` draws four states and is 3a plus the bar. The editor's other states are drawn only in [3a](./rejected-2-outline-refined.html): sources, what comes first, saving, both save failures, loading, no objectives and one objective. Follow them there, except that Accept lives only in the bar. After the build, compare it with `approved.html` and `DESIGN.md` in a browser, including mobile, then run the [climb's fidelity mode](../climb.md#fidelity-and-revamp-rounds) with the capture of `docs/design/surfaces/learner-map-editor.json` as `TARGET`.
