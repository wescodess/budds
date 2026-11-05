# Quiz grading results: design decision

Spec: [#374](https://github.com/wescodess/budds/issues/374), ticket T4. Approved mockup: [`approved.html`](./approved.html).

**Chosen:** Score strip, "Tiles and a decide button": today's two tiles with the strip inside the score tile; while an answer needs the learner, the score says "for now" and a primary "Decide N answers" button leads.

**Rejected:**

- Round 1: Marked paper, Gaps first, Ledger and your-call pass, Walkthrough.
- Round 2: Strip and rail, Strip only, Decide under the strip, The rail is the strip.

**Owner's words on approval:** `satisfied`

**Also in the owner's words:**

- "we dont want the criterieon showing to the leaner. the leaner should be only concerned with answering the questions, every other abstraction should be hidden"
- On icons: "darken in respect to theme"
- On the reference answer: "right after"

**Date:** 2026-11-05

## Approved additions

Everything else comes from what already exists in the app.

- Icons: `text-green-700 dark:text-green-400`, `text-yellow-700 dark:text-yellow-400`, and `stroke-*` equivalents on the score ring and percentage.
- `text-foreground` for the "Your call" icon.
- `dark:text-foreground` on icons in the selected rail row, because its dark background otherwise leaves them too faint.
- `UiPagination` previous and next for long strips.
- `flex-wrap` on the decision `UiToggleGroup`.
- Composed pieces: score strip and cell (`UiButton` outline plus a fill span using `bg-green-500/20`), result badge (`UiBadge` plus icon, including "marked by you"), decision block (`UiAlert` plus `UiToggleGroup`), retry block (`UiAlert` plus two `UiButton`s).
