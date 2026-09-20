# Learn Anything adaptive experience plan

**Status:** approved for staged implementation
**Date:** 2026-09-20
**Replaces:** the learner-facing assumptions in `docs/learn-v2-production-experience.md`; it does not remove the current V1 or V2 data planes
**Product promise:** Bring Budds a goal or material and leave each visit able to do something you could not do before.

## 1. Why this change

The current Learn V2 implementation is technically rigorous but exposes its governance pipeline as the learner journey. A learner must configure an outcome, manage evidence, approve a learning map, complete calibration, configure a schedule, accept a plan, and then follow a fixed session sequence before the product demonstrates its value.

That design is appropriate for durable authority and auditability. It is not an appropriate universal experience. It makes an immediate question, a practical project, exam preparation, curiosity, and long-term mastery look like the same course-building problem.

The new experience keeps the evidence, revision, scoring, recovery, and retention foundations while moving them behind an adaptive learner-facing model.

## 2. Product thesis

Budds becomes an adaptive learning companion that turns the learner's current intent into the best next learning move, grounds factual teaching in inspectable evidence, observes what helps, and remembers enough to resume intelligently.

The primary learner-facing object is a **learning thread** rather than a course, mission, or wizard. A thread may remain a one-time interaction or grow into a durable mastery path.

A learning thread remembers:

- the learner's current outcome and why it matters;
- source scope and evidence state;
- attempts, assistance, misconceptions, and confidence calibration;
- useful representations and explicit learner preferences;
- saved artifacts and representative performances;
- the unresolved point and next meaningful action;
- optional review and mastery state when durable learning is requested.

## 3. Experience principles

1. **Value before administration.** The learner reaches a meaningful activity before being asked to manage sources, maps, rubrics, schedules, or calendars.
2. **Adapt to the moment, not a permanent persona.** The same learner may need an answer now, rehearsal tomorrow, and durable mastery later.
3. **Learner agency inside safe structure.** Budds recommends one next move and lets the learner change format, depth, difficulty, time, or support.
4. **Authentic output over content traversal.** Progress means a better explanation, decision, artifact, performance, or retained capability—not opened pages.
5. **Evidence at the point of trust.** Source administration stays quiet until a factual claim, conflict, gap, or rights issue requires attention.
6. **Continuity without guilt.** Return prompts resume unfinished value or vulnerable knowledge; they do not optimize streaks or attendance.
7. **Stable shell, adaptive activity.** The interface remains predictable while the central activity changes through an allowlisted component grammar.
8. **Explainable adaptation.** Every selected activity can answer “Why this?” and can be overridden.

## 4. Intent model

| Intent | First useful move | Evidence of value | Optional continuation |
| --- | --- | --- | --- |
| Understand now | Cited explanation, comparison, map, or diagnostic question | Learner explains or correctly navigates the idea | Save as a thread or go deeper |
| Prepare | Diagnose representative gaps and rehearse likely tasks | Improved performance on representative tasks | Deadline-aware practice plan |
| Build or solve | Work inside a real problem or artifact | Useful output plus transferable reasoning | Critique, revision, or related capability |
| Master | Diagnostic followed by sequenced practice | Independent and delayed transfer | Spaced review and retention checks |
| Refresh | Short retrieval targeting decay or a prior error | Rapid recovery without full relearning | Reschedule only if still vulnerable |
| Explore | Guided questions, connections, and source trails | Learner identifies meaningful new questions | Promote a branch into its own thread |

Intent is mutable. Switching intent never discards prior work or silently changes mastery claims.

## 5. Core loop

`Intent -> First move -> Observe -> Adapt -> Apply -> Remember`

### Intent

The home surface asks **“What are you trying to understand or do?”** The learner can add a folder, document, URL, pasted material, or nothing yet. Budds asks at most one high-value clarification before acting.

### First move

Budds presents a useful interaction within 30–90 seconds:

- trusted evidence ready: begin a grounded learning activity;
- evidence still preparing: begin a non-factual diagnostic, goal-shaping, or source-selection interaction and transition automatically when evidence is ready;
- evidence unavailable: say so plainly and offer the smallest recovery action;
- ready V2 session: start directly without a workspace handoff.

Loading, a generated outline, or a schedule does not count as first value.

### Observe

The system records the learner response, assistance used, correctness or rubric evidence, confidence, explicit preference changes, and safe interaction events. Time-on-page, clicks, or model guesses cannot raise mastery.

### Adapt

The next activity is selected from pinned thread state. Learner controls remain visible:

- Explain differently
- Show an example
- Let me try
- Quiz me
- Compare sources
- Make this practical
- Make it easier or harder
- Give me the answer now
- Change available time

### Apply

Every meaningful loop ends with a representative task or useful artifact appropriate to the selected intent. A direct answer may satisfy an immediate need but never implies mastery.

### Remember

Budds saves what changed, what remains uncertain, and the next useful move. Returning opens at that point rather than at a generic dashboard or last visited page.

## 6. Information architecture

### Learning Home

The default `/app/learn` experience contains only:

