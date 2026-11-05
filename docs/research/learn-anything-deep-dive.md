# Learn Anything deep dive

Date: 2026-11-04
Status: Audit and recommendation; no implementation has changed
Evidence: [learn-anything-evidence.md](./learn-anything-evidence.md), with sources and strength ratings for every research claim below

Line references point at `origin/dev` (7eaaf41), not `main`, unless stated otherwise. This checkout is on `main`, so read them with `git show origin/dev:<path>`.

## Verdict

Budds has built an excellent system of record for learning and has not yet built the learning loop.

Evidence integrity, revision pinning, server scoring, recovery and deletion are strong, and most of that work should stay. The gap is that **nothing a learner does reaches the model that writes the next lesson.** The generator receives one objective and some source excerpts. It does not get the learner's goal, earlier answers, misconceptions, calibration or preferences, and it is not told whether it is writing a first lesson, a remediation or a delayed check.

So the feature records adaptive-looking data and then generates the same kind of lesson for everyone. About 31,000 non-test lines exist across three data planes, and the loop that would make them adaptive has not been wired up.

The vision is achievable on this stack with two changes to it:

1. **Replace "learning style" with a learner model built on demonstrated knowledge.** Matching instruction to a preferred style is one of the better-tested failures in education research. The experience you want, a system that knows how you learn and adapts as you improve, can be delivered honestly through other signals.
2. **Allow model knowledge as a labelled teaching tier.** "Learn anything" cannot work while every sentence needs an accepted source. A beginner with an empty folder currently gets nothing.

## Where the feature stands

| Plane | Lines (non-test) | State | What it is |
| --- | --- | --- | --- |
| V1 courses | about 6,450 | On `main`; I found no V2-style gate | Generated sections with markdown, Mermaid, quizzes, flashcards, audio, SM-2 review, streaks and offline retakes |
| V2 missions | about 15,220 | On `main`, behind `LEARN_V2_ENABLED` and a per-user entitlement | Evidence desk, capability map, calibration, study plan, 10-block plain-text session, mastery ledger |
| Adaptive threads | about 9,140 | **Only on `dev`**, behind a second entitlement | Need-first home, intent chips, thread resume, canvas with 7 primitives, pure router, memory drawer |

Delivery state:

