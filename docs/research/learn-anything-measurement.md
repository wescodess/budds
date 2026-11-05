# Measuring real learning in the Void

Date: 2026-11-04
Status: Proposed design for review; nothing here is implemented
Parent: [learn-anything-deep-dive.md](./learn-anything-deep-dive.md)

## The rule

Learning counts only when a learner does something **unassisted, later, on a case they have not seen**, and does it better than they could before.

The three conditions rule out the usual false positives. Assisted performance rose 48% and 127% in [Bastani 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/) while exam scores did not. Active learners learned more and felt they learned less in [Deslauriers 2019](https://pubmed.ncbi.nlm.nih.gov/31484770/), so satisfaction misleads in both directions. A repeated prompt measures memory of that prompt.

Completion, time spent, streaks, satisfaction and confidence are never reported as learning.

## How a gain gets measured

For each concept, the generator produces **measurement pairs**: two items testing the same capability at the same level with different surface details (Form A and Form B). They are stored separately from teaching material and never appear in a lesson or practice.

```
Cold attempt       Teaching and practice       Delayed checks
(Form A or B)  -->  (never uses either form) -->  (the other form, day 7, day 30)
```

- **Forms are assigned at random per learner.** Half get A first, half get B first. Generated items vary in difficulty, and this keeps that difference from reading as a gain or loss at cohort level.
- **Checks are test-only.** No teaching, hints or chat until the answer is submitted. Teaching can follow. This depends on fixing defect 1 in the deep dive; until then, nothing measured about retention is valid.
- **Prefer auto-gradable items.** Numeric, ordered and keyed answers don't depend on the LLM scorer. Rubric items are used where a capability needs written reasoning.
- **Answer keys are source-bound.** Under [ADR-0009](../adr/0009-allow-labelled-model-knowledge-as-a-teaching-tier.md), a concept with no accepted source can be taught but not measured or awarded mastery.
- **More than two forms are needed in the end**, since the ladder calls for several spaced checks. Start with pairs to prove the method, then extend to small item families.

## Metrics

**North star: Verified Learning Gain (VLG).** Across eligible concepts, the change in unassisted score between the cold attempt and the day-30 check on a new form. Report the day-7 version too, since it arrives sooner.

| Question | Metric | Why it matters |
| --- | --- | --- |
| Do people learn? | VLG at day 7 and 30 | The headline |
| Does it last? | Pass rate on new cases at 7 and 30 days; decline between them | The forgetting curve |
| Can they apply it? | Pass rate on transfer items versus near-identical items | Separates understanding from recall |
| Is the mastery gate honest? | **False mastery rate:** share of `Independent` concepts that fail the next delayed check | Tells us if the 80% gate is real |
| Is the gate too strict? | **False block rate:** share of blocked learners who pass a skip-ahead check | Finds wasted practice |
| Is it efficient? | Attempts and minutes per verified capability, by starting level | [Koedinger 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10068755/) gives a rough benchmark: about 7 opportunities, 13 for weak starters, 4 for strong |
| Does the learner model work? | Calibration and AUC predicting the next delayed result, against a plain per-concept average | If it can't beat the baseline, it shouldn't drive decisions |
| Do remediations work? | Pass rate on a new item after remediation | Tests defect 2's fix |
| Do learners know what they know? | Confidence versus result (Brier score) | Useful in itself, and it feeds the support layer |

**Guardrails, which can stop a rollout:** drop-off, delayed-check completion, reported T2 errors, accessibility completion, and all of the above split by starting level. The [UMD trial](https://edworkingpapers.com/ai26-1598) saw larger losses for first-generation students, and [Sierra Leone](https://storage.googleapis.com/deepmind-media/LearnLM/learnLM_sierraleone_may26.pdf) saw stronger-baseline students gain more, so averages can hide harm.

## Knowing the Void caused it

A learner can improve from another course, or from simply doing the cold attempt. So a gain alone isn't proof; it needs a comparison.

**Primary experiment: randomize at the milestone, within each learner.** Each learner's milestones are assigned to adaptive or fixed sequencing, with the outcome compared on delayed forms. Each learner acts as their own control, which needs far fewer people than comparing separate groups. Randomizing whole milestones, rather than concepts, limits spillover through prerequisites, though some carry-over will remain and should be checked.

This differs from the stack: #336's contract fixes the assignment unit to `authenticated_learner`. Learner-level assignment is simpler and cleaner, and also needs roughly several times more people. I'd support both and start with milestone level at small scale.

**Rough sample sizes,** from `n = 7.85 / d²` for a paired comparison at 80% power and 5% significance. This ignores clustering, so treat them as minimums:

| Effect to detect (paired) | Learners completing delayed checks |
| --- | --- |
| 0.5 | 31 |
| 0.3 | 87 |
| 0.2 | 196 |

The pilot manifest caps the cohort at 50 (`shared/adaptive-v2-pilot-policy.ts`). With everyone completing, that detects about 0.40; with half completing, about 0.56. For scale, the classroom trials in the evidence file range from 0.63 SD down to -0.37 SD, and tutoring overall sits at 0.37 SD. So 50 learners can catch a large effect or serious harm, not a modest gain. Plan for 100 to 200 before drawing fine conclusions.

## Threats, and what we do about each

| Threat | Response |
| --- | --- |
| Learner uses ChatGPT on a check | Can't be fully prevented without proctoring, and we won't proctor. Record paste and focus-loss **as flags on the attempt, not their content**, and report results with and without flagged attempts. Random assignment balances the rest. Never penalize a learner for a flag |
| Weak learners skip delayed checks | Report results among those attempting **and** among all eligible, with attempt rates. Lift the rate through scheduling and reminders. A high VLG on few check-takers isn't a win |
| The LLM scorer is wrong | See below. Pin the scorer version, and don't tell it whether an answer is before or after teaching |
| Forms aren't really equal | Monitor per-form pass rates and retire outliers. Counterbalancing protects the cohort numbers, so **per-learner gains are descriptive only** |
| Item quality on generated topics | Golden topics in the eval harness; retire items that everyone passes or fails |
| Testing effect | Cold attempts themselves aid learning. It's a feature of the product, and both arms get it |
| Novelty and selection | Early users are motivated. Don't extrapolate pilot results to everyone |

## Trusting the scorer

No evidence we found validates an 80% LLM rubric as a mastery gate, and today nothing measures it, so this comes first.

Decision (2026-11-04): grading is AI-only, with no human graders. Two AIs agreeing doesn't show either is right, since they can share blind spots, so the design relies on checks that don't depend on AI agreement:

1. **Seeded answers with known truth.** For each rubric, build responses from the source-bound answer key whose correct label is known by construction: correct, correct but paraphrased, partly correct, common misconception, plausible-sounding wrong, off-topic, and prompt-injection attempts. Measure the scorer against those labels.
2. **Independent AI graders.** Two models from different families, neither of them the production scorer, grade anonymized responses without seeing each other's output. Log disagreements and use them to find weak rubrics. Treat agreement as a consistency check only.
3. **Anchors outside the scorer.** Compare rubric results with the same learner's auto-graded items on the same concept, and with their later delayed results. These are the strongest validity signals available, and they build up with real use.
4. **Report errors by direction.** Passing someone who doesn't know the material is worse here than the reverse.
5. **Re-run on every scorer or model change.** Shadow-run alternatives through the existing `off | shadow | advisory` modes in `server/utils/learning-decisions/`.

Then set the threshold from data, using false mastery and false block rates, rather than keeping 80 by default. Treat any threshold as provisional, since no human has validated the seeded labels or the grading. If the anchors and the scorer diverge, add a human spot check.

## What the learner sees: Proof of learning

Measurement can double as the most motivating part of the product, without gamification. For any concept, show **their own cold answer next to their later unassisted answer**, with dates and what changed, plus a plain statement of what they've shown and when it was last checked.

It's honest because it's their real work, and it answers "am I actually learning?" better than any percentage. No per-learner gain number should be shown, because a single pair of items is too noisy for that.

## Reuse and build

**Reuse:** the append-only attempts ledger; `learnActivityEvents`, which already has `delayed_check_eligible`, `delayed_check_attempt`, `retained`, `representative_pass` and `remediation`; server-side scoring; version pinning.

**Land from the stack, and don't pause:** ALA 6.1, 6.2a and 6.2b (#271 to #273) and the analysis-plan work in ALA 3.7 (#253). They are the nearest existing thing, though the outcome metrics are synthetic-only with live adapters still `pending`. Treat `experiment_completion` and `experiment_usefulness` as secondary to VLG. I read these by diffstat and PR description, not by code review.

**New:**
- Item store with forms, level, answer key, source tier and exposure log, so a measurement item is provably never shown in teaching
- Measurement attempts as a distinct `masteryAttempts.kind`
- Experiment assignment at milestone level
- Attempt validity flags
- Scorer gold set and harness
- An internal dashboard with a versioned report, plus Proof of learning

## Build order

| # | Step | Result |
| --- | --- | --- |
| 1 | Test-only delayed checks, and store all responses | Retention data becomes valid |
| 2 | Scorer gold set and agreement report | We know how far to trust the score |
| 3 | Measurement pairs and exposure log, with counterbalancing | VLG exists |
| 4 | Dashboard and Proof of learning, first on the current flow | A **baseline before anything else changes** |
| 5 | Milestone-level experiment, with a pre-registered analysis plan | Adaptive sequencing gets a fair test |

Step 4 is the one to protect. Every later improvement is only provable against a baseline taken before it shipped. The first day-7 result arrives a week after learners start and day-30 a month after, so this needs to start early, ahead of the larger build.

## Limits of this design

The proposal is my own synthesis, and parts of it are untested on LLM-generated content: parallel-form equivalence is the weakest assumption, and the targets are working values. It can show that the Void caused learning, on the capabilities it tests, for the learners who took the checks. It cannot certify real-world competence, which stays out of scope under the V2 spec.