1. **Start from a need** — goal/question input with optional context and intent suggestions.
2. **Resume** — the most relevant active thread with the unresolved point and promised payoff.
3. **Worth revisiting** — a due review only when it materially protects learning.
4. **Other threads** — compact history, search, and management.

Current V1 courses and V2 missions remain reachable through an entitlement-aware coexistence surface during migration.

### Learning Thread

The thread shell contains:

- outcome and current intent;
- next meaningful action;
- Adaptive Canvas;
- compact capability/artifact history;
- optional source/evidence drawer;
- optional path and schedule details;
- learner memory controls.

Adaptive threads use `/app/learn/thread/:threadId`. Existing V2 missions remain
at `/app/learn/:learningVoidId`; route parameters never multiplex the two
authorities.

Source management, blueprint revisions, assessment contracts, and scheduling remain advanced views rather than required tabs.

### Adaptive Canvas

The canvas renders a server-validated composition of approved primitives. Initial grammar:

1. `cited_explanation`
2. `diagnostic_prompt`
3. `worked_example`
4. `independent_application`
5. `source_comparison`
6. `artifact_workspace`
7. `reflection_next_move`

Later candidates include a concept map, timeline, scenario rehearsal, retrieval burst, audio conversation, decision tree, and sandbox.

Each activity plan must carry:

- contract and renderer version;
- thread, objective, and intent identity;
- purpose and user-visible reason code;
- bounded primitive sequence;
- required learner action;
- accepted evidence and claim references for factual teaching;
- completion/evaluation contract;
- fallback representation;
- accessibility metadata;
- immutable generation and decision inputs needed for replay.

Providers may fill bounded content fields. They may not define components, navigation, tools, actions, grading rules, HTML, Vue, JavaScript, or executable code.

## 7. Authority and trust boundaries

Convex remains authoritative for:

- ownership and access;
- active blueprint and content revisions;
- evidence acceptance and deletion state;
- attempt and assistance history;
- scoring and rubric versions;
- mastery transitions;
- learning-thread lifecycle and next action;
- idempotency and reconciliation.

Before adaptive routing can influence mastery, the following correctness work is mandatory:

1. Resolve the explicitly accepted/active blueprint rather than merely the newest ordinal revision.
2. Scope mastery records and attempts to the pinned blueprint revision and objective identity.
3. Define an explicit monotonic mastery transition table, including retained-state regression only after an auditable failed delayed check.
4. Prove no public client path can supply authoritative score, verdict, or mastery state.
5. Pin scorer, rubric, verifier, provider, and activity-contract versions for persisted attempts.
6. Verify or safely template learner-facing grading rationales and use a controlled misconception taxonomy.
7. Treat generated planning rationale, confidence, clicks, snippets, and unverified model knowledge as non-evidence.
8. Specify provider data minimization, payload bounds, retention assumptions, timeout behavior, and ambiguous-outcome reconciliation.

## 8. Generative UI safety

- Render only registered primitives with exhaustively validated props.
- Treat generated text, retrieved source text, learner content, and model rationale as untrusted data.
- Persist semantic activity state separately from its visual rendering.
- Change composition only at explicit activity boundaries.
- Provide deterministic text/card fallback for every primitive.
- Reject unknown component types, unsupported actions, excess content, invalid evidence links, and unsafe URLs.
- Never allow generated content to invoke client tools or mutations directly.
- Preserve keyboard operation, semantic landmarks, screen-reader announcements, visible focus, reduced motion, non-color state labels, and minimum touch targets.
- On mobile, contextual panels become drawers and the learner's current response remains stable across layout changes.

## 9. Migration and coexistence

- V1 folder courses remain a first-class route and data plane until separately retired.
- Existing V2 missions continue to function during rollout.
- Learning threads initially reference existing V2 mission/session records rather than duplicating authority.
- Upgrade remains copy-only; it never infers mastery, evidence acceptance, or schedules.
- Feature flags support cohort rollout and immediate rollback to the current experience.
- Historical attempts retain their pinned blueprint, evidence, content, rubric, scorer, and verifier revisions.
- “Learning Void,” “Mission,” “Session Void,” and “Learning Compiler” become internal or legacy terms; learner-facing language uses thread, activity, practice, evidence, and review.

## 10. Delivery phases

### Phase 0 — authority and measurement foundation

Deliver:

- active-blueprint resolution and revision-scoped mastery;
- explicit mastery transition table and regression tests;
- safe feedback rationale and misconception policy;
- versioned activity event taxonomy;
- V1/V2 coexistence and rollback tests;
- pure Adaptive Canvas schema and registry contract;
- deterministic clock seams for delayed-retention tests.

Exit gate: authority tests prove adaptive presentation cannot invent evidence, scores, or mastery and cannot break current V1/V2 journeys.

### Phase 1 — instant thread vertical slice

Deliver:

- new Learning Home intent composer;
- optional folder/material context;
- direct start for a ready session;
- a compact first-value activity using existing session evidence and scoring;
- intent and format controls;
- saved unresolved point and resume card;
- source/evidence drawer;
- feature-flagged rollout.

