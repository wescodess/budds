# Design misses

Every miss makes the next run better. A miss is a correction from the human dev at a [Design Climb](climb.md) presentation, or a UI fix to a surface after its approval.

The orchestrator logs each miss in the same PR as its fix, or in the climb's PR when there is no fix yet. Promote it in that PR too, unless the table below sends it to the human dev.

## Promotion

Use the first row that would have caught the miss.

| Miss | Becomes | Who decides |
|---|---|---|
| Greppable in source | Rule in `pnpm design:ratchet`, with its baseline | Automatic only when `DESIGN.md` or the [anti-slop checklist](../agents/design-skills.md#anti-slop-checklist) already states the rule. Otherwise the human dev. |
| Measurable when rendered | Automated check in `pnpm design:capture` | Same condition. |
| A state nobody captured | New entry in `docs/design/surfaces/<surface>.json` | Automatic. |
| Taste | Taste case: an entry below with `Type: taste` | Logging is automatic. Any new rule, token or rubric line goes to the human dev. |

A promotion is done when the new rule, check or surface entry fails or shows the original miss, and the log entry links to it. A taste case is done when its entry links what the human dev chose and rejected, using `docs/design/<slug>/` files or commits. Reference-product screenshots never enter a taste case.

## Entry format

```markdown
### YYYY-MM-DD <surface>: <short title>

- Source: <climb ledger link, or UI fix PR>
- Words: "<the human dev's exact words, or the fix PR's description>"
- Type: greppable | measurable | not captured | taste
- Judges: flagged | missed | not run
- Promotion: <link to the rule, check or surface entry> | taste case | awaiting human dev
- Chosen and rejected: <taste cases only: links>
```

## Log

### 2026-11-06 Delayed check: neutral icons replacing state colors

- Source: [#409 pilot](https://github.com/wescodess/budds/issues/409), [#528 owner decision](https://github.com/wescodess/budds/issues/528)
- Words: "neutral gray replacing meaningful colour"
- Type: measurable
- Judges: flagged
- Promotion: [Functional Colors](../../DESIGN.md#functional-colors), [`status-tone` capture check](../../scripts/design-capture-checks.mjs), [browser regression](../../scripts/design-capture.browser.test.mjs). Straight back at `65943ab` reproduces the state 7 spinner and state 12 Not yet icon; `47796b9` supplies the corrected version. Across both themes and three widths, those two states fall from 12 findings to zero (24 total findings before, 12 after; restored-answer and unavailable-check statuses remain). Rendered color and inherited styling require measurement rather than a source ratchet.

## Shrink

Rules and rubric lines only pile up unless something removes them. Run a shrink after any PR that adds a rubric line, ratchet rule or check, and before moving the climb into a global skill:

1. Between runs, delete one piece of rubric or skill text at a time. These stay whatever the checks show: human-only approval, the five-concept rule, the approval record, `DESIGN.md` precedence, reference storage and `review-gate`.
2. Run `pnpm design:ratchet`, then `pnpm design:capture <surface> --compare <dir>` on the surfaces that text covers, with `<dir>` as the capture from before the deletion. Both must pass.
3. For each taste case judges flagged, give the chosen and rejected options to one fresh judge using the shrunk rubric. The case stays green if the judge still raises the human dev's complaint against the rejected option.
4. Keep the deletion only if steps 2 and 3 stay green. Restore it otherwise.
5. Ship the shrink as its own PR. Update `skills-lock.json` if a skill changed. Changed rubric text means new noise measurements in later runs.

Step 3 is a regression check on known cases. It does not show that judges share the human dev's taste.

## Calibration: deferred

Calibrating judges against taste cases waits until enough independent decisions exist. When it runs, split by decision and by surface, never by option pair, keep an untouched final set, and report uncertainty with the result.

Collection starts now: `ui-design-gate` saves rejected options beside `approved.html`.
