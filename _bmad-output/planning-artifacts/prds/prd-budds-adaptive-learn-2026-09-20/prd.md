---
title: Budds Adaptive Learn
status: final
created: 2026-09-20
updated: 2026-09-20
sources:
  - docs/learn-anything-adaptive-experience-plan.md
  - _bmad-output/specs/spec-adaptive-learn-experience/SPEC.md
launch_posture: staged, additive, reversible, authority-first
---

# Product Requirements Document: Budds Adaptive Learn

## Purpose

Budds Learn V2 currently asks learners to administer an evidence workflow, map,
calibration, and schedule before they experience useful learning. This product
turns that responsible foundation into an intent-led learning companion. A
learner brings a need or material, receives a useful grounded activity quickly,
can change the form of help, and returns to the unresolved point later.

The product must preserve Convex authority, evidence integrity, server scoring,
revision pinning, accessibility, and V1/V2 coexistence. The first release is a
Phase 0/1 vertical slice; adaptive routing, durable memory, cross-feature
memory, and migration/GA are subsequent slices with explicit gates.

## Vision

Bring Budds a goal or material and leave each visit able to do something the
learner could not do before. Budds recommends one explainable next move,
grounds factual claims in inspectable accepted evidence, observes what helps,
and remembers enough to resume intelligently without guilt loops.

## Jobs to be done

- When I have a question or immediate need, help me make useful progress before
  I configure a course.
- When I am preparing or building something, let me practise the task and
  improve a real output, not merely consume content.
- When I want mastery, give me bounded retrieval and delayed checks without
  claiming mastery from clicks, confidence, or calibration alone.
- When I return, restore the unresolved point, relevant evidence, attempts, and
  next action without making me restate context.
- When a claim matters, show where it came from and say plainly when evidence
  is insufficient, conflicting, stale, or unavailable.

## Users and assumptions

The initial cohort is authenticated adult Budds users with existing access to
folders/documents and the current Learn V2 infrastructure. Child-directed
learning, school administration, social competition, and attendance mechanics
are out of scope. The same learner may use different intents at different
times; intent is mutable state, not a permanent persona.

## Named journeys

### UJ-1. Maya gets first value from a real question

Maya is an authenticated adult learner with ten minutes before work. She opens `/app/learn`, states a goal, optionally attaches
a folder/document/URL/pasted material, accepts or changes an intent, and reaches
a meaningful source-aware activity without approving a map or schedule. The
learner responds, requests support if needed, completes a representative action,
sees grounded feedback and the next action, leaves, and later resumes.

**Requirements:** FR-001–006, FR-013–018, FR-027, FR-030.

### UJ-2. Jordan prepares against a deadline

Jordan has an assessment deadline and selects prepare. Budds diagnoses a
representative gap, offers bounded support, and records an assessed action.
Assistance is recorded and cannot silently produce an independent or retained
claim. The climax is measurable improvement on a representative task, not a
completed content sequence.

**Requirements:** FR-003–005, FR-013–015, FR-019–025.

### UJ-3. Aisha improves a real artifact

Aisha is solving a practical problem and selects build or solve. Budds opens an
artifact workspace grounded in her accepted material, helps her revise the
artifact, and captures the transferable reasoning behind the change. The climax
is a useful saved output plus a next action she can resume.

**Requirements:** FR-007–015, FR-026–028.

### UJ-4. Theo masters, returns, and refreshes

Theo selects master and later returns to refresh. Budds uses objective-scoped attempts,
remediation, and (for mastery) delayed unassisted transfer. A refresh targets
decay or a prior error and does not force a durable plan. A retained claim is
only made after an eligible delayed check.

**Requirements:** FR-019–028, FR-033–034.

### UJ-5. Rafael inspects evidence and recovers safely

Rafael needs to trust a consequential factual explanation. He opens the evidence drawer, sees accepted
passage-level support and origin, or sees an explicit gap/conflict state. If a
provider, search, source, or generated activity fails, the learner keeps
accepted state and receives a bounded retry, fallback, or non-factual next move.