Refresh uses the registered `diagnostic_prompt` primitive in Phase 1; retrieval
burst remains deferred. V2-backed provider dispatch is admitted only under a
finite default-deny pilot manifest. That manifest is pilot admission evidence,
not general-availability approval.

The initial 30–90 second SLA applies to users with ready evidence/content. New-thread preparation timing is measured separately until the source and content pipeline is optimized.

Exit gate: at least 70% of eligible users reach a meaningful activity within 90 seconds, 60% complete it, and at least 50% report 4/5 usefulness in the pilot. Metrics are decision thresholds, not permanent product claims.

### Phase 2 — adaptive next move

Deliver:

- versioned pure routing from intent, response outcome, assistance, confidence calibration, available time, and source state;
- five to seven Adaptive Canvas primitives;
- “Why this activity?” explanations and one-tap overrides;
- safe fallback and replayable decision logs;
- controlled experiment against a fixed continuation.

Exit gate: adaptive routing materially improves representative-task performance, completion, or usefulness without worsening accessibility or recovery.

### Phase 3 — full learning-thread memory

Deliver:

- durable thread aggregate and lifecycle;
- artifact and unresolved-point persistence;
- learner-visible memory controls;
- optional mastery/review promotion;
- return experience based on unfinished value, vulnerable knowledge, or source change.

Exit gate: learners resume after seven days without restating context and voluntarily continue the same thread at a higher rate than the current mission workspace.

### Phase 4 — cross-feature learning memory

Deliver:

- provenance-preserving contributions from Chat, Quiz, Flashcards, Podcast, and documents;
- conversion of useful interactions into thread activities or review candidates;
- consistent evidence and mastery semantics across features.

Exit gate: cross-feature events improve the next learning action without duplicating attempts, silently raising mastery, or obscuring source origin.

### Phase 5 — migration and general availability

Deliver:

- current V2 mission migration views;
- performance and cost controls;
- accessibility and security audits;
- provider activation evidence;
- documented rollback and support procedures;
- general-availability cohort expansion.

Slice 5 owns general-availability provider activation approval, separate from
the pilot manifest required for any Slice-1 V2-backed dispatch.

## 11. Measurement contract

Primary signal:

> Weekly learners who complete a meaningful learning loop and later demonstrate retained or transferable capability.

Required event taxonomy:

- thread drafted;
- evidence ready or blocked;
- activity eligible;
- activity started;
- meaningful response submitted;
- assistance level used;
- activity completed;
- representative task passed or failed;
- delayed check eligible;
- delayed check attempted;
- retained;
- remediation entered;
- provider failure or ambiguous outcome;
- evidence gap/invalidation;
- learner abandoned or explicitly ended the thread.

Metric definitions and denominators are versioned. Seven-day retention is reported only for capabilities eligible for a seven-day check. Time spent, generated-content views, confidence, DAU, streaks, and completion percentages are not mastery proxies.

For ready-content first value, the timer starts at authoritative
`thread_command_committed.v1` and stops only at server-authorized
`meaningful_activity_started.v1`; preparing sessions use a separate denominator.

## 12. E2E acceptance journeys

### First-value journey

1. Authenticate through the production UI.
2. Open Learn and state a goal.
3. Attach an owned folder or source.
4. Select or accept an inferred intent.
5. Reach a meaningful source-aware activity without managing a map or schedule.
6. Respond, request support if needed, and complete a representative action.
7. Observe grounded feedback, source scope, saved progress, and next action.
8. Leave and resume at the unresolved point.

### Authority and recovery matrix

Automated coverage must include:

- V2 disabled while V1 remains usable;
- ready, preparing, blocked, stale, and evidence-invalidated activities;
- assisted pass capped at guided;
- failed attempt and remediation;
- independent pass;
- delayed retained pass across DST boundaries;
- stale blueprint/content revision;
- provider timeout before and after authoritative commit;
- unsupported generated component or action;
- accessibility fallback;
- feature-flag rollback with no data loss.

Deterministic local adapters prove application behavior only. Live provider, Calendar, search, and production activation remain separate evidence gates.

## 13. Explicit non-goals for the first release

- Arbitrary generative interfaces or model-authored application code
- Replacing the current Learn V2 backend in one migration
- Merging V1, V2, and thread storage models
- Social leaderboards or attendance gamification
- Requiring Calendar, live web search, or one model provider
- Claiming delayed retention from a single immediate browser session
- Child-directed learning or school administration controls

## 14. Implementation order

1. Land this contract and its focused tests.
2. Correct active-revision, mastery-scope, transition, and feedback-authority gaps.
3. Define the versioned Adaptive Canvas contract and component registry.
4. Build Learning Home and compact ready-session first-value flow behind a flag.
5. Add thread resume state and evidence drawer.
6. Run the pilot and decide whether adaptive composition earns expansion.
7. Add the durable thread aggregate only after the first-value loop demonstrates utility.

This order intentionally proves learner value before committing to a generalized generative-UI platform.
