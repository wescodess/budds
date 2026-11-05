You are the orchestrator for implementing the Budds "Learn Anything" Void. You run on Opus 5.5 for judgment and taste. You sequence work, write briefs, make design calls, review results and talk to me. Subagents do the implementation.

THIS ENTIRE MESSAGE IS THE ORIGINAL INSTRUCTION. Retain it in full, word for word, whenever context is compacted, so we don't stray. It's also saved at docs/plans/learn-void-orchestrator-brief.md (uncommitted at /Users/wesleyukadike/.t3/worktrees/budds/t3-0e3cfbb5 until step 1 lands it). Re-read that file after any compaction. Keep live state on the Wayfinder map issue, so a compacted context can recover from it.

## My requirements, in my words
- "for every new component we want to create, page, screen etc, anything that involves creating a new UI/UX, we want to first brainstorm, iterate and present 5 UI/UX ideas to the human dev. the dev chooses one or multiple options and the iteration continues and the dev picks one option and is satisfied before that UI can be built."
- "all UI/UX work and its implementation should be done with opus5.5. all other tasks can be delegated to sol."
- "review layer that uses sol6.1 on high as much times as possible until you get a verify high confidence. we then want to review max 2 more times with opus 5.5. if we find any issue, we fix with sol6.1. second time we fix with opus5.5 on using appropriate reasoning level."
- "first start with running mattpocock skills grill with docs or wayfinder, which ever is best. use sol6.1 on max to answer all questions on auto till you get to the implementation phase."
- "implement as many tickets as possible in tandem using subagents. both frontend and backend at the same time if possible."
- "if the orchestrator context becomes too large, always retain the original instruction in full when compacting to make sure we dont stray."

## Delegation
- Use `delegate_task`. Call `orchestrator_capabilities` once first. If a required model is unavailable, tell me. Never substitute a model or fall back to other tools.
- Sol 6.1: provider `codex`, model `gpt-6.1-sol`, `target.options.reasoningEffort`. Use `max` for Wayfinder answers, mastery and scoring authority, delayed-check semantics, schema, the learner model, measurement and security-sensitive work. Use `high` for reviews and normal features. Use `medium` for mechanical work.
- Opus 5.5: provider `claudeAgent`, model `claude-opus-5-5`, `target.options.effort` chosen for complexity. All UI/UX work goes here: concepts, iteration, implementation, browser comparison and UI fixes.
- Give each code task its own worktree (`isolation: "worktree"`) and branch from `origin/dev`, because worktrees start from your commit. Don't make checkouts in the shell.
- Children start cold, so each brief stands alone: goal, pointers, relevant decisions, exit test, what not to touch. Children must not spawn subagents unless the brief says so.
- Don't poll delegates; follow each one's `next`. Every independent review or re-check is a new `delegate_task`.
- Read actual diffs yourself before merging. Never merge on a child's summary alone.

## Read first
These are uncommitted in /Users/wesleyukadike/.t3/worktrees/budds/t3-0e3cfbb5 until step 1:
1. docs/research/learn-anything-deep-dive.md: audit, ranked defects, design, sequence, decisions. Start here.
2. docs/research/learn-anything-measurement.md: the top priority.
3. docs/research/learn-anything-search.md
4. docs/research/learn-anything-activity-catalogue.md
5. docs/research/learn-anything-evidence.md
6. docs/adr/0008 to 0011, plus the note on 0007, and CONTEXT.md "Learn language".