**Requirements:** FR-011–012, FR-016–021, FR-033.

### UJ-6. Sam resumes while legacy Learn remains available

After leaving, the learner sees a relevant unresolved point or due review. On a
later visit the thread resumes without re-onboarding. Existing V1 courses and
V2 missions remain reachable; a rollout rollback returns to the current
experience without data loss or rewritten historical claims.

**Requirements:** FR-006–008, FR-027, FR-029–036.

## Experience model

The learner-facing object is a learning thread. Its loop is:

`Intent -> First move -> Observe -> Adapt -> Apply -> Remember`

Intents are understand now, prepare, build or solve, master, refresh, and
explore. The stable shell contains Learning Home, thread header, Adaptive
Canvas, coach controls, evidence drawer, artifact/capability history, and memory
controls. Planning, source management, blueprint revisions, rubrics, and
schedules are advanced views surfaced only when a decision requires them.

The initial primitive registry is:

`cited_explanation`, `diagnostic_prompt`, `worked_example`,
`independent_application`, `source_comparison`, `artifact_workspace`, and
`reflection_next_move`.

Every activity has a purpose, user-visible reason, learner action, evidence
references, completion/evaluation contract, accessibility metadata, and
deterministic fallback. Providers may fill bounded content fields only. They may
not define components, navigation, tools, actions, grading rules, HTML, Vue,
JavaScript, or executable code.

### Normative glossary

- **Meaningful activity:** a rendered, operable registered primitive with a
  required learner action, a visible purpose/reason, and either accepted evidence
  for factual teaching or an explicitly non-factual state. A skeleton, outline,
  schedule, blocked notice, or content view without an action is not meaningful.
- **Representative task:** a server-recorded action that exercises the selected
  intent's stated outcome and has a completion/evaluation contract; page views
  and navigation do not qualify.
- **Guided:** an outcome produced with substantive assistance, including a hint
  or answer reveal; it cannot be promoted to independent by confidence or reuse.
- **Independent:** an unassisted, server-scored qualifying attempt against the
  pinned rubric and objective.
- **Retained:** an eligible unassisted transfer pass at least seven calendar
  days after the first independent pass, against the pinned rubric revision.
- **Eligible ready-content session:** access is granted and accepted, unpurged
  evidence plus published content or a valid standalone non-factual activity is
  available at authoritative thread-command commit.

## Functional requirements

### Intent and first value

- **FR-001:** The Learning Home shall accept a goal/question and optional folder,
  document, URL, pasted material, or no material, and shall create a valid
  thread draft without requiring curriculum, rubric, schedule, or Calendar setup.
- **FR-002:** The system shall ask at most one high-value clarification before
  presenting a first move and shall preserve the learner's original wording.
- **FR-003:** The system shall represent the six supported intents and allow the
  learner to select or change intent without deleting prior work or silently
  changing mastery claims.
- **FR-004:** For an eligible ready-content user, the system shall present a
  meaningful activity within 90 seconds of the initiating action; loading,
  generated outlines, and schedules shall not count as first value.
- **FR-005:** While evidence is preparing, the system shall offer a non-factual
  diagnostic, goal-shaping, or source-selection activity and transition safely
  when evidence becomes ready; while blocked, it shall explain the state and
  offer the smallest bounded recovery action.
- **FR-006:** A ready existing V2 session shall be startable directly from the
  new experience without a workspace handoff.

### Thread, canvas, and learner control

- **FR-007:** A thread shall retain outcome, current intent, source scope and
  evidence state, attempts, assistance, misconceptions, confidence calibration,
  explicit preferences, artifacts, representative performances, unresolved point,
  and next meaningful action.
- **FR-008:** The thread shell shall expose one next meaningful action, an
  Adaptive Canvas, compact history, optional evidence drawer, optional path or
  schedule details, and learner memory controls.
- **FR-009:** The server shall validate every activity composition against a
  versioned allowlist of registered primitives and bounded props before render.
