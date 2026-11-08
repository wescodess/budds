# Delayed check: design decision

Spec: [#361](https://github.com/wescodess/budds/issues/361). Canvas adapter: [#442](https://github.com/wescodess/budds/issues/442). Approved mockup: [`approved.html`](./approved.html). Rounds and reasoning: [`notes.md`](./notes.md).

**Chosen:** Today points (round 2). The adaptive Canvas is the only place the check and its result live. Today starts the check from one row and keeps the session closed until the answer is saved; after that the row only reports status in one line and, when a result is ready, links back to the Canvas with "Read it". On the Canvas the check is a quiet room: question, answer and a required 1–5 confidence, with help hidden. After submit, a receipt sits on top with the saved answer, practice on a different case opens below it, and every recovery state fills the receipt slot. When the result arrives, its heading leads the card, the learner's own answer follows, and cited feedback reads under the answer.

**Rejected:**

- Round 1: [Quiet room](./rejected-1-quiet-room.html), [Lock in](./rejected-1-lock-in.html), [Status trail](./rejected-1-status-trail.html), [Today hands off](./rejected-1-today-handoff.html), [Open exit](./rejected-1-open-exit.html).
- Round 2: [Shared receipt](./rejected-2-shared-receipt.html), [Straight back](./rejected-2-straight-back.html), [Read back](./rejected-2-read-back.html), [One page](./rejected-2-one-page.html).

**Owner's words on approval:** `todays points satisfied`

**Also in the owner's words:**

- Round 1: "i like 4,1" (Today hands off and Quiet room).

**Date:** 2026-11-06

## Approved additions

Everything else comes from what already exists in the app.

- Success icon `text-green-700 dark:text-green-400`, already approved in [quiz-grading-results](../quiz-grading-results/decision.md).
- `text-[var(--learn-attention)]` on the processing spinner and on warning and Not yet icons. Text beside them stays `text-foreground` or `text-muted-foreground`, because the warning colour is below AA as text on the light card.
- "Getting your result" on Today's status row uses that warning-colour spinner, where `approved.html` shows it grey. Owner, 2026-11-07: "yes". The Canvas line already uses it.
- The practice card ends with a filled "Submit response", following `app/components/learn-adaptive/ReadySessionCanvas.vue`.

## Product decisions carried into the build

- Confidence 1–5 is required before submit. There is no time limit; leaving keeps the on-device draft.
- The receipt appears only after the server returns a submission ID. Refresh restores the same question and draft. Retrying a failed submit or score reuses the same submission; an unconfirmed result has no retry and no guess.
- Practice on a different case is allowed while scoring is pending, failed or unconfirmed. Practice does not ask for confidence in the approved design.
- Today never states the result or shows feedback. It says a result is ready and links to the Canvas.
- A missing question never falls back to a lesson under the same check; Today shows no row.
- Learner copy says "check", never "delayed", "retained" or "mastery". No rubric, criteria, score or model answer is shown.
- "Budds will check this again in about three weeks" stands in for whatever the server schedules.

## Known debt

Light-theme `--muted-foreground` measures below AA on `--background` and `--card`. The owner kept the token locked; it is every capture violation in this design.

## Building it

Read this file and `approved.html` before writing UI code. After the build, compare it with `approved.html` and `DESIGN.md` in a browser, including mobile, then run the [climb's fidelity mode](../climb.md#fidelity-and-revamp-rounds) with the capture of `docs/design/surfaces/learn-delayed-check.json` as `TARGET`.
