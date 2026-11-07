# Delayed check concepts for #361

Round 1 of the [ui-design-gate](../../../.agents/skills/ui-design-gate/SKILL.md): five concepts for the test-only delayed check and the states after submission, on the adaptive Canvas and Today. The approved design is [approved.html](./approved.html); see [decision.md](./decision.md).

| Concept | File | Varies |
|---|---|---|
| Quiet room | [rejected-1-quiet-room.html](./rejected-1-quiet-room.html) | Hierarchy: the check is the only thing on the page; after submit a small receipt sits above inline practice |
| Lock in | [rejected-1-lock-in.html](./rejected-1-lock-in.html) | Interaction: write, then a review step asks confidence and locks the answer; practice and result are separate screens |
| Status trail | [rejected-1-status-trail.html](./rejected-1-status-trail.html) | Layout: a trail beside the work (above on phones) carries every lifecycle and recovery state; Today shows the same trail |
| Today hands off | [rejected-1-today-handoff.html](./rejected-1-today-handoff.html) | Placement: Today owns the check and holds the session closed until the answer is saved; scoring and results live on Today |
| Open exit | [rejected-1-open-exit.html](./rejected-1-open-exit.html) | Interaction: help buttons stay in place but locked; “I’d rather learn it first” ends the check without a result and starts a lesson |

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

## Round 2

The owner’s reaction to round 1, verbatim: “i like 4,1”. That is Today hands off ([rejected-1-today-handoff.html](./rejected-1-today-handoff.html)) and Quiet room ([rejected-1-quiet-room.html](./rejected-1-quiet-room.html)). These five variations blend the two. The owner approved Today points ([approved.html](./approved.html)).

| Variation | File | Idea | What varies |
|---|---|---|---|
| Shared receipt | [rejected-2-shared-receipt.html](./rejected-2-shared-receipt.html) | One small receipt is the whole after-state: it sits above practice on the Canvas where you submitted and, identically, above the opened session on Today. | Landing: stay on the Canvas. Result: both surfaces, from one component. Today gains one receipt card. |
| Straight back | [rejected-2-straight-back.html](./rejected-2-straight-back.html) | The Canvas holds only the question; submitting returns you straight to Today, where a small receipt quotes your answer and the session opens beneath it. | Landing: Today, with no Canvas confirmation screen. Practice becomes the session’s first part. Result: Today only. |
| Today points | [approved.html](./approved.html) | The Canvas is the only place the check and its result live; Today carries a single status row that points back to it. | Result: Canvas only. Today gains one row and never shows feedback. |
| Read back | [rejected-2-read-back.html](./rejected-2-read-back.html) | Submitting locks your answer in place instead of replacing it, and the result arrives as short notes written against your own sentences. | Interaction: no receipt swap. Hierarchy: the learner’s answer is the feedback surface, on the Canvas and on Today. |
| One page | [rejected-2-one-page.html](./rejected-2-one-page.html) | Today itself becomes the quiet room while the check is open, then folds the check into one status line under its title and lets the session take the page. | Entry and placement: no Canvas check at all; the Canvas only points to Today. |

Each file keeps the 13 states and the measurement repairs above, stacks every state with review annotations (not product UI), and has a theme toggle. Where a state reads differently on each surface, the file shows both frames, captioned.

### Round 1 fixes carried forward

- “Won’t count”, “couldn’t confirm” and “scoring stopped” use the warning colour (`--learn-attention`, which is `--warning`), not a neutral one.
- Feedback on Passed and Not yet always carries a citation and its source line.
- Each frame uses flat sections inside one card, with no nested cards. The refresh notice and the submit failure are flat rows with a divider, not alert boxes inside the card, which removes Quiet room’s state 5–6 leftover.
- Passed always shows a filled primary action.
- Today shows no progress bars, which removes the faint dark-mode bars. Status rows and button groups wrap at 320px without truncating labels.
- Concept 4’s weakness: whenever feedback is shown, the learner’s own saved answer sits directly above it in the same card (quoted in Shared receipt, Straight back, Today points and One page; annotated sentence by sentence in Read back).

### Recommendation

**Shared receipt.** It keeps what the owner liked in both concepts and drops each one’s weak point. From Quiet room it keeps the quiet page and the small locked receipt, with practice straight away. The wait for a score is never dead time, and the learner is never moved off the page where they wrote. From Today hands off it keeps Today as the place that starts the check, holds the session closed and shows the result above the session. The difference is that Today shows the same receipt instead of its own result card, so feedback can never come loose from the answer: the answer travels inside the receipt. All recovery states fit one slot in one component, which serves both surfaces and keeps #442’s Today work to one card. The others trade something real:

- Straight back takes the learner away from the page they wrote on.
- Today points makes Today unable to tell the learner how they did.
- Read back is the strongest feedback form, but sentence-level notes need the scorer to anchor notes to spans. That is a new server contract, which belongs to another decision.
- One page moves the check off the Canvas, so #442’s scope moves to Today.

If the owner likes Read back’s annotated answer, it can replace the quoted answer and the prose feedback inside the Shared receipt without changing the flow.

### Assumptions

Every round 1 assumption stands unchanged: confidence 1–5 required, no time limit, practice on a different case allowed while scoring is pending, failed or unconfirmed, and learner copy that says “check” and never “delayed”, “retained” or “mastery”. No rubrics, criteria, scores or model answers are shown. Additions:

- In Straight back and One page, practice on a different case is the first part of today’s session rather than a separate block.
- In Shared receipt, the receipt body is identical on both surfaces and only the next action differs: on the Canvas it is “Start today’s session”; on Today, the session card below holds it.
- In Today points, Today never states the result itself; it says that a result is ready and links to the Canvas.

### Flags for the owner

- **Token contrast, light theme.** Unchanged from round 1: every capture violation is `--muted-foreground` on `--background` or `--card` in light theme. Dark theme has none.
- **Reused approved addition.** The success icon `text-green-700 dark:text-green-400`, as in round 1.
- **Read back only.** Highlighting sentences the learner wrote marks parts that held with the approved success colour (`border-green-700 dark:border-green-400`) and parts that slipped with `border-[var(--learn-attention)]`; no new colour. It does assume the scorer can return feedback anchored to spans of the answer, which is not in the current contract (#360/#363).
- **One page only.** The check would run inside Today, not the adaptive Canvas, so #442 (Canvas adapter only, “distinct from Today UI”) would need rescoping. It also gives Today the heaviest change of the five.

No new colours, tokens or fonts.

### Captures

Same conventions as round 1: one `concept/all-states` case per file, both themes, 1280, 390 and 320 wide. Only the approved design keeps a surface: `docs/design/surfaces/learn-delayed-check.json`.