- **FR-010:** Each activity plan shall persist contract/renderer version, thread,
  objective and intent identity, purpose/reason code, primitive sequence,
  required learner action, accepted evidence/claim references, evaluation
  contract, fallback, accessibility metadata, and immutable generation/decision
  inputs sufficient for replay.
- **FR-011:** The client shall reject unknown components, unsupported actions,
  excess content, invalid evidence links, unsafe URLs, and generated executable
  content; generated content shall never invoke tools or mutations directly.
- **FR-012:** The system shall provide deterministic text/card fallback for every
  primitive and shall keep semantic activity state separate from visual rendering.
- **FR-013:** The learner shall be able to choose bounded format, support,
  difficulty, practicality, example, source-comparison, answer-now, and
  available-time controls; each override shall be recorded as learner input.
- **FR-014:** Every selected activity shall expose a plain-language “Why this?”
  explanation and a bounded override path.
- **FR-015:** Every meaningful loop shall end in a representative task or useful
  artifact appropriate to the intent; direct explanation alone shall not imply
  mastery.

### Evidence and authority

- **FR-016:** Convex shall remain authoritative for ownership/access, active
  blueprint and content revisions, evidence acceptance/deletion, attempts and
  assistance, scoring and rubric versions, mastery transitions, thread lifecycle,
  idempotency, and reconciliation.
- **FR-017:** Factual teaching claims shall link to accepted evidence with source
  origin, locator/passage where permitted, revision identity, and explicit
  fact/synthesis/inference/unknown status.
- **FR-018:** The evidence drawer shall distinguish folder, user URL, web, and
  other origins; show accepted, insufficient, conflicting, stale, deleted, and
  unavailable states; and never promote a search snippet or model memory to
  evidence.
- **FR-019:** Activity attempts shall be scoped to the pinned blueprint revision
  and objective identity, with scorer, rubric, verifier, provider, and activity
  contract versions persisted.
- **FR-020:** No public client path shall be able to supply authoritative score,
  verdict, or mastery state; feedback rationales and misconception labels shall
  use validated templates/taxonomy or be safely rejected.
- **FR-021:** Provider payloads shall enforce data minimization, size bounds,
  retention assumptions, timeout behavior, and ambiguous-outcome reconciliation;
  failures shall preserve accepted learner state.

### Adaptation, mastery, and memory

- **FR-022:** Phase 2 routing shall be a pure, versioned decision from pinned
  intent, response outcome, assistance, confidence calibration, available time,
  source state, and explicitly allowed thread state.
- **FR-023:** Routing decisions shall produce replayable logs containing the
  decision version, inputs, selected activity, reason code, and fallback outcome.
- **FR-024:** Mastery transitions shall use an explicit state table: assisted
  outcomes cannot exceed guided; independent requires an unassisted,
  server-scored qualifying attempt; retained requires an eligible unassisted
  transfer at least seven calendar days after independence; failed delayed checks
  enter auditable remediation without erasing history.
- **FR-025:** Confidence, time-on-page, clicks, generated-content views, planning
  rationale, and unverified model knowledge shall never raise mastery.
- **FR-026:** Phase 3 shall persist a durable thread lifecycle, artifacts,
  unresolved points, learner-visible memory controls, and optional promotion to
  mastery/review without forcing mastery mechanics on immediate or exploratory
  intents.
- **FR-027:** Resume selection shall restore relevant goal, source/evidence state,
  attempt context, artifact, unresolved point, and next action; it shall prefer
  unfinished value, vulnerable knowledge, or meaningful source change over generic
  recency or streaks.
- **FR-028:** Learner memory controls shall allow viewing and bounded correction,
  deletion, or disablement of explicit preferences and saved artifacts without
  rewriting authoritative historical attempts.

### Coexistence and cross-feature memory

- **FR-029:** Threads shall initially reference existing V2 mission/session
  records where possible rather than duplicate authority; upgrade shall be
  copy-only and shall not infer mastery, evidence acceptance, or schedules.
