---
name: review-gate
description: Run before an implementation PR is ready or merged. Require independent Sol reviews to high confidence, then up to two Opus reviews, with verified fixes and a ledger tied to the final head.
---

# Review gate

The orchestrator runs this gate on a committed merge unit or PR, verifies findings, and dispatches fixers. Reviewers are read-only; fixers never review their own fix. An agent that cannot delegate must hand back to the orchestrator.

## Routing and preparation

Use a new `delegate_task` with fresh context for every review and re-check; never resume a previous reviewer. Call `orchestrator_capabilities` once before the first delegation. If a required model is unavailable, report the blocker instead of substituting.

- Sol 6.1: provider `codex`, model `gpt-6.1-sol`, `target.options.reasoningEffort: high` for reviews. Choose the effort the fix needs for Sol fixers.
- Opus 5.5: provider `claudeAgent`, model `claude-opus-5-5`, `target.options.effort` chosen for risk or fix complexity.

All UI/UX work, including fixes in UI code at either stage, goes to Opus 5.5 under [ui-design-gate](../ui-design-gate/SKILL.md). Reviewers stay as specified below; only fixers change. UI fixers read the approved inputs in `docs/design/<slug>/`; material design changes return through that gate.

Pin the comparison base and current head SHA. Give each reviewer the ticket or spec, the diff to that head, relevant standards and design records, their lens, and already-dismissed findings with reasons. Review the pinned snapshot; discard a round if its head changes while it runs.

Require each finding to include **file and line, severity, concrete failure scenario, evidence, and confidence**. Style preferences are not findings. The orchestrator checks each claim against the spec and code before acting, records dismissals with reasons, and dispatches confirmed findings for fixes. Commit fixes before the next round.

## Stage A: Sol loop

Run sequential, independent Sol 6.1 high reviews against the current head. Rotate a different lens each round, choosing the next by risk:

- Correctness and spec fit: use the **Standards** and **Spec** axes in [/code-review](../code-review/SKILL.md).
- Server authority, security, and privacy.
- Failure modes, idempotency, and concurrency.
- Tests that actually prove behaviour.
- Integration and regressions.
- For UI, accessibility and fidelity to the approved design in `docs/design/<slug>/`.

Fix confirmed findings with Sol 6.1, except UI fixes use Opus 5.5. Then review the new head with a fresh reviewer. Keep low-risk rounds small; do not require every lens when the stop rule is already met.

**High confidence requires two consecutive fresh rounds with no confirmed finding of medium severity or higher, at the same head SHA, and passing repository checks at that head.** Run `pnpm verify` plus relevant feature gates such as `pnpm verify:learn-v2-beta`. A failed, blocked, or unrun required check cannot pass. Any new commit resets the clean-round count; never carry it to another SHA.

After **8 Stage A rounds** without high confidence, stop and escalate to the human dev. Fixes and head changes do not reset that budget. If the same confirmed finding returns after **two fix attempts** at any stage, stop and escalate. Never quietly pass a non-converging loop.

## Stage B: Opus reviews

Start only after Stage A passes. Run a fresh Opus 5.5 review of the full change, including what the Sol loop may have missed. Use effort appropriate to risk. Allow **at most two Opus review rounds**:

1. If the first review has no confirmed issue, finish; do not run a second just to use it.
2. If it finds a confirmed issue, fix with Sol 6.1 at the effort the fix needs (Opus 5.5 for UI). Commit the fixes and confirm required checks pass at that head. Then run the second fresh Opus review against the full updated change.
3. If the second review has no confirmed issue, finish. Otherwise, fix its confirmed issues with Opus 5.5 at appropriate effort, commit, and confirm required checks pass. Run **one fresh Sol 6.1 high re-check limited to those fixes**, using a reviewer separate from the fixer. If it confirms a real problem, stop and escalate to the human dev. There is no third Opus review.

These Stage B fixes follow the sequence above. Unrelated head changes during either stage require restarting Stage A. Any unresolved high-severity issue blocks completion and goes to the human dev; never merge on that state.

## Ledger and completion

Before merging, record the ledger in the PR description or a comment. For **every round**, include model, effort, lens, reviewed head SHA, findings raised, dismissals with reasons, fixes with commit SHAs, and check results. Record the final required check status and head SHA, including after Stage B fixes and its final re-check when used.

The gate passes only when its required reviews and checks have passed and the ledger's final head SHA equals the current PR head. Check that equality before merging. A later head change voids the pass. A rebase or conflict resolution that `git range-diff` shows changes no behaviour needs a fresh Sol 6.1 high re-check of the delta and passing checks at the new head, in a new ledger segment. Any other change restarts Stage A at the new head against the original comparison base, then Stage B. Report blocked or escalated states explicitly.
