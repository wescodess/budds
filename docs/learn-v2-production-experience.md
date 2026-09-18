# Learn Anything V2 production experience

**Status:** implementation contract  
**Owns:** user-facing Learn hub, Learning Mission workspace, Session Void, and browser acceptance path

## Product shape

Learn Anything V2 is a durable learning workspace, not a generated document or a setup wizard. A learner creates a folder-linked **Learning Mission**, approves the evidence Budds may teach from, shapes a capability map, calibrates existing knowledge, accepts a feasible plan, and returns to the same workspace until capabilities are retained.

The experience has three complementary surfaces:

1. **Learn Hub** — the learner's next meaningful action, active missions, and upcoming sessions.
2. **Learning Mission workspace** — the enduring home for outcome, evidence, map, plan, and progress.
3. **Session Void** — a distraction-free active-learning session with evidence-backed feedback.

The UI follows `DESIGN.md`: Warm Focus, dark stone surfaces, restrained amber, border-based elevation, visible evidence, and no gamification or guilt loops.

## Information architecture

| Surface | Route | Purpose |
| --- | --- | --- |
| Learn Hub | `/app/learn` | Next action, active missions, upcoming sessions, create entry |
| Create mission | `/app/learn/create` | Outcome-led setup with folder context |
| Mission overview | `/app/learn/[learningVoidId]` | Readiness, next action, evidence health, schedule, progress |
| Sources | `/app/learn/[learningVoidId]/sources` | Grouped evidence review, source inspection, gaps |
| Learning map | `/app/learn/[learningVoidId]/map` | Milestones, objectives, prerequisites, evidence coverage |
| Calibration | `/app/learn/[learningVoidId]/calibration` | Three to seven cold attempts and confidence ratings |
| Plan | `/app/learn/[learningVoidId]/plan` | Feasibility, timeline, availability, acceptance, reflow |
| Progress | `/app/learn/[learningVoidId]/progress` | Capability states, retained reviews, attempt history |
| Session Void | `/app/learn/[learningVoidId]/sessions/[studySessionId]` | Retrieval-to-feedback mastery session |

Folder Learn pages link to creation with the folder preselected. A V1 upgrade navigates directly to the created mission. Today links back to the owning mission.

## Experience contract

### Learn Hub

- The first card always offers a useful action: start, resume, review, finish setup, resolve a blocker, or view the accepted plan.
- Empty state offers **Create a learning plan**; it never ends at “nothing scheduled.”
- Mission cards identify the outcome, folder, next action, feasibility, and capability-state distribution.
- Progress is never represented by a writable or misleading completion percentage.

### Outcome canvas

- Starts with the outcome the learner wants to understand, prepare for, or apply.
- Reveals mode, depth, target date, study rhythm, source policy, and accessibility preferences progressively.
- Shows a plain-language assumptions summary and field-specific validation.
- Draft work is safe to leave and resume. The primary action is specific: **Find evidence for this mission**.

### Evidence desk

- Keeps folder documents, user URLs, open databases, and web research visibly separate.
- States that nothing becomes teaching material until the learner accepts it.
- Each source exposes origin, publisher, retrieval time, rights/access state, objective coverage, and inspectable evidence or locator.
- Search snippets are labelled discovery-only.
- Gaps name the affected capability and offer a constructive resolution. Generation never silently crosses an evidence gap.

### Learning trail

- Defaults to an accessible outline of milestone and capability cards; a graph may supplement but never replace it.
- Every objective exposes effort, assessment contract, prerequisites, evidence support, and coverage.
- Keyboard controls provide alternatives to drag interactions.
- Edits create a draft revision and explain their effect on future incomplete sessions. Completed work remains pinned.

### Warm-start calibration

- Explicitly says calibration personalizes the plan and cannot award retained mastery.
- Presents one cold attempt at a time, followed by confidence.
- Debrief communicates plan changes, provisional knowledge, and misconceptions without gamified scoring.
- Attempts are scored by server authority; clients never submit authoritative scores.

### Study rhythm

- Shows total effort, weekly load, target-date feasibility, buffer/rest blocks, and the next two to four weeks.
- Feasibility failures offer concrete alternatives such as a later date, one more slot, shorter depth, or fewer capabilities.
- Editing creates a preview diff before acceptance.
- The in-app plan is complete without Google Calendar. Calendar is an optional projection and external changes require reconciliation.

### Mission home and progress

- Shows one **Now** action, one **Coming up** item, evidence health, and capability-state distribution.
- Capability states are `Not started → Learning → Guided → Independent → Retained`, with `Provisionally known`, `Needs review`, and `Blocked` explained separately.
- Retained means a delayed unassisted pass, never calibration or section completion.
- Historical attempts keep their pinned blueprint, content, evidence, rubric, and verifier revisions.

### Session Void

- Uses one calm reading/task column with a minimal header, stage progress, and a safe exit.
- Preserves retrieval, prediction, teaching, fading, transfer, confidence, feedback, and next-review behavior.
- Hint and reveal actions explain that the attempt will remain guided before use.
- Teaching and feedback expose source citations without making the learner lose their place.
- Completion names what was demonstrated, misconceptions, capability state, and exact next review.

## Recovery and accessibility

- Provider or search outage preserves accepted local/open evidence and offers a bounded retry or URL path.
- Revision conflicts refetch and compare; they never silently overwrite the learner's work.
- Missed sessions propose the smallest useful reflow and list changed sessions.
- Calendar revocation never damages the in-app plan.
- Offline server-scored attempts are not queued as completed.
- All workflows are keyboard operable, have visible focus, semantic landmarks, labelled status updates, non-color state labels, and reduced-motion behavior.
- Graph relationships have equivalent text. Mobile controls are at least 44px and contextual inspectors become drawers.

## Browser acceptance journey

A clean, isolated browser run must use production UI and public Convex commands only:

1. Authenticate as a disposable test learner.
2. Open Learn, choose a real owned folder, and create a mission.
3. Define the outcome, mode, depth, source policy, and study rhythm.
4. Review and accept deterministic contract-valid evidence.
5. Generate, edit, and accept the learning trail.
6. Complete server-scored calibration.
7. Preview and accept a feasible plan.
8. Start the ready session from Today or the mission home.
9. Complete the active-learning loop and submit an independent response.
10. Observe grounded feedback, the capability transition, and next review.

External systems use guarded local adapters in browser tests. No test may insert Learn V2 rows directly, invoke internal commands from the browser, spend provider quota, or imply that a deterministic adapter proves live Google, Tavily, or model-provider readiness.

## Release gates

- Component tests exercise user-observable intent and recovery states through component interfaces.
- Convex tests exercise public commands, owner scoping, idempotency, revision conflicts, and bounded reads.
- Browser E2E proves the full acceptance journey in an isolated deployment.
- Production-like smoke tests separately verify configured provider adapters.
- Keyboard, reduced-motion, responsive, contrast, and screen-reader checks are recorded before general availability.