- **FR-030:** V1 courses and existing V2 missions shall remain first-class,
  entitlement-aware routes throughout rollout, with immediate feature-flagged
  rollback and no data loss.
- **FR-031:** Phase 4 shall accept provenance-preserving contributions from Chat,
  Quiz, Flashcards, Podcast, and documents, and shall expose source origin when
  converting an interaction into a thread activity or review candidate.
- **FR-032:** Cross-feature reuse shall deduplicate attempts and shall never
  silently raise mastery or obscure source origin.

### Measurement and operations

- **FR-033:** The system shall emit versioned events for thread drafted, evidence
  ready/blocked, activity eligible/started, meaningful response, assistance,
  completion, representative pass/fail, delayed-check eligibility/attempt,
  retained, remediation, provider failure/ambiguity, evidence gap/invalidation,
  and abandonment/explicit end.
- **FR-034:** Every metric shall declare a version, event source, eligibility
  rules, numerator, denominator, time window, and exclusion rules; seven-day
  retention shall only include capabilities eligible for a seven-day check.
- **FR-035:** Phase 2 shall support a controlled experiment against a fixed
  continuation, with routing performance, completion, usefulness, accessibility,
  and recovery guardrails recorded separately.
- **FR-036:** Phase 5 shall provide performance/cost controls, accessibility and
  security audit evidence, provider activation evidence, rollback procedures, and
  support procedures before general-availability expansion.

## Non-goals

- Arbitrary generative interfaces or model-authored application code.
- Replacing the Learn V2 backend in the first release.
- Merging V1, V2, and thread storage models immediately.
- Social leaderboards, attendance rewards, or streak-driven engagement.
- Making Calendar, live web search, or one model provider a prerequisite for
  first value.
- Claiming delayed retention from a single immediate browser session.
- Child-directed learning or school administration controls.

## Release slices and exit gates

### Slice ownership legend

Requirements are complete-product requirements, not one undifferentiated MVP.
Only Slice 0 and Slice 1 enter the first-release implementation backlog. A later
slice may begin design/test scaffolding early, but cannot expose behavior until
all preceding gates pass. Story and test records must carry one `slice` value
(`0` through `5`) and may not silently pull a later-slice FR into Slice 0/1.

Primary FR ownership is disjoint: Slice 0 owns FR-009–012 and FR-016–021 plus
FR-024–025; Slice 1 owns FR-001–008, FR-013–015, and FR-029–030; Slice 2 owns
FR-022–023, FR-035, and the adaptive-routing implementation of FR-009–014;
Slice 3 owns FR-026–028; Slice 4 owns FR-031–032; Slice 5 owns FR-033–034 and
FR-036 as production measurement and operations. Foundational event/schema work for FR-033–034 may
be implemented in Slice 0, but only Slice 5 is their primary operational owner.
No story may claim primary ownership of an FR twice. NFRs are cross-slice
invariants and are validated by the slice that first exercises the affected
surface. The first-release backlog is limited to Slice 0/1 primary rows; later
rows must be marked `deferred` and cannot be exposed by the first-release flag.

### First-value measurement contract

An `eligible ready-content` session is one where access is granted and the
selected activity already has accepted, unpurged evidence plus published content
or a valid standalone non-factual activity at thread-command commit. The timer
starts at immutable `thread_command_committed.v1` and stops only at
`meaningful_activity_started.v1`. That event is emitted once, server-authorized,
when a registered composition is schema-valid, rendered and operable, contains a
required learner action, displays its purpose/reason, and has accepted evidence
references for factual teaching (or an explicit non-factual classification).
Preparation, skeletons, outlines, schedules, blocked notices, and fallback-only
notices without a learner action do not stop the timer. Evidence becoming ready
after commit is a separate preparing denominator and starts at
`evidence_ready.v1`; it is never mixed with the ready-content denominator. The
`first_value.v1` definition records eligibility reason, event versions,
exclusion code, cohort, activity contract, and thread ID. Its denominator is all
authenticated flag-eligible sessions with `thread_command_committed.v1` and no
explicit exclusion; its numerator is those with `meaningful_activity_started.v1`
at or before 90 seconds.

