# Adaptive Routing Analysis v1

**Status:** DRAFT — UNAPPROVED; exposure blocked

**Scope:** Slice 2 / Story 3.7, adaptive routing versus fixed continuation
**Approval gate:** Product Analytics approval, with Product as approver, before any experiment exposure.

This plan specifies the decision contract for the Slice 2 experiment. Required evidence and approval values are not present in the repository; no numeric baseline, effect size, sample size, or stop boundary is inferred here. Keep adaptive exposure disabled until Product Analytics supplies and freezes those values and Product approves this version.

| Decision field | Draft contract | Approval state |
| --- | --- | --- |
| Comparison | Server-assigned adaptive routing versus one frozen fixed-continuation policy. Freeze the policy/version and implementation before exposure. | Policy/version: **UNKNOWN — UNAPPROVED** |
| Primary outcome | Representative-task performance: proportion of eligible assigned learners who complete the versioned representative task with a server-scored pass under its pinned rubric in the declared outcome window. Completion without a pass is not a success. | Task, rubric, scorer, window, and exact event/query: **UNKNOWN — UNAPPROVED** |
| Eligibility and denominator | Include only authenticated learners for whom the selected intent, evidence state, and all safety prerequisites permit both assigned paths. Exclude users missing prerequisites before assignment and record versioned eligibility/exclusion reasons. Denominator: eligible learners assigned to each arm; proposed intent-to-treat analysis retains assigned learners regardless of completion or override. | Exact eligibility query, exclusions, assignment unit, and denominator: **UNKNOWN — UNAPPROVED** |
| Baseline | Estimate the primary-outcome rate on the fixed-continuation arm using the same eligibility, rubric, scorer, and outcome window. | Approved baseline rate/source and freeze date: **UNKNOWN — UNAPPROVED** |
| Minimum practical effect | Adaptive arm must improve the primary outcome over fixed continuation by at least the pre-approved minimum practical effect. | Effect threshold and scale (absolute or relative): **UNKNOWN — UNAPPROVED** |
| Sample and stopping | Do not inspect for a success decision before the approved minimum sample in each arm. Stop at the pre-approved sample or time boundary; define handling for incomplete enrollment and safety stops before exposure. | Minimum sample, time boundary, interim-look policy, and incomplete-sample rule: **UNKNOWN — UNAPPROVED** |
| Confidence rule | Report the arm difference and its two-sided 95% confidence interval. Proposed qualification rule: the interval's lower bound must exceed the approved minimum practical effect; Product Analytics must confirm the interval method and decision rule. | Method and rule: **UNKNOWN — UNAPPROVED** |
| Guardrails | Report accessibility-completion and recovery-success rates separately by arm against fixed continuation. A decline of **more than 3 percentage points** in either guardrail makes the cohort non-qualifying and emits the rollback trigger, independently of the primary outcome. | QA verifies instrumentation and evidence. Whether uncertainty bounds also gate guardrails: **UNKNOWN — UNAPPROVED** |
| Owners | Product Analytics: analysis owner and pre-registration; Product: approval and go/no-go; QA: accessibility/recovery verifier; Engineering: replay-log and event integrity owner. | Named accountable individuals and approval record: **UNKNOWN — UNAPPROVED** |
| Rollback | Disable adaptive exposure and return eligible traffic to fixed continuation if either guardrail declines by more than 3 percentage points, or if assignment, safety-prerequisite, or telemetry integrity fails. Preserve accepted learner evidence and state. | Operational trigger evaluator, monitoring window, response SLO, and rollback runbook: **UNKNOWN — UNAPPROVED** |

Assignment and telemetry must be server-owned and stable for the approved assignment unit. Events carry cohort, eligibility/exclusion, and contract versions and omit raw answers, source payloads, private locators, and provider payloads. Tests may exercise routing/assignment and owner-visible event/analysis APIs plus the internal guardrail evaluator without enabling exposure; these tests do not constitute approval or experiment evidence.

Implementation status: the assignment endpoint is default-off and does not route learner activity to either arm. An internal evaluator can persist a versioned, digest-bound guardrail snapshot; a strict >3-point accessibility or recovery decline creates a sticky rollback record that blocks later assignment attempts. Assignment and exclusion events are owner-scoped and bounded, and assignment records participate in owner export and account deletion. Disabled calls create no experiment event. This is synthetic mechanics only: the evaluator accepts internally supplied aggregate counts and does not independently establish their provenance; no live exposure, automated alert, primary-outcome qualification, or production rollback has been verified. The actual eligibility definition, assignment unit, statistical boundaries, approval evidence, and operational runbook remain pending.

## Approval record

- Product Analytics approval and frozen values: **PENDING**
- Product approval: **PENDING**
- QA guardrail verification: **PENDING**
- Engineering replay/telemetry verification: **PENDING**
- Exposure state: **BLOCKED / DEFAULT-OFF**

**Source contract:** Adaptive Learn PRD, Slice 2 and assumption A-003; Story 3.7 acceptance criteria in `epics.md`. Update this version before exposure if any approved decision changes.
