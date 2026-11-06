# Design Climb

A climb checks or improves one UI surface in budgeted rounds: automated checks, independent judges, fixes. It gives the human dev evidence. Approval stays with the human dev under [ui-design-gate](../../.agents/skills/ui-design-gate/SKILL.md).

Scores are a signal, never the definition of good. In t3code, every judge rated every category 9.5 or higher on [#24865](https://github.com/pingdotgg/t3code/pull/24865), and the follow-up [#25251](https://github.com/pingdotgg/t3code/pull/25251) opens by saying it "went too far toward grayscale". That follow-up ended at 10/10 from all three judges, and about an hour later [#25323](https://github.com/pingdotgg/t3code/pull/25323) fixed sent messages that were "hard to see".

The orchestrator runs the climb, triages findings and talks to the human dev. An agent without `delegate_task` hands the climb back to the orchestrator.

## Fixed rules

- `DESIGN.md` wins. Palette and fonts are locked. A finding that needs a new token or rule goes to the human dev, never into code.
- Opus 5.5 does all UI design, implementation and fixes. Sol 6.1 only judges screenshots, read-only.
- Judge output is never approval, whatever it scores.
- Reference screenshots of NotebookLM and ChatGPT study mode live in the private Cloudflare R2 bucket `budds-design-anchors`, under `<product>/`, with a README per product. They are kept only while a run needs them and deleted when it ends; capture them again for the next run. Judges download each one with `wrangler r2 object get budds-design-anchors/<product>/<file> --remote --file <temporary-folder>/<file>` and delete it after their round. They never stay on a local disk. This repository is public, so they stay out of git, PRs, issues, candidates and taste cases.

## Modes

| Mode | When | Judged against | What may change | Budget |
|---|---|---|---|---|
| **Concept check** | Before the gate presents any round of options, while the human dev is still choosing a direction | Nothing: each option alone | Defects only, keeping each option's layout, hierarchy and interaction | One pass |
| **Fidelity** | The gate's "Check the build", after approval | `approved.html` as the target, the first build as the baseline | Only what brings the build closer to `approved.html` | 3 rounds |
| **Revamp** | Rework of an existing surface, once the human dev has narrowed to one direction in the gate | The current surface as the baseline, plus references | Anything within `DESIGN.md`, in HTML only until approved | 5 rounds |

Terms used below:

- **Run:** one climb on one candidate.
- **Round:** one commit judged, at most once by each judge.
- **Candidate:** the version being improved.
- **Baseline:** the unchanged version it must beat.
- **Noise:** how far a judge's score moves on an unchanged set.

## Commands

| Command | Use |
|---|---|
| `pnpm design:ratchet` | Source checks against `docs/design/ratchet-baseline.json`. |
| `pnpm design:capture <surface>` | Captures `docs/design/surfaces/<surface>.json` to `.design-captures/<surface>/<short-sha>/`, with PNGs, `manifest.json` and `floor.json`. |
| `pnpm design:capture <surface> --compare <dir>` | Same, failing on violations new against that earlier capture or on any of its captures missing from this run. |

Commit before every capture, because the output folder is named by commit. A missing command is a blocker to report, not a step to skip.

**Automated checks are green** when all of these hold:

1. `pnpm design:ratchet` passes, if `app/` changed. Follow its output if it is red.
2. The capture has no new violation. Use `--compare` with this surface's baseline capture. In fidelity, on a surface that existed before the branch, compare with its capture at the branch's base commit so existing debt does not block. With no such capture, run the plain command and treat any violation in `floor.json` as red.

Fix red checks with Opus before spending judges. This does not use a round. If the same failure survives two fix attempts, stop and label the run inconclusive.

## Prepare a run

1. **Surface.** Use the existing definition, or add `docs/design/surfaces/<surface>.json` modelled on one already there. Cover every state the change touches, including loading, empty, error, both themes, mobile and worst-case data from `break-ui`. Each HTML option is its own surface, `<slug>-<name>`.
2. **HTML.** Keep options self-contained in `docs/design/<slug>/`, committed on the working branch, with no reference images embedded. When the decision is recorded, delete the surface definitions of options that were not chosen.
3. **Baseline.** Revamp: capture the current surface. Fidelity: capture the first build, and capture `approved.html` as the target.
4. **References, revamp only.** Choose the screens in `budds-design-anchors` closest to this surface's job. If there are none, ask the human dev for them or run without them and say so in the ledger. Fidelity runs use none.
5. **Freeze** judges, efforts, rubric and references, and record them in the [ledger](#ledger). Rubric changes move scores: t3code judges fell from 10/10 to 9/9/9.5 when [#25251](https://github.com/pingdotgg/t3code/pull/25251) added four categories and two deferred items. Changing any of these starts a new run.

## Judge setup

Call `orchestrator_capabilities` once before the first delegation. Report an unavailable model as a blocker and never substitute another. Every score is a new `delegate_task` with fresh context, the default shared checkout and a neutral title such as `design judge`. Send no round number, target score, earlier scores, findings or dismissals.

| Judge | `target` | `role` |
|---|---|---|
| Sol | `{ providerInstanceId: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "high" } }` | `review` |
| Opus | `{ providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "high" } }` | `review` |

`delegate_task` has no read-only mode, so the prompt carries the constraint. After each judge returns, confirm `git status --porcelain` is unchanged and discard the result if it is not.

**Blind the images.** For each judge, make a new `mktemp -d` folder outside the repository and copy in PNGs only, leaving out `manifest.json`, `floor.json` and SHA-named paths:

- Put each version in its own folder with a freshly shuffled letter (`A`, `B`, `C`).
- Keep file names the same across versions so screens pair up. If names do not show state, theme and viewport, rename them from `manifest.json`. Rename reference files to plain numbers.
- In fidelity, name the `approved.html` capture's folder `TARGET`.
- Keep the key to yourself until the judge returns, then write true names in the ledger.

Masking is only partial. Two versions of one app are recognisable, other products are obvious, and a judge in the shared checkout could look further than it is told to. Treat scores accordingly.

## Judge prompt

Paste the common block, then one task block, with `<repo>` and `<judge folder>` as absolute paths. The rubric is this text at the commit recorded in the ledger.

### Common block

```text
You are an independent UI design judge for Budds, a study companion for learners. You are read-only: change nothing, and run no git, build or capture commands. Read only the files named here.

Read first:
- <repo>/DESIGN.md. It wins over your own taste. Palette and fonts are locked.
- The "Anti-slop checklist" section of <repo>/docs/agents/design-skills.md.

Images are in <judge folder>, one folder per label. File names give the state, theme and viewport. Folders hold full frames and 1:1 crops. Open the images themselves. If you cannot open them, say so and return nothing else.

Rubric:
1. Typography
2. Hierarchy
3. Spacing and density
4. Color and contrast
5. Iconography
6. Consistency and polish
7. Clarity
8. Budds lines:
   - One thing leads the screen, and it is the learning content.
   - With the name removed, it reads as a study companion, not a SaaS template.
   - The Void holds only content and input.
   - Color still carries meaning. Actions, active states, focus, citations, success, warning and error stay distinct at a glance. Treat neutral gray replacing meaningful color as a defect, however calm it looks.
   - Amber marks only actions, active states, focus and citations, with one filled primary action per view.
   - Adjacent surfaces such as cards, messages and inputs stay visibly separate in both themes.
   - Citations are prominent.
   - Loading, empty, error and disabled states are present and useful where captured.
   - Long titles, a count of 1 and a 320px width hold up where captured.
   - Copy uses plain verbs and sentence case.

Evidence:
- Before docking clipping, blur, misalignment, hairlines, small text or anything else scaling could cause, open the 1:1 crop and cite it. If no crop shows the problem, report it as unconfirmed and do not dock for it.
- A finding needs a concrete failure: what a learner cannot read, find or do, or which written rule it breaks. A preference is not a finding.
- High severity: a learner cannot read, find or use something on the screen's main path, meaning is lost, or a written DESIGN.md or checklist rule is broken. Medium: a concrete weakness that does not block. Low: polish.
- If fixing a finding needs a new token or rule, say so.

Each finding: id, label, severity, category, screenshot and crop paths, concrete failure, confidence (high, medium or low), needs new token or rule (yes or no).
```

### Task: comparison, for revamp

```text
Task: judge every label independently. Some labels may be other products, included as context. Score a label that is clearly not Budds on categories 1 to 7 only, and raise no findings against it.

Return:
1. Ranking of all labels, best first, with one sentence of reasoning.
2. A table of per-category scores out of 10, to one decimal, for each label, with overall as the unweighted mean.
3. Findings.
```

### Task: comparison, for fidelity

```text
Task: TARGET is the design the human approved. Judge every other label on how well it delivers TARGET. Add category 9, "Fidelity to TARGET". Do not score TARGET or raise findings against it. If you would change TARGET itself, list that separately as an objection.

Return:
1. Ranking of the other labels, best first, with one sentence of reasoning.
2. A table of per-category scores out of 10, to one decimal, for each label, with overall as the unweighted mean.
3. Findings.
```

### Task: concept critique

```text
Task: critique this one option on its own terms. You will not see any alternative. Give no scores and no ranking.

Return:
1. One line per category on how it holds up.
2. Findings. Mark any finding whose fix would change the option's layout, hierarchy or interaction as "changes concept".
```

## Concept check

Concepts are never ranked against each other, so five concepts stay different.

1. Commit the options. Run the automated checks on each surface.
2. Blind each option into its own folder. Run one fresh Sol judge per option with the concept critique task.
3. Triage each option's findings against `DESIGN.md`. Opus fixes confirmed defects, seeing only that option's findings. Findings marked "changes concept" are not fixed; they go to the human dev as objections. Rerun automated checks after fixes. There is no second critique.
4. Write the gate's recommendation from design reasoning, not from counting findings.
5. Follow [Presentation](#presentation).

Done when every option has green checks and one critique in the ledger. A concept check has no passed result. It is labelled inconclusive only if an automated failure survives two fix attempts.

## Fidelity and revamp rounds

Measure noise once, before the first round that compares a candidate with a baseline. A fidelity first build has no such comparison, so start at step 2 and measure noise only if it needs a fix.

1. **Noise.** For each judge, score the unchanged baseline set three times, fresh and reshuffled each time. The set is the baseline plus references in a revamp, and the baseline plus `TARGET` in fidelity. That judge's noise is the highest overall minus the lowest for the baseline. A change smaller than that spread does not count. Three runs give a rough floor, not a confidence interval. Reuse the figure only for the same surface, judge, effort, rubric and references.
2. **Commit** the candidate. Run the automated checks until green.
3. **Sol** judges the commit.
4. **Triage** every finding yourself against the screenshots, the 1:1 crops and `DESIGN.md`:
   - Dismiss with a reason: a scaling artefact, a preference, a contradiction of `DESIGN.md`, or in fidelity a request to differ from `approved.html`.
   - Send to the human dev: a finding that needs a new token or rule, or a real problem with `approved.html`.
   - Otherwise confirm it for fixing.
5. **Opus** judges the same commit only if, after triage, Sol's result meets the [stop rule](#stop-rule) on its own. Triage its findings the same way. Each round therefore costs one judge until Sol is satisfied.
6. **Stop** if the stop rule is met for every judge.
7. **Fix** confirmed findings with a fresh Opus delegate: `claudeAgent`, `claude-opus-5-5`. Give it the findings, `DESIGN.md`, the surface, and `approved.html` in fidelity. Revamp fixes stay in HTML. Return to step 2 for the next round.

Update the ledger after every round.

## Stop rule

**Passed** at a commit when all of these hold there:

- Automated checks are green.
- No high-severity finding is open.
- For each judge, candidate overall minus baseline overall in the same response exceeds that judge's noise.

In fidelity, a first build with green checks and no high-severity finding from either judge also passes, because no fix has created anything to compare.

**Inconclusive** when the budget runs out, when an open high-severity finding needs the human dev's decision, when no confirmed finding is left to fix but the candidate has not beaten the baseline, or when an automated failure survives two fix attempts. It still goes to the human dev, labelled so and with open findings listed. Apply no fix after the last judged round, because unjudged work never reaches the human dev.

Always:

- No re-scoring an unchanged commit. A bad score stands. Rerun only a judge that returned nothing, and record the rerun. Noise runs are the one exception.
- No absolute score target. [#24865](https://github.com/pingdotgg/t3code/pull/24865) spent 10 of its 18 rounds going from 9.0 past 9.5, and [#25251](https://github.com/pingdotgg/t3code/pull/25251) still had to bring color back.
- References are context, not a bar each judge must clear. A candidate can score below them and pass.
- Differences from `approved.html` still open at stop go to the human dev, as the gate's "Check the build" requires.

A change the human dev asks for starts a new run with a fresh budget.

## Presentation

Every mode ends here. A climb result is a candidate to show, never approval.

1. **Clean render first.** HTML goes through `html_preview` then `html_render`, or as absolute file paths outside T3 Code. A build goes as a running route or unmarked PNGs. Show no marks, scores or judge text. The gate's name, idea, trade-offs and recommendation may go with concepts. Ask for a reaction and record the exact words before showing anything else.
2. **Then the evidence.** Annotated before/after tied to finding IDs, judges' objections including those you dismissed, scores with noise, and the label `passed` or `inconclusive` where one applies. Show references to the human dev only outside git, PRs and issues.
3. **Then the human dev's decision,** under the gate's rules. Log any correction in [misses.md](misses.md).

## Ledger

Keep one per run, in the PR, or in the ticket when there is no PR yet. Write true names, not labels. Put per-category scores in a `<details>` block under the table.

```markdown
### Design Climb: <surface>, <mode>

- Baseline: <commit>
- Target: docs/design/<slug>/approved.html | none
- Rubric: docs/design/climb.md at <commit>
- References: <file names> | none
- Noise: Sol <spread> (<a>, <b>, <c>); Opus <spread> (<a>, <b>, <c>) | not needed

| Round | Judge | Model | Effort | Commit | Scores | Findings | Dismissals |
|---|---|---|---|---|---|---|---|
| noise 1 | Sol | gpt-6.1-sol | high | <sha> | baseline <n> | - | - |
| 1 | Sol | gpt-6.1-sol | high | <sha> | candidate <n>, baseline <n>, <reference> <n> | F1 high: <failure> | F2: <reason> |

- Automated checks at final commit: ratchet <result>; capture <result>
- Result: passed | inconclusive (<reason>) at <commit>
- Human reaction: "<exact words>"
- Accepted at first presentation: yes | no
- Rounds to approval: <n>
- Tokens, if reported: <n>
```

Concept checks use the same table, with `-` under Scores. If a reference's overall moves by more than that judge's noise between rounds, note the drift: the judge's scale moved, not only the candidate.

## Relation to review-gate

The climb runs before [review-gate](../../.agents/skills/review-gate/SKILL.md) and never replaces it. A passing score does not satisfy any part of that gate, and climb judges do not count as its review rounds. If a review-gate fix changes rendered output, rerun the automated checks at the new head. A material design change returns through `ui-design-gate`.