### Slice 0: authority and measurement foundation

Deliver FR-016–021, FR-024–025, FR-033–034, and the schema/registry portion of
FR-009–012. Correct active-blueprint resolution, revision-scoped mastery,
transition tests, safe feedback, event taxonomy, V1/V2 rollback tests, and
deterministic clock seams. Exit only when authority tests prove presentation
cannot invent evidence, scores, or mastery and cannot break V1/V2 journeys.

### Slice 1: initial release — instant thread vertical slice

Deliver FR-001–008, FR-013–015, FR-017–018, FR-029–030 using a compact approved
primitive set and existing ready V2 evidence/attempt infrastructure. Keep new
thread preparation timing separate from the ready-content SLA. Pilot exit
thresholds: at least 70% of eligible users reach meaningful activity within 90
seconds, 60% complete it, and at least 50% report usefulness of 4/5 or better.
These are decision thresholds, not permanent product claims.

For Refresh, Slice 1 uses the registered `diagnostic_prompt` primitive;
retrieval burst remains deferred. Slice-1 V2-backed provider dispatch is
permitted only under a finite default-deny pilot manifest. That pilot admission
manifest does not constitute general-availability provider activation.

### Slice 2: adaptive next move

Deliver FR-022–023, remaining FR-009–014, and FR-035 with five to seven hardened
primitives, reason explanations, one-tap overrides, safe fallback, and replayable
decision logs. Exit when adaptive routing improves representative-task
performance, completion, or usefulness against fixed continuation. Before
exposure, the experiment artifact must name one primary outcome and freeze its
eligibility, denominator, baseline, minimum practical effect, sample/stop rule,
and analysis method. Exit requires the frozen practical-effect threshold and no
accessibility-completion or recovery-success guardrail degradation greater than
3 percentage points. A post-hoc threshold cannot qualify the slice.

The required artifact is `adaptive-routing-analysis.v1`, owned by Product
Analytics with Product as approver, QA as guardrail verifier, and Engineering as
replay-log owner. It must be approved before exposure and freeze the primary
representative-task outcome, baseline, minimum practical effect, eligibility and
denominator, minimum sample, stopping rule, 95% confidence-interval decision
rule, and rollback trigger. Product owns go/no-go; QA owns accessibility and
recovery evidence.

### Slice 3: durable thread memory

Deliver FR-007, FR-026–028 and the durable thread lifecycle. Exit when learners
resume after seven days without restating context and voluntarily continue the
same thread at a pre-registered practically meaningful higher rate than the
current mission workspace. The comparison freezes eligibility, context-
restoration rubric, minimum practical effect, sample/stop rule, and analysis
method before exposure; accessibility and recovery retain the Slice 2 guardrail.

The required artifact is `thread-memory-analysis.v1`, owned by Product Analytics
with Product approval and QA verification. It must freeze the seven-day
eligibility query, context-restoration rubric, baseline, minimum practical
effect, minimum sample, stopping rule, confidence-interval rule, and rollback
trigger before Slice 3 exposure.

### Slice 4: cross-feature learning memory

Deliver FR-031–032. Exit when cross-feature events improve the next learning
action while duplicate attempts, silent mastery increases, and hidden source
origin remain zero in the tested corpus. The improvement metric, eligible
contribution types, denominator, minimum practical effect, and corpus size are
frozen before exposure.

The required artifact is `cross-feature-provenance-analysis.v1`, owned by Data/
Engineering with Product Analytics approval and QA corpus verification. It must
freeze eligible contribution types, next-action metric, denominator, minimum
practical effect, corpus size, duplicate-attempt test, and zero-silent-mastery
assertion before Slice 4 exposure.

### Slice 5: migration and general availability

