# Adaptive Routing Analysis v1

**Status:** DRAFT — UNAPPROVED; exposure blocked

**Scope:** Slice 2 / Story 3.7, adaptive routing versus fixed continuation
**Approval gate:** Product Analytics approval, with Product as approver, before any experiment exposure.

This plan specifies the decision contract for the Slice 2 experiment. Required evidence and approval values are not present in the repository; no numeric baseline, effect size, sample size, or stop boundary is inferred here. Keep adaptive exposure disabled until Product Analytics supplies and freezes those values and Product approves this version.

| Decision field | Draft contract | Approval state |
| --- | --- | --- |
| Comparison | Server-assigned adaptive routing versus one frozen fixed-continuation policy. Freeze the policy/version and implementation before exposure. | Policy/version: **UNKNOWN — UNAPPROVED** |
| Primary outcome | Representative-task performance: proportion of eligible assigned learners who complete the versioned representative task with a server-scored pass under its pinned rubric in the declared outcome window. Completion without a pass is not a success. | Task, rubric, scorer, window, and exact event/query: **UNKNOWN — UNAPPROVED** |
| Eligibility and denominator | Supported mechanics: `learn-adaptive.experiment-eligibility.v1`, assignment unit `authenticated_learner`, keyed by server-derived `tokenIdentifier`. Live safety prerequisites must pass before assignment; exclusions use `learn-adaptive.experiment-exclusion.v1`. Proposed denominator: eligible learners assigned to each arm, retained regardless of completion or override. | Product Analytics approval of exact population, eligibility/exclusion definitions, denominator query/version, and intent-to-treat rule: **UNKNOWN — UNAPPROVED** |
| Baseline | Estimate the primary-outcome rate on the fixed-continuation arm using the same eligibility, rubric, scorer, and outcome window. | Approved baseline rate/source and freeze date: **UNKNOWN — UNAPPROVED** |
| Minimum practical effect | Adaptive arm must improve the primary outcome over fixed continuation by at least the pre-approved minimum practical effect. | Effect threshold and scale (absolute or relative): **UNKNOWN — UNAPPROVED** |
| Sample and stopping | Do not inspect for a success decision before the approved minimum sample in each arm. Stop at the pre-approved sample or time boundary; define handling for incomplete enrollment and safety stops before exposure. | Minimum sample, time boundary, interim-look policy, and incomplete-sample rule: **UNKNOWN — UNAPPROVED** |
| Confidence rule | Report the arm difference and its two-sided 95% confidence interval. Proposed qualification rule: the interval's lower bound must exceed the approved minimum practical effect; Product Analytics must confirm the interval method and decision rule. | Method and rule: **UNKNOWN — UNAPPROVED** |
| Guardrails | Report accessibility-completion and recovery-success rates separately by arm against fixed continuation. A decline of **more than 3 percentage points** in either guardrail makes the cohort non-qualifying and emits the rollback trigger, independently of the primary outcome. | QA verifies instrumentation and evidence. Whether uncertainty bounds also gate guardrails: **UNKNOWN — UNAPPROVED** |
| Owners | Product Analytics: analysis owner and pre-registration; Product: approval and go/no-go; QA: accessibility/recovery verifier; Engineering: replay-log and event integrity owner. | Named accountable individuals and approval record: **UNKNOWN — UNAPPROVED** |
| Rollback | Disable adaptive exposure and return eligible traffic to fixed continuation if either guardrail declines by more than 3 percentage points, or if assignment, safety-prerequisite, or telemetry integrity fails. Preserve accepted learner evidence and state. The implemented guardrail evaluator persists an explicit rollback signal; operational delivery remains pending. | Monitoring window, delivery/response SLO, integrity-failure handling, and rollback runbook: **UNKNOWN — UNAPPROVED** |

Assignment is server-owned and stable per authenticated learner and analysis version. Unsupported eligibility versions or assignment units are rejected when freezing a plan and excluded at assignment. Product Analytics must approve the exact population and denominator within the supported mechanics; a population or unit requiring unsupported behavior needs a code and plan revision. Events carry cohort, eligibility/exclusion versions, assignment unit, and contract versions; assignment exports retain their eligibility version and unit. Telemetry omits raw answers, source payloads, private locators, and provider payloads.

The read-only safety predicate checks current boundaries and excludes missing or foreign activity/source records and invalid live evidence. Standalone threads require an initial boundary or an operable completed diagnostic. V2 threads require a ready or valid feedback Canvas with current pins, replay and claim authority, accepted sources with permitted rights, clear conflicts, matching revisions, and no purge; feedback also requires representative completion and matching mastery evidence. These checks establish supported safety mechanics, not approval of an experimental population.

Implementation status: the assignment endpoint is default-off and does not route learner activity to either arm. Disabled calls create no experiment event. Assignment/exclusion events are owner-scoped and bounded; assignments participate in owner export and account deletion. An internal evaluator persists versioned, digest-bound guardrail snapshots. A strict >3-point accessibility or recovery decline marks the cohort non-qualifying independently of the primary outcome and creates a sticky `learn-adaptive.experiment-rollback-signal.v1` record: action `disable_adaptive_exposure`, cohort `adaptive`, delivery `pending`. It blocks later assignments and is exposed by evaluator results, owner guardrail status, and the internal `getRollbackSignal` consumer query.

This is synthetic mechanics only. Internally supplied aggregate counts and digest/source labels do not independently establish evidence provenance. No alert delivery, live experiment, primary-outcome qualification, or production rollback has been verified. Statistical values, named owners, exact population/denominator approval, approval evidence, and the operational runbook remain **UNKNOWN — UNAPPROVED**. Tests of these mechanics do not constitute approval or experiment evidence.

## Approval record

- Product Analytics approval and frozen values: **PENDING**
- Product approval: **PENDING**
- QA guardrail verification: **PENDING**
- Engineering replay/telemetry verification: **PENDING**
- Exposure state: **BLOCKED / DEFAULT-OFF**

**Source contract:** Adaptive Learn PRD, Slice 2 and assumption A-003; Story 3.7 acceptance criteria in `epics.md`. Update this version before exposure if any approved decision changes.
