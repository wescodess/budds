# Learner map editor concepts for #515

Round 1 of the [ui-design-gate](../../../.agents/skills/ui-design-gate/SKILL.md): five concepts for the learner map editor without the assessment section, so map-edit candidates no longer carry learner-supplied contracts. The approved design is [approved.html](./approved.html); see [decision.md](./decision.md).

| Concept | File | Idea |
|---|---|---|
| Side panel | [rejected-1-side-panel.html](./rejected-1-side-panel.html) | The map list leads; selecting an objective opens its edit form in a side panel. |
| Unfold | [rejected-1-unfold.html](./rejected-1-unfold.html) | One objective unfolds in place into its edit form; the rest stay as calm rows. |
| Outline | Refined in round 2 | The map reads as text with citations; the selected objective becomes editable in place. |
| Milestone board | [rejected-1-milestone-board.html](./rejected-1-milestone-board.html) | Milestones as columns; objectives open in a drawer with Learn first and Comes next. |
| One at a time | [rejected-1-one-at-a-time.html](./rejected-1-one-at-a-time.html) | One objective per card with its source passage; order lives on a separate view. |

Each file stacks its states with review annotations (not product UI) and has a theme toggle.

## Round 1 checks

Automated checks ran on all five in dark and light at 1280, 390 and 320 wide: no page errors, overflow, undersized targets or neutral status icons, and fonts loaded. Every axe finding was `color-contrast` in light only, on `--muted-foreground` (A1). A copy search found no assessment, criteria, rubric, weight, score or grade wording.

Findings common to all five:

- **A1:** light `--muted-foreground` below AA. Needs a token change, which only the owner can approve.
- **A2:** "Do your sources cover this?" is about sources, but the learner still sets it by hand. Deriving it needs a server change. Still open.
- **A3:** the progress label is left to the Progress tab during map review.
- **A6:** new objectives depend on the paired server change to generate their contracts.

Author critique by concept:

- **Side panel:** closest to today's app, but two panes compete, Save sits below the fold, and the shell's side column would have to leave the tab.
- **Unfold:** calmest list, but the open form pushes the order away, and moving needs opening first.
- **Outline:** strongest fit with content over chrome and visible citations. Weak points: editability not signalled, a tall sources pop-over, an unclear save point for chips, and a long page with no overview of the order.
- **Milestone board:** clearest statement of order, but reads as a planning tool, hides structure behind the drawer overlay, and stacks into a list on phones.
- **One at a time:** strongest study feel, but editing breaks the focus and reordering needs a mode switch.

Blind judges (one fresh Sol 6.1 per option) found nested cards, a large amber fill and neutral Remove buttons. These were fixed as styling. Objections that would change a concept: Side panel's persistent tabs and parallel panel, Unfold's persistent second column, and the board's long path to Save for a title change.

The owner chose Outline: `recommended answers`.

## Round 2

Three refinements of Outline, each fixing round 1's Outline defects.

| Option | File | What varies |
|---|---|---|
| 3a Outline, refined | [rejected-2-outline-refined.html](./rejected-2-outline-refined.html) | The selected objective's words sit in text boxes, with its controls above and one Save at its foot. Draws every editor state. |
| 3b Outline with an order bar | [approved.html](./approved.html) | 3a plus one bar at the foot of the window holding Order and Accept. Order opens a pop-over of every objective by milestone. |
| 3c Outline with a titles-only switch | [rejected-2-outline-titles.html](./rejected-2-outline-titles.html) | 3a plus a switch that folds every objective to its title. |

### Checks

Dark and light at 1280, 390 and 320: no page errors, failed requests, overflow, undersized targets or neutral status icons, and fonts loaded. Every axe finding is `color-contrast` in light only: A1 in all three, plus A1b in 3a's save-failure alert. Visible text, labels and field values contain no criteria, rubric, weight, score or grade wording.

Fixed during the checks: chip labels now match their visible text, the bar's "Go to it" link meets the target size, the Remove label and number badges were recoloured for contrast, pop-over scroll bodies have `role="region"`, and duplicate IDs across states are prefixed.

### Judge triage

One fresh blind Sol 6.1 judge per option.

- **Dismissed:** persistent tabs and the summary row belong to the existing Void shell, not this surface; raised separately as [#553](https://github.com/wescodess/budds/issues/553). The light `--destructive` matches the token `DESIGN.md` specifies.
- **Confirmed and fixed:**
  - The "what comes first" picker now shows full titles.
  - Save-failure copy no longer asks the learner to know whether another change was made. A new state covers a map that changed somewhere else, with one "Reload and keep my changes" action.
  - The sidebar's Learn item and the order pop-over's current objective use the amber rail and 8% amber tint in both themes.
  - The open editor sits on `--card` instead of an amber fill, in all three.
  - 3c's full state now shows all 15 objectives and Accept, and its folded rows end in a chevron.
- **Objection for the owner:** 3c's titles view hides every citation while Accept stays available. This is inherent to 3c.

### Author notes

- 3b's bar is a fixed element. `DESIGN.md` allows a fixed bottom input but not persistent panels; the bar is one line of navigation plus Accept.
- 3b's order pop-over is navigation only; moving still happens on the objective.
- 3a's pop-over covers the objective's own save row while open. Its Done button closes it and nothing is lost.
- In 3a and 3b, citations on the selected objective move into the Sources chip, because its sentence becomes a text box.
- On mobile, text boxes use 16px to stop iOS zooming, so the selected title reads larger than the others at 390.
- 3c hides citations and what each objective covers while folded, which works against Outline's main strength.
- Moves and splits are held in the same save as other changes to the objective. Holding a split is not drawn.

The owner chose 3b: `reccommended answers`, then approved it: `Approve 3b as is (Recommended)`.

## Open items

- **A1:** light `--muted-foreground` (`#79716b`) at 3.88 to 4.39:1. Shows in the shell's tabs and nav, captions, hints and source origins.
- **A1b:** light `--destructive` (`#e7000b`) at 4.37:1 on `--background`, in the page's existing `role="alert"` error.
- **A2:** the sources coverage control is unchanged from round 1.
- **Void tab strip:** the workspace tabs against the `DESIGN.md` "No tabs" rule, [#553](https://github.com/wescodess/budds/issues/553).

## Captures

One `concept/all-states` case for `approved.html`, both themes, 1280, 390 and 320 wide: `docs/design/surfaces/learner-map-editor.json`. Dark has no findings; light has only A1. The round 1 and 2 options were captured from temporary definitions, since removed.