Deliver FR-030 and FR-036: migration views, cost/performance controls, audits,
provider activation evidence, support/rollback runbooks, and cohort expansion.
GA requires all prior slice gates, no open authority or accessibility blocker,
and documented live-provider evidence distinct from deterministic local tests.
The GA evidence bundle must name the release owner, flag/rollback owner, support
owner, tested SHA, cohort steps, rollback triggers, provider quota/cost ceiling,
WCAG 2.2 AA audit result, security review result, and a minimum seven-day staged
soak with no unresolved severity-1/2 authority, data-loss, or accessibility issue.
Provider activation additionally requires an approved manifest with finite
request/response byte limits, token limit, timeout, concurrency, retry, daily
quota, and cost ceiling for every deployed boundary; unset values fail closed.
The manifest must be exercised by bounded-payload/timeout and redacted-log
fixtures and signed by Engineering and Product before cohort expansion.
Slice 5 owns general-availability activation approval and does not retroactively
authorize a Slice-1 pilot dispatch that lacked its required pilot manifest.

## Success metrics and countermetrics

### North-star

Weekly learners who complete a meaningful learning loop and later demonstrate
retained or transferable capability. `meaningful_loop_completed.v1` requires
`meaningful_activity_started.v1`, a meaningful response, and a completed
representative task or saved artifact. `retained_or_transferable.v1` requires
either an eligible seven-day unassisted transfer pass against the pinned rubric
or a versioned representative-task transfer pass defined by the intent's
completion contract. The weekly denominator is authenticated learners eligible
for the selected intent and evidence state during the reporting week; the
numerator is learners with both events in that week or its declared delayed
check window. The metric definition, query, and eligibility fixture are
immutable per version.

### Initial release metrics

- Ready-content first value: >=70% within 90 seconds.
- Meaningful-loop completion: >=60% of eligible pilot users.
- Self-reported usefulness: >=50% rate 4/5 or 5/5.
- Resume quality: report seven-day resume and context-restoration rates, but do
  not use them as a Phase 1 mastery claim.

### Later-slice metrics

- Representative-task performance, completion, and usefulness versus fixed
  continuation.
- Seven-day delayed unassisted retention only among eligible capabilities.
- Voluntary same-thread continuation after seven days versus current mission
  workspace.
- Cross-feature next-action improvement with zero duplicate-authority events.

### Countermetrics and hard guardrails

- Accessibility completion and recovery rates must not regress from the fixed
  continuation baseline.
- Authority violations, client-supplied scores, invalid evidence links, unsafe
  components/actions, duplicate attempts, and silent mastery increments: zero.
- Rollback must preserve accepted evidence, attempts, plans, mastery, revisions,
  and historical source origin.
- Provider ambiguity must remain explicitly reconciled; no ambiguous outcome may
  be treated as success.
- Monitor latency, provider error rate, cost/request, fallback rate, abandonment,
  and support contacts; time spent, clicks, DAU, streaks, and content views are
  not mastery proxies.

## Cross-cutting non-functional requirements

- **NFR-001 Authority:** All ownership, access, persistence, revision, scoring,
  mastery, lifecycle, idempotency, and reconciliation decisions are server-owned
  in Convex.
- **NFR-002 Determinism:** Activity validation and routing are versioned, replayable,
  and deterministic for identical pinned inputs; delayed checks have injectable
  clocks and DST-boundary coverage.
- **NFR-003 Safety:** Generated data is untrusted. Only registered primitives and
  exhaustively validated props render. No generated executable UI or direct
  client mutation/tool invocation is accepted.
- **NFR-004 Evidence:** Every factual claim is linked to accepted evidence or is
  labeled synthesis, inference, or unknown; unavailable/deleted evidence remains
  visible as an integrity state without exposing protected content.
- **NFR-005 Accessibility:** Every primitive has keyboard operation, semantic
  landmarks, visible focus, screen-reader status updates, reduced-motion behavior,
  non-color state labels, touch targets of at least 44 CSS pixels, and a
  deterministic text/card fallback. Mobile response state survives drawer/layout
  changes.
- **NFR-006 Performance:** Ready-content first value is <=90 seconds for >=70% of
  eligible pilot users. New-thread preparation is reported separately. Canvas
  render must not block response persistence or fallback display.