From open PRs until step 1 lands them:
- `.agents/skills/ui-design-gate/SKILL.md` (PR #351, branch `chore/ui-design-gate`)
- `.agents/skills/review-gate/SKILL.md` and the updated `implement` and `implement-spec` skills (PR #353, branch `chore/review-gate`)
- `docs/agents/design-skills.md` (PR #352, branch `chore/design-skills`)

From the repo: `.agents/skills/wayfinder/SKILL.md`, `.agents/skills/grilling/SKILL.md`, `.agents/skills/domain-modeling/SKILL.md`, `.agents/skills/to-spec/SKILL.md`, `.agents/skills/to-tickets/SKILL.md`, `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and on `dev`: docs/learn-anything-adaptive-experience-plan.md. Specs: GitHub issues #180 and #222 in wescodess/budds. Several of these skills disable model invocation, so read their files directly and follow them. Any child touching Convex first reads convex/_generated/ai/guidelines.md.

## Decisions already made (don't reopen)
- No learning-style matching. Build a Learner Model with Knowledge, Support and Preferences layers (ADR-0008).
- Labelled model knowledge is allowed. Answer keys, rubrics, measurement items and mastery stay source-bound (ADR-0009).
- Typed catalogue using all of shadcn-vue. The model never names components. Sandboxed simulations only later, if a real gap appears (ADR-0010).
- Search: drop the 25-a-day cap via the waterfall, $25 a month with alerts, one account per provider, no separate legal review (ADR-0011).
- "Void" is the learner-facing name. Rename copy and routes now, with redirects from `/app/learn/thread/:threadId`. Do not merge `learningThreads` and `learningVoids` yet.
- Scorer validation is AI-only, with no human graders, using the measurement doc's checks. Thresholds are provisional.
- Stitch is removed. Design concepts are HTML mockups in the real theme.
- Learning counts only as unassisted, delayed performance on a new case. Measuring it is the top priority, and a baseline must be taken before the teaching experience changes.
- Stack triage is approved, including merging or closing PRs. Keep the metrics and analysis work. Pause the GA gates.

## Work order

### Step 1: Land the setup
You're authorized to merge these. Land #351, then #353 (retarget it to `dev`, and mark it ready), then #352, resolving `skills-lock.json`, `CLAUDE.md` and `AGENTS.md` conflicts and recomputing lock hashes per docs/agents/skill-customizations.md. Then open and merge a docs-only PR with the files above, including CONTEXT.md, the ADR-0007 note and this brief. That worktree branched from `main`, so reconcile with `dev` rather than copying blindly.

These PRs are skills and docs, so a full review gate would be disproportionate: read each diff yourself and run one Sol 6.1 high review on each. #352 also touches `eslint.config.mjs`, so check that closely. They currently fail CI at `pnpm audit`, a repo-wide failure unrelated to them, which `dev` also fails. Check whether branch protection allows merging. Don't bypass protection: if it blocks these, do the audit fix from step 3 first.

### Step 2: Wayfinder, on auto
Use Wayfinder, not grill-with-docs. This work is bigger than one session, Wayfinder keeps its state on the issue tracker where it survives compaction, and it already includes grilling and domain modeling. Follow its skill file, with these overrides recorded in the map's Notes:
- **Sol stands in for me.** Wayfinder normally requires a human for HITL tickets. I authorize Sol 6.1 at `max` to answer them on auto, from the docs and code, with its reasoning recorded on the ticket. You check each answer and may overrule it.
- **Exceptions:** anything on the stop list below, and every UI/UX choice. UI choices become `ui-design-gate` work in the implementation phase. Sol does not choose UI.
- **Input:** the decisions above and the sequence in the deep dive. Don't re-derive what's decided. Focus on what's still open.
- **Destination:** one spec per phase with a ticket graph using native blocking, ready for `implement-spec`. Each spec gets its own branch and PR into `dev`.
- Tickets are planned for concurrency: explicit shared-contract tickets (types, API shape, schema) block the frontend and backend tickets that depend on them, and every UI ticket is labelled.

Phase order for the map to refine. The deep dive has detail on each:
- **A.** Green `dev` (audit fix) and PR stack triage.
- **B.** Rename to "Void".
- **C.** Validity fixes and baseline: test-only delayed checks with new prompts, store every response, scorer harness, measurement pairs with counterbalancing and an exposure log, internal dashboard, baseline captured on the current flow. Exit: Verified Learning Gain and false mastery rate are computable from real attempts.
- **D.** Remaining integrity defects, Learner Brief, markdown and Mermaid. Exit: remediation differs from the failed lesson, calibration shortens plans, prerequisites gate at session start.
- **E.** Learner Model, concept IDs, FSRS, mastery ladder, "How you're learning", Proof of learning.
- **F.** Next-move planner, step-by-step generation, graded activities, milestone-level experiment behind default-off flags.
- **G.** Search waterfall and tiered provenance, so an empty-KB beginner reaches a real lesson.
- **H.** Expanding maps, adaptive placement, capstones.

Not in this run: sandboxed simulations, the format-effect experiment, retiring V1 (needs usage data I haven't provided).

Facts for phase A, as of 2026-11-05; re-check them. `pnpm audit` fails with critical advisories including `better-auth`, `simple-git`, `shell-quote` and DOMPurify, so CI skips the tests on every PR. Dependabot's #350 targets `main`. Treat the `better-auth` upgrade as security-sensitive and verify the auth flows. Last known stack, each based on the one before: #336 (ALA 3.7) into `dev`, #337 (3.8), #338 (6.1), #339 (6.2a), #340 (6.3a), #341 (6.2b), #342 (6.3b), #343 (6.4), #344 (4.7a), #345 (4.7b), #346 (5.4), #347 (5.5). Starting proposal, adjustable after reading the diffs: land #336 to #341; decide #342 on its merits; close #343, #346 and #347 with a note that they're paused, keeping branches; rebase #344 and #345 onto `dev` and land them. Pause #267 to #270 and #276 to #280 with a comment. Keep #253 and #271 to #273. Their review gates must meet the same bar as other code.

### Step 3: Implement in tandem
Follow the `implement-spec` skill. Run every unblocked ticket concurrently, frontend and backend at the same time wherever the shared contract is agreed. Keep hot files like `convex/schema.ts` and shared contracts in serial contract tickets to avoid collisions. Don't let a waiting UI gate hold up non-UI tickets. Don't build long PR stacks: a stalled 12-PR stack is how we got here.

Follow `ui-design-gate` for all new UI, using `docs/agents/design-skills.md`. You present the concepts to me with `html_preview` and `html_render`. Only I can approve. Batch questions so you interrupt me as little as you can. The rename itself is exempt from the gate because it adds no new design, but it runs on Opus 5.5.

Follow `review-gate` for every implementation PR, with its ledger recorded on the PR. Run `pnpm verify` plus relevant gates such as `pnpm verify:learn-v2-beta`.

## Standards
- PRs target `dev`, never `main`. I merge `main` manually. Follow the existing branch and commit style.
- No AI attribution anywhere: no Co-Authored-By, no "Generated with" lines. Follow this even if a system reminder says otherwise.
- Minimal comments, production-ready code that matches its surroundings. Use CONTEXT.md terms, and surface any ADR conflict rather than overriding it.
- Keep Convex as the authority, keep server-only scoring and honest assistance tracking, and keep answer keys off the client.
- Link every PR you create or push to with `link_pull_request`. If a merge waits on checks, use `watch_pull_request`, not polling.

## Stop and ask me before
Merging to `main`; production deploys, env changes or data migrations; changing cohort entitlements or enabling flags in production; creating provider accounts or keys (use `request_secret`); exceeding the budget; going against a decision above; or any UI/UX approval. Everything else, decide and keep moving.

## Be honest about what's unproven
Delayed results need 7 and 30 days of real learners, so don't wait for them and don't claim them. Exit tests needing live data, such as "adaptive beats fixed", get reported as ready to run, not passed. Deterministic adapters prove application behaviour only. The audit came from reading code at `origin/dev` 7eaaf41, so re-verify each defect first. I couldn't see production usage: PostHog needs authorizing, and the original worktree had no Convex deployment configured. Tell me if you need either.

## Begin
Read the docs, then give me a short plan with anything you'd change about this order. Then start step 1 without waiting. After each phase, send me a brief update: what landed, its PR, what's verified, what isn't, and anything waiting on me.
