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
- The practice card ends with an outlined "Submit answer" in the existing secondary style, replacing the filled "Submit response" in `approved.html`. See [Decisions after the fidelity run](#decisions-after-the-fidelity-run).

## Product decisions carried into the build

- Confidence 1–5 is required before submit. There is no time limit; leaving keeps the on-device draft.
- The receipt appears only after the server returns a submission ID. Refresh restores the same question and draft. Retrying a failed submit or score reuses the same submission; an unconfirmed result has no retry and no guess.
- Practice on a different case is allowed while scoring is pending, failed or unconfirmed. Practice does not ask for confidence in the approved design.
- Today never states the result or shows feedback. It says a result is ready and links to the Canvas.
- A missing question never falls back to a lesson under the same check; Today shows no row.
- Learner copy says "check", never "delayed", "retained" or "mastery". No rubric, criteria, score or model answer is shown.
- "8 days after you studied it" and "Budds will check this again in about three weeks" stay omitted until the server provides timing.

## Copy approved after the mockup

Owner, 2026-11-08. These override `approved.html`.

- Not yet reads "That's common, and it's why we check.", replacing "That's common after a week, and it's why we check."
- A failed start reads "Could not start this session. Try again."
- Failed practice help reads "Could not load support. Try again."
- A failed practice submit reads "Submission did not confirm. Your draft remains here. Retry submission to reconcile it."
- A saved practice answer reads "Response submitted."
- A failed online submit reads "It's still here on this device. Submit again." under "Your answer wasn't submitted". Owner's choice, 2026-11-09, replacing "It's still here on this device."
- An empty practice answer reads "Write your answer before you submit."
- A cancelled or abandoned check uses "Your check isn't ready yet".
- The server's `instructions` field stays hidden.

## Content label

**Chosen:** [Caption line](./approved-content-label.html). The origin of teaching content joins the small caption above the block. `T1` feedback and lessons read "From the web, not yet verified", and `T2` practice prompts and worked examples read "Written by Budds, not source-checked". Labels use `text-foreground`, so colour never carries the meaning, and learners never see the tier codes.

**Rejected:** [With the sources](./rejected-label-with-the-sources.html), [Corner tag](./rejected-label-corner-tag.html), [What this means](./rejected-label-what-this-means.html), [Run-in](./rejected-label-run-in.html).

**Owner's words on approval:** picked `1. Caption line`, `Use it, no mark`, and on final confirmation `Yes, satisfied`.

**Date:** 2026-11-08

Source-checked content shows no mark, so `T0` prompts, hints and worked examples show no visible origin.

## Decisions after the fidelity run

Owner, 2026-11-09: "use your reccomendations". These override `approved.html`.

- While the check is open (`test_open`, the question is being answered) the eyebrow reads "Check · <subject>", as `approved.html` shows, derived from the server phase. In every other state it stays "Void · <subject>", following the [rename resolution](https://github.com/wescodess/budds/issues/358#issuecomment-6651400245). Both use the same muted sentence-case treatment, and ordinary threads do not change.
- The practice submit button uses the outlined secondary style in every state, so a result and practice shown together never have two filled buttons.
- The practice submit button reads "Submit answer", the same as the check. "Response submitted." stays.
- "Open your Void" stays under the check as the way out.
- The worked-example panel stays as approved in dark.
- The locked light-theme `--muted-foreground` contrast and the app-wide missing document title are accepted for this surface's capture floor. The title is tracked separately.

## Known debt

Light-theme `--muted-foreground` measures below AA on `--background` and `--card`. The owner kept the token locked; it is every capture violation in this design.

## Building it

Read this file and `approved.html` before writing UI code. After the build, compare it with `approved.html` and `DESIGN.md` in a browser, including mobile, then run the [climb's fidelity mode](../climb.md#fidelity-and-revamp-rounds) with the capture of `docs/design/surfaces/learn-delayed-check.json` as `TARGET`.