- **NFR-007 Resilience:** Provider/search failure, stale revisions, evidence
  invalidation, rejected components, timeout before/after commit, and rollback
  preserve accepted state and expose bounded recovery. No offline attempt is
  recorded as server-scored completion.
- **NFR-008 Privacy:** Provider payloads exclude private filenames/URLs, personal
  identifiers, secrets, tokens, unpublished notes, and unnecessary folder text;
  logs contain no raw query or result payload. Retention/deletion follows existing
  evidence and account-deletion contracts.
- **NFR-009 Observability:** All required events and decision logs carry schema,
  contract, and source versions; metric denominators are reproducible.
- **NFR-010 Compatibility:** V1 routes, V2 missions, upgraded states, cohort
  states, and rollback states remain usable and isolated during all slices.
- **NFR-011 Cost control:** First value does not require Calendar, live search, or
  a specific provider; provider usage is bounded, observable, and fails closed
  when policy/quota/reconciliation conditions are unsafe.

The implementation story for each provider boundary must set and test explicit
request bytes, response bytes, token, timeout, concurrency, daily quota, and cost
ceilings before activation; unset ceilings are default-deny. Account export and
deletion tests must enumerate every new adaptive table. Compatibility is proved
by the complete V1-only, V2-enabled, upgraded, adaptive-cohort, adaptive-disabled,
and global-rollback matrix. Metric reproduction from the immutable event ledger
must yield the same numerator and denominator for the same definition version.

## Data, rollout, and safety constraints

- Additive storage only; do not merge V1, V2, and thread authority in the first
  release.
- Pin blueprint/content/evidence/rubric/scorer/verifier/activity revisions for
  every persisted attempt and historical claim.
- Feature flags must support V1-only, V2-enabled, upgraded, cohort-enabled, and
  rollback states with no data loss.
- Upgrade copies compatible title/source/preferences only; it never infers
  evidence acceptance, mastery, or schedules.
- Composition changes only at explicit activity boundaries.
- Source deletion/invalidation purges protected excerpts and marks historical
  citations unavailable without rewriting completed attempt history.
- Provider timeouts before and after authoritative commit require idempotent
  reconciliation; ambiguous outcomes remain non-success until resolved.
- Deterministic local adapters prove application behavior only. Live provider,
  Calendar, search, and production activation require separate evidence.

## Dependencies

- Existing Convex Learn V2 ownership, lifecycle, evidence, scoring, mastery,
  idempotency, and revision contracts.
- Existing ready V2 session evidence/content/scoring for Slice 1.
- Existing Nuxt Learn routes/components, auth, folder/document infrastructure,
  feature flags, and browser/component/Convex test harnesses.
- Existing provider/search boundaries and evidence deletion/retention behavior.
- Chat, Quiz, Flashcards, Podcast, and document event surfaces for Slice 4.
- Pilot instrumentation, cohort assignment, accessibility/security review, and
  production provider activation evidence for Slice 5.

## Risks and mitigations

| Risk | Mitigation / release condition |
| --- | --- |
| Fast value bypasses authority | Slice 0 authority tests and server-only scoring are mandatory before adaptive routing. |
| Generated UI becomes unsafe or untestable | Allowlisted primitives, strict schemas, semantic state, deterministic fallback, rejection tests. |
| Learners receive unsupported factual claims | Accepted evidence links, source drawer, explicit gap/unknown states, evidence invalidation handling. |
| Adaptation optimizes clicks instead of capability | Representative tasks, delayed checks, north-star metric, hard countermetrics. |
| Thread memory duplicates V2 authority | Reference existing V2 records first; additive aggregate and idempotent provenance rules. |
| New experience breaks legacy Learn | Entitlement-aware coexistence, isolation tests, immediate rollback, no destructive migration. |
| Provider failure loses work or creates duplicate attempts | Bounded retries, idempotency, commit-boundary timeout tests, reconciliation state. |
| Preferences overfit or restrict opportunity | Explicit overrides, mutable intent, bounded memory controls, no permanent exclusion. |
| Seven-day claims are overstated | Eligibility gating, deterministic clock seams, DST tests, separate live retention evidence. |
| Pilot metrics are not reproducible | Versioned event schemas, formulas, denominators, and pre-registered analysis plans. |