- `dev` is 142 commits ahead of `main`. Its last commit is from 2026-09-29.
- A stack of 12 PRs (#336 to #347) sits on `dev`, last touched 2026-10-04. #336 currently fails `Lint, typecheck, and dependency audit` and `CI gate`.
- 21 of the 58 ALA tickets are open. They are mostly rollback, audit, metrics and soak gates. **None adds generation or a learner model.**
- `ADAPTIVE_V2_PILOT_MANIFEST` has `pilotApproved: false`, an empty cohort and no model policies (`shared/adaptive-v2-pilot-policy.ts:1`).

Spec #222 already diagnosed the V2 journey correctly: it "exposes that governance pipeline before delivering value." Its thread-first home, intent model, "Why this?" controls and typed primitives are sound. But it deferred content generation and learner modelling (`ADAPTIVE_PROVIDER_ACTIONS = 'v2_wrapped_only_standalone_deferred'`, `convex/lib/adaptiveLearnAccess.ts`), and those are the parts your vision depends on most. No `convex/learnAdaptive*` file calls a model, on `dev` or at the stack tip.

## Vision against reality

| Your vision | Today | Gap |
| --- | --- | --- |
| Learn anything from the KB and web | Only what accepted sources support. Web search is capped at 25 per day across the whole product, 4 per user, 2 broad per void (`shared/learn-v2-contract.ts:466`) | Evidence rule and quota |
| Knows the user's learning style | Nothing in `main`. `dev` stores free-text `representation`, `pace`, `practice_style` per thread, and only memory, export and deletion code read them. The router has no preference input (`shared/learn-adaptive-router.ts:9`) | No learner model |
| Updates as they progress | State is per objective per blueprint revision. Nothing crosses topics or changes teaching | No feedback path |
| Dynamic content | V2 prints plain text (`TodaySession.vue:279`). V1 is richer than V2. `dev` has typed primitives, but server code builds only 3 of the 7 | Catalogue not populated |
| Full understanding before progress | One LLM rubric score at 80% on one prompt. No prerequisite check at session start | Weak and ungated |
| Beginner to mastery | A fixed map of 6 to 15 objectives; states end at one 7-day check | Map and ladder too small |

## Defects worth fixing regardless of direction

Ranked by damage to what the product claims. These are read from code; I did not run them.

1. **"Retained" is not a clean delayed test.** The session player and canvas never branch on `placementKind`, and the generator is not told a session is a delayed check. The learner goes through the same flow, including the explanation, before the "delayed unassisted" attempt. Nothing makes the transfer prompt differ from the first one (`TodaySession.vue`, `ReadySessionCanvas.vue` and `learnAdaptiveCanvas.ts` have zero references). This undermines the feature's central promise.
2. **The generator is blind to the learner.** Input is `objective` plus `sources` at temperature 0 (`convex/learnV2SessionContent.ts:945`, `:968`). Remediation after a failure receives the same input as the lesson that just failed. Misconception tags are stored and never fed back. Retrieval objectives are loaded in `inputs()` and not passed on, so the "retrieval" block cannot actually target earlier objectives.
3. **Most learner responses are thrown away.** Only `transferResponse` is submitted (`TodaySession.vue:199`). Prediction, faded practice and teach-back are required to continue, then discarded (`:104`, `:105`, `:107`). They receive no feedback and never reach the scorer.
4. **Retrieval practice involves no retrieving.** The retrieval phase has no input, so the learner reads a prompt and clicks continue (`:102`). Retrieval is the best-evidenced technique in the design.
5. **The worked example is a penalty, and faded practice has no problem.** The worked example only appears through a reveal that caps the attempt at `guided` (`convex/learnV2SessionContent.ts:1464`, `convex/learnV2Mastery.ts:938`). The fading phase shows a hard-coded instruction instead of the faded block (`TodaySession.vue:88`), and using that block counts as a hint. Novices benefit most from examples, and this path taxes them for it.
6. **Calibration can't shorten anything.** A pass writes `schedulingPriority: 'deprioritized'` (`convex/learnV2MapCalibration.ts:438`), but the planner only checks for `'remediation'` (`convex/learnV2Plans.ts:105`). The spec promises calibration can shorten the plan. A knowledgeable learner still sits through everything.
7. **Nothing gates on prerequisites at start time.** Prerequisites order the schedule, and Today ranks remediation higher, but I found no check that blocks starting a dependent objective after a failure. This is the direct gap against "fully understands before making progress."
8. **Grounding is narrower than it looks.** The verifier checks claim and excerpt pairs (`convex/learnV2SessionContent.ts:1041`). I found no check that a block's prose is limited to its listed claims, so unsupported text can be published inside a verified block. Meanwhile one failed pair below 0.8 confidence fails the whole session, and every block must carry a claim, including `objective` (`shared/learn-v2-session-content.ts:115`).
9. **Two generated blocks are never shown.** `misconception_feedback` and `next_review` are generated and verified, then never rendered (`TodaySession.vue:87`). The first is also written before the learner has said anything, so it cannot address their actual misconception.
10. **The router recommends activities nothing can build.** Server code builds `artifact_workspace`, `cited_explanation` and `diagnostic_prompt` (`convex/learnAdaptive.ts:300`, `convex/learnAdaptiveCanvas.ts:174`, `convex/learnAdaptiveRecovery.ts:92`). The router's main remediation answer is `worked_example` (`shared/learn-adaptive-router.ts:188`), which I could not find a builder for. A brand-new thread with no V2 mission gets a fixed non-factual prompt: "What outcome would make this first step useful?" (`shared/learn-adaptive-clarification.ts:62`). It cannot teach.
11. **A map can't grow.** Limits of 6 to 15 objectives and 3 to 6 milestones (`shared/learn-v2-blueprint.ts:5`) sit alongside separate read caps of 8 milestones and 16 objectives that throw (`convex/learnV2Journey.ts:10`).

One correction to our own notes: V1's section generation also takes no performance signal (`server/api/course/generate-section.post.ts:158`), despite the original intent that just-in-time sections would adapt to it.

## What the evidence changes

Full sources are in the evidence file. I spot-checked the three findings carrying the most weight against the papers.

**Learning styles do not hold up.** The latest meta-analysis found crossover support in about 26% of outcomes (11 of 42), and its authors judge the benefit too small and infrequent to adopt ([Clinton-Lisell & Litzinger 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11270031/)). Preference predicts how much people feel they learned, not how much they recall ([Knoll 2017](https://pubmed.ncbi.nlm.nih.gov/27620075/)). Building your vision literally would mean shipping a feature that feels personal and teaches no better.

**Prior knowledge is what to adapt to.** Support that helps novices can hurt advanced learners ([Kalyuga 2007](https://eric.ed.gov/?id=EJ785056)). Across 27 datasets, learning rates were strikingly similar while starting points differed: about 7 practice opportunities to reach 80% for a typical learner, about 13 for the lower half on initial knowledge and about 4 for the upper half ([Koedinger 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10068755/)). This means "beginner to mastery" is mostly a question of how much practice each learner gets per concept, which a fixed 25-minute session can't vary.

**Grounding protects accuracy, not learning.** A randomized trial of a tutor using RAG on instructor-selected materials (2,379 students) found grades 0.27 to 0.37 SD lower ([Liu et al. 2026](https://edworkingpapers.com/ai26-1598)). That is a working paper; only about 15% of treated students used the tutor and most instructors stayed in direct-instruction mode, so read it as a warning about open chat, not a verdict on tutors. Budds should not treat its evidence pipeline as the safeguard for learning.

**Structure has to live in code.** Bastani's unassisted exam scores fell 17% with plain GPT and were unchanged with a hint-only tutor ([Bastani 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/)). The Harvard trial with positive results used verified solutions and software-enforced sequence, noting that a system prompt "could not reliably provide enough structure" ([Kestin 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)). This supports Budds' architecture and argues against a chat-first design. Many positive trials also kept a human involved, so **a solo adult product cannot assume their effects and must measure its own.**

**One 7-day check is too thin.** The strongest prescriptive evidence is 3 correct recalls followed by 3 widely spaced relearning sessions ([Rawson & Dunlosky 2011](https://pubmed.ncbi.nlm.nih.gov/21707204/)), though on concept recall rather than transfer. Nothing I found validates an 80% LLM-scored rubric as a mastery gate.

**Interactive formats help when tied to the objective.** Simulations are well supported ([Chernikova 2020](https://eric.ed.gov/?id=EJ1259299)), multiple representations often fail without alignment ([Ainsworth 2006](https://doi.org/10.1016/j.learninstruc.2006.03.001)), and irrelevant visuals hurt ([Sundararajan & Adesope 2020](https://eric.ed.gov/?id=EJ1263249)). We found no controlled evidence that LLM-generated interactive UI improves learning.

## Recommended design

Keep Convex as the authority and add the missing loop:

```
Goal + KB + web
      |
      v
Placement --> Learner model <------------------------+
                  |                                  |
                  v                                  |
          Next-move planner (pure, explainable)      |
                  |                                  |
                  v                                  |
          Step generator (given a Learner Brief)     |
                  |                                  |
                  v                                  |
          Typed activity (rendered, server-graded)   |
                  |                                  |
                  v                                  |
          Attempt ledger (every response) -----------+
                  |
                  v
          Spaced, unassisted, novel checks --> Mastery
```

### 1. Learner model: this is your "learning style"

A cross-topic model the learner can see and edit, with three distinct layers:

| Layer | Contents | Updated by | Can change mastery? |
| --- | --- | --- | --- |
| **Knowledge** | Per-concept estimate and memory stability | Unassisted attempts only | Yes |
| **Support** | Per-concept support level; confidence calibration; misconceptions | Attempts, assistance use, confidence versus result | No |
| **Preferences** | Interests for examples, format, pace, time, language, accessibility | The learner, explicitly | No |

Use a transparent per-concept Bayesian or Elo-style estimate with LLM difficulty priors, plus default-parameter FSRS as the review clock. Skip deep knowledge tracing, because Budds' generated topics will have sparse data. Run LLM judgments in shadow against delayed performance; the `off | shadow | advisory` modes in `server/utils/learning-decisions/` already fit this.

This needs **stable concept IDs** that outlive blueprint revisions, which `docs/research/laya-jev-product-strategy.md` already proposes. Without them, knowledge cannot carry between topics.

The learner-facing surface is a "How you're learning" page: what you know and why Budds thinks so, where you need more support, what you tend to get wrong, the interests used in your examples, and controls for all of it. It delivers the feeling you described without claiming a type.

Format choice follows a fixed order: the content picks the default, knowledge state sets the support, preference breaks ties. A preference can never skip retrieval. "Budds learns which format works for you" stays an experiment, judged only on delayed unassisted results, and off until the data supports it.

### 2. Learner Brief: the highest-value single change

A deterministic, bounded summary passed to every generator: goal and mode, known and shaky prerequisites, recent errors, support level, interests for examples, this step's purpose, and prompts already used on this concept. This closes defect 2 and gives the existing pipeline real personalization for little code.

### 3. Next-move planner, not a fixed loop

Extend the pure router on `dev`, which is the right shape. Replace the 10-block session with steps sequenced from learner state:

| Learner state | Sequence |
| --- | --- |
| New to concept | Worked example, faded example, try it, explanation of the why |
| Some knowledge | Cold attempt, then teach only if it fails, then practice |
| Strong | Challenge first; skip teaching |
| Failed attempt | A different explanation aimed at the specific error, then a new item |
| Refresh | Retrieval only |
| Delayed check | **Test only, with a new case. Teaching comes after** |

Generate and grade step by step, and continue until the criterion is met rather than until the clock runs out. Studying an example before an attempt should not count as assistance; only help during an attempt should. Prefetch the next likely steps so latency stays low. Keep every step under the existing lease and idempotency job pattern.

### 4. Typed activity catalogue

Follow #222 here. The evidence supports its allowlisted grammar for anything graded. Add primitives by reusing what exists first:

- **Reuse now:** markdown and Mermaid (`@nuxtjs/mdc`, `mermaid` are already dependencies), V1 quiz, flashcard and audio blocks.
- **Add next:** answer-gated retrieval, misconception-based multiple choice, cloze, ordering, math, compare table, scenario branch, timeline, concept map, code exercise.

Every primitive declares the objective it serves, a bounded schema, a server grading rule and a text fallback. [Khan's Perseus](https://github.com/Khan/perseus) is a good schema reference.

Generated simulations come later and stay outside grading: a separate origin with no cookies, a strict CSP, no state writes, following the [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) sandbox pattern. Hold this until the catalogue has shown where it falls short.

### 5. Tiered provenance

| Tier | Origin | Allowed for | Learner sees |
| --- | --- | --- | --- |
| T0 | Accepted source, entailment checked | Claims, rubrics, answer keys | Citation |
| T1 | Fetched web, not accepted | Attributed teaching; can be promoted to T0 | "From the web" |
| T2 | Model knowledge | Analogies, examples, prerequisite bridges, practice prompts | "Not source-checked" |
| Blocked | Model knowledge | Answer keys, rubrics, high-stakes facts | Request for a source |

A beginner can start immediately, evidence becomes a quality upgrade rather than an entry fee, and "verified" keeps its meaning. This is a proposal: we found no production system documenting learner-facing tiers. Measure the T2 error rate directly. Mastery-grade assessment should remain T0, and if a topic has no source for one, the product should say so rather than award mastery. Also close the block-versus-claim gap from defect 8, or the labels won't be trustworthy.

For the web, the free-first routing order stays, but a product-wide cap of 25 searches a day cannot support open use. Budget real search spend, and cache public evidence across users by canonical URL and content hash.

### 6. A mastery ladder that can grow

Generate a stage-level map first, and expand the next stage as the learner approaches it. That replaces a one-shot 6 to 15 objective map and lets a topic grow to hundreds of concepts. Revise it from attempts, since a generated graph is only a hypothesis. Placement should walk the graph adaptively rather than ask a fixed 3 to 7 questions.

Suggested per-concept ladder. The thresholds are starting values to calibrate, not established findings:

| State | Requires |
| --- | --- |
| Practising | Any attempts, including assisted ones |
| Independent | 3 unassisted passes, across at least 2 different cases |
| Retained | 3 spaced passes on new cases, unassisted, scheduled by FSRS, spanning at least 30 days |
| Mastered (milestone level) | Retained prerequisites plus an unassisted capstone combining them |

Hard-gate dependent concepts on `Independent`, with an explicit "skip ahead" that runs a check rather than bypassing one. The V2 beta spec excludes credentials and physical skills from any competence claim, and that limit should stay: "any topic" means anything groundable in text and assessable in the app.

### 7. Evaluation harness: start this first

The product has no way to know whether any of this works, and research says learners can't tell either.

- **Scorer:** a hand-graded answer set per domain, with agreement measured before the 80% threshold is trusted.
- **Generator:** golden topics, including an empty-KB beginner, checked for unsupported prose and repeated prompts.
- **North star:** the existing plan already names it, learners who later demonstrate retained or transferable capability. Report unassisted pass rate on new cases at 7 and 30 days, and compare adaptive against fixed sequencing.
- **Never count:** completion, time, satisfaction or confidence as learning.

## Keep, change, add, remove

**Keep**
- Convex authority, revision pinning, append-only attempts, leases, idempotency and failure recovery
- Server-only scoring, and honest assistance tracking
- Safe fetching, untrusted-source handling and the privacy-safe query rules
- Deletion, export and evidence tombstones
- `dev`'s thread-first home, intents, "Why this?" controls, memory controls and typed primitives
- The no-guilt stance, and calendar as an optional projection

**Change**
- Fixed 10 blocks to planned steps
- Retrieval to require an answer
- Worked examples from penalty to default support for novices
- Every response to be stored and used
- Delayed checks to be test-first with new prompts
- Calibration to actually shorten plans
- Plain text to rendered markdown and diagrams
- Source review, map editing and scheduling from required steps to optional advanced views
- Per-thread free-text preferences to a typed, cross-topic profile
- SM-2 to FSRS

**Add**
- Learner model and concept IDs
- Learner Brief
- Teaching for threads with no V2 mission
- Tiered provenance
- Graded activity types
- Prerequisite gates
- Expanding maps and capstones
- Interest-based examples, offered on request
- In-step help, available only after a required attempt
- Evaluation harness

**Remove or retire**
- `misconception_feedback`, `next_review` and `objective` as generated blocks, replaced by feedback written after the attempt
- V1 course creation, once threads can teach; keep existing courses readable and migrate the renderers
- V1 streaks and freezes when V1 goes, which also resolves the conflict with the no-guilt stance
- Any style quiz or style label, before one gets added
- `deprioritized`, if the planner rewrite makes it redundant

**Pause, pending the first learning results**
- Cross-feature provenance analysis (#267 to #270)
- GA evidence bundle, audits and soak (#276 to #280)
- Further calendar investment

Those are good controls for a product that has already proved its learning loop. Right now they would be gating activation of a loop that cannot adapt yet.

## Suggested sequence

Each step ships value on its own and is gated by the one before.

| # | Work | Size | Exit test |
| --- | --- | --- | --- |
| 0 | Triage the PR stack, decide the trunk, bring `dev` to green. Start the evaluation harness | M | One branch of truth; scorer agreement measured |
| 1 | **Integrity fixes:** defects 1 to 9, plus Learner Brief and markdown rendering | M | Delayed check is test-only; remediation visibly differs from the failed lesson; all responses stored |
| 2 | Learner model, concept IDs, FSRS, "How you're learning", revised ladder | L | Estimates predict delayed results better than a baseline, offline |
| 3 | Next-move planner with step-by-step generation; first graded activity types from V1 | L | Adaptive beats fixed sequencing on delayed transfer, or we learn why not |
| 4 | Tiered provenance and teaching for threads with no mission; search budget. Needs an ADR | M | Empty-KB beginner reaches a real lesson; T2 error rate measured |
| 5 | Expanding maps, adaptive placement, capstones | L | A learner completes multiple stages of one topic |
| 6 | Sandboxed simulations; format-effect experiment | M | Only if step 3 shows a catalogue gap |

Steps 1 and 4 are what would make it feel different to a user. If you need to show something quickly, step 1 is small relative to the work already done.

## Decisions (2026-11-04)

1. **Learning style:** replaced by the three-layer Learner Model. See [ADR-0008](../adr/0008-adapt-to-demonstrated-knowledge-not-learning-styles.md).
2. **Model knowledge:** allowed as a labelled tier, with assessment keys still source-bound. This amends ADR-0007. See [ADR-0009](../adr/0009-allow-labelled-model-knowledge-as-a-teaching-tier.md).
3. **Generated UI:** a typed catalogue on the full shadcn-vue library, with sandboxed simulations possible later. See [ADR-0010](../adr/0010-compose-learning-activities-from-a-typed-catalogue.md) and the [catalogue](./learn-anything-activity-catalogue.md).
4. **Trunk and stack:** land or close the 12-PR stack and pause GA gates until the sequence reaches step 3. The metric and analysis tickets (#271 to #273, #253) are kept, because measurement is now a priority. No PR has been changed yet.
5. **Search:** the 25-a-day limit goes, with a target of near $0. See [ADR-0011](../adr/0011-use-a-budgeted-source-discovery-waterfall.md) and the [search design](./learn-anything-search.md).
6. **Naming:** "Void" is the learner-facing term, reversing the adaptive plan's move to "thread". Recorded in `CONTEXT.md`. Whether to merge or rename `learningThreads` and `/app/learn/thread/:threadId` in code is still open.

Follow-up answers, also 2026-11-04:

- **Stack triage:** approved, including merging or closing PRs. Keep the metric and analysis work.
- **Scorer validation:** AI-only, with no human graders. The measurement design adds checks that don't depend on AI agreement.
- **Rename:** rename learner-facing copy and routes to "Void" now. Leave merging `learningThreads` and `learningVoids` until later.
- **Search budget:** $25 a month, with alerts.
- **Provider terms:** no separate legal review.

Measuring real learning is the priority: see the [measurement design](./learn-anything-measurement.md). It moves the baseline ahead of the larger build.

## Not verified

- **Usage and production state.** I did not see production data. PostHog needs authorization, and this worktree has no Convex deployment configured. So I don't know how many learners use V1 or V2, or real generation failure rates, or whether either flag is on in production. Retiring V1 depends on this.
- **Running behaviour.** Defects come from reading code. Only the existing automated tests exercise these paths, and I did not run them.
- **The PR stack.** I read titles, diffstats and #336's checks, not the code. Defect line numbers are from `dev`; a grep at the stack tip found no change to generation or `worked_example` building.
- **Cost and latency.** Step-by-step generation is unpriced. Measure it in step 3 before committing.
- **The proposals.** The T0 to T2 tiers, ladder thresholds and planner sequences are design inferences from the evidence, not tested designs. The evidence file lists which sources I could only read as abstracts or secondary summaries.
