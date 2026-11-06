# Delayed check concepts for #361

Round 1 of the [ui-design-gate](../../../.agents/skills/ui-design-gate/SKILL.md): five concepts for the test-only delayed check and the states after submission, on the adaptive Canvas and Today. Nothing here is approved.

| Concept | File | Varies |
|---|---|---|
| Quiet room | [concept-quiet-room.html](./concept-quiet-room.html) | Hierarchy: the check is the only thing on the page; after submit a small receipt sits above inline practice |
| Lock in | [concept-lock-in.html](./concept-lock-in.html) | Interaction: write, then a review step asks confidence and locks the answer; practice and result are separate screens |
| Status trail | [concept-status-trail.html](./concept-status-trail.html) | Layout: a trail beside the work (above on phones) carries every lifecycle and recovery state; Today shows the same trail |
| Today hands off | [concept-today-handoff.html](./concept-today-handoff.html) | Placement: Today owns the check and holds the session closed until the answer is saved; scoring and results live on Today |
| Open exit | [concept-open-exit.html](./concept-open-exit.html) | Interaction: help buttons stay in place but locked; “I’d rather learn it first” ends the check without a result and starts a lesson |

Each file stacks every state with a review annotation (not product UI) and has a theme toggle. Annotations tag each state as a measurement repair, added teaching, recovery or context, as #361 asks.

## Measurement repairs and added teaching

Measurement repairs, common to all five:

- The check opens on its own entry card, never on a cited explanation, worked example, hint or reveal.
- Why this, Evidence, Memory, contributions and chat are hidden or locked while the check is open.
- The saved state appears only after the server returns a submission ID; a staged activity status is not treated as saved.
- Refresh returns the same question and the on-device draft; nothing is regenerated.
- Retrying a failed submit or a failed score reuses the same submission. An unconfirmed result has no retry and no guessed result.
- “You still had it” appears only after the scored pass is committed. Invalid and unconfirmed checks imply no result.
- A missing question never falls back to a lesson under the same check.

Added teaching:

- Practice on a different case once the answer is sealed, before or after scoring.
- Prose feedback on the learner’s own answer after a valid score. No rubric, criteria, score breakdown or model answer.
- A lesson on the same topic after a valid miss, or after the learner ends the check (Open exit only).

## Flags for the owner

- **Token contrast, light theme.** `--muted-foreground` (`oklch(0.553 0.013 58.1)`, renders `#79716b`) measures 4.39:1 on `--background` and 4.13:1 on `--card`, below WCAG AA 4.5:1 for 12–14px text. Every violation in these captures is this pair; dark theme has none. The concepts use the real token unchanged. Fixing it needs a token change, which is the owner’s call.
- **Reused approved addition.** Success icons use `text-green-700 dark:text-green-400`, approved in [quiz-grading-results](../quiz-grading-results/decision.md).
- **Open exit only.** The confirmation uses `shadow-md`, which `DESIGN.md` allows for popovers and dialogs.

No new colours, tokens or fonts. Existing drift that the concepts do not copy: uppercase tracked eyebrows, amber text links in light theme, and the visible-text/accessible-name mismatch on Today’s leave button.

## Assumptions made

- Confidence stays 1–5 and is required before submit, as on the current Canvas.
- There is no time limit, and leaving keeps the on-device draft without ending the check.
- After sealing, practice is allowed on a different case while scoring is pending, failed or unconfirmed.
- Results reach Today when the learner has left the Canvas.
- “Check again in about three weeks” stands in for whatever the server schedules next.
- Leaving the check for help is offered only in Open exit. The other four have no in-check exit.
- Learner-facing copy says “check”, never “delayed”, “retained” or “mastery”.

## Captures

HTML surfaces load one file for every case, so each surface has one case, `concept/all-states`, captured in both themes at 1280, 390 and 320 wide. Definitions: `docs/design/surfaces/learn-delayed-check-<name>.json`.