## Assumptions and deferred activation decisions

- The initial cohort remains authenticated adults with existing folder/document
  infrastructure; expansion requires a new product and safety review.
- Exact provider payload/quota/cost numbers are deployment decisions, but are
  mandatory, tested, default-deny activation inputs rather than open code design.
- Experiment effect sizes and sample/stop rules are frozen in a versioned analysis
  artifact before each later-slice exposure; creating that artifact is part of
  the slice backlog and the gate cannot be waived.
- Live provider, Calendar, search, accessibility-technology, and production soak
  evidence remains distinct from deterministic local validation.

| ID | Assumption/deferred decision | Owner | Required by | Evidence/revisit | Blocking status |
| --- | --- | --- | --- | --- | --- |
| A-001 | Initial cohort is authenticated adults with existing folder/document access. | Product | Slice 1 | Cohort manifest and safety review | Blocking for pilot |
| A-002 | Provider byte/token/timeout/quota/cost ceilings are deployment-specific but finite and default-deny. | Engineering | Slice 1 pilot / Slice 5 GA | Signed pilot manifest for V2-backed pilot dispatch; signed GA activation manifest and fixtures | Blocking for provider dispatch and GA activation |
| A-003 | Adaptive experiment thresholds and stop rules are frozen before exposure. | Product Analytics | Slice 2 | `adaptive-routing-analysis.v1` approval | Blocking for Slice 2 |
| A-004 | Seven-day memory comparison uses a pre-registered eligible cohort and rubric. | Product Analytics | Slice 3 | `thread-memory-analysis.v1` approval | Blocking for Slice 3 |
| A-005 | Cross-feature provenance corpus and duplicate-attempt assertions are frozen before exposure. | Data/Engineering | Slice 4 | `cross-feature-provenance-analysis.v1` approval | Blocking for Slice 4 |
| A-006 | Live-provider, accessibility-technology, and production-soak evidence cannot be represented by local deterministic tests. | QA | Slice 5 | GA evidence bundle and seven-day soak | Blocking for GA |

## Implementation-readiness and traceability

The implementation backlog shall decompose every FR, NFR, and UJ into stories
with an explicit slice, code owner surface (schema/API/component/operations), and
automated or activation-evidence test. The backlog coverage map must list every
FR, every NFR, and every UJ exactly once as a primary trace row. A row may link
supporting stories, but no requirement may be represented only by a range or
implicitly by a phase heading. Each row must include `requirement_id`, `uj_id`
(or `none` with rationale), primary story ID, slice, owner, implementation
surface, acceptance-test/fixture ID, evidence artifact, and dependency IDs. A
planning linter or CI check must fail on missing IDs, duplicate primary
ownership, unresolved requirement IDs, or stories whose slice is disallowed by
the release-scope legend.

| Trace target | Required evidence |
| --- | --- |
| FR-001–006 | Learning Home/first-value component tests and browser journey |
| FR-007–015 | Thread/canvas contracts, registry tests, renderer/fallback/accessibility tests |
| FR-016–025 | Convex authority, revision, scoring, provider, and recovery tests |
| FR-026–032 | Thread lifecycle, memory/privacy, migration, provenance, and duplicate-attempt tests |
| FR-033–036 | Event schema fixtures, metric queries, experiment analysis, rollout/runbook evidence |
| NFR-001–011 | Security, accessibility, performance, resilience, privacy, and compatibility evidence |

There is no unresolved product-scope blocker for Slice 0/1. Later slices have
explicit, owned phase-entry blockers in A-002–A-006; their analysis plans and
activation evidence must be approved before exposure. Remaining implementation
work is story-decomposable and decision-bounded by this PRD: schema/API details
must conform to the stated authority and additive-storage constraints, and
live-provider evidence is a separate gate from local deterministic validation.
