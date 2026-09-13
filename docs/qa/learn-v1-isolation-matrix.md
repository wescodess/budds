# Learn Anything V1 Baseline and V2 Isolation Matrix

**Status:** LA2-00 executable baseline

**Scope:** Legacy courses only

**Canonical V2 specification:** [GitHub issue #180](https://github.com/wescodess/budds/issues/180)

**Implementation ticket:** [LA2-00](https://github.com/wescodess/budds/issues/162)

This matrix freezes the Learn Anything V1 contract while V2 is built additively. A
characterized defect is evidence of current V1 behavior, not permission to copy it
into V2. LA2-00 does not add V2 routes, tables, feature flags, jobs, or dual writes.

## Isolation rules

1. V1 continues to use `courses`, `courseSections`, `courseSourceDocs`, legacy
   review records, and course-owned calendar events.
2. V2 must use additive routes, tables, jobs, and projections. V1 commands must
   not write V2 state, and V2 commands must not mutate V1 state.
3. A future legacy upgrade may copy only the title, current source identities,
   and compatible preferences into a new draft Learning Void. It must not infer
   source acceptance, blueprint approval, attempts, mastery, or schedule state.
4. The original course remains unchanged after an upgrade. Deleting either
   aggregate must not delete the other.
5. Rollback disables V2 entry and new V2 job admission while V1 remains fully
   operational. Existing V2 records remain available for export, deletion, and
   a later resume.

## Executable baseline

| Surface | Frozen V1 behavior | Characterization evidence | V2 isolation boundary |
| --- | --- | --- | --- |
| Creation and source selection | A folder-backed course creates a legacy course, source rows, outline task, and Learn profile. No selection means direct documents in the chosen folder, capped at 100. `web-only` forces `webSearchEnabled`. **Characterized defects:** selected folder IDs affect the UI count but are omitted from submission; any explicitly selected same-owner document is accepted and its real folder identity is replaced by the selected course folder. | [`source-selector.test.ts`](../../tests/component/learn/source-selector.test.ts), [`course-creator.test.ts`](../../tests/component/learn/course-creator.test.ts), [`courses.test.ts`](../../convex/courses.test.ts) | V1 creation must not create Learning Voids, blueprints, source snapshots, mastery attempts, study plans, V2 sessions, or V2 jobs. V2 creation must not call `courses.create` or create legacy outline tasks. |
| Retrieval fallback | Outline generation searches stored folder/document scope first. **Characterized defect:** an empty scoped outline search retries across all of the user's indexed documents without folder or document filters. Section generation retains document IDs in its fallback, but an empty result can still continue to model generation. | [`generate-outline.post.test.ts`](../../server/api/course/generate-outline.post.test.ts), [`generate-section.post.test.ts`](../../server/api/course/generate-section.post.test.ts) | V2 retrieval may use only its authorized, immutable source manifest. Missing evidence becomes an explicit gap or blocked state; it must never broaden into unrelated V1 documents. |
| Web and model fallback | **Characterized defects:** `webSearchEnabled` is stored but does not perform general-web retrieval; `web-only` outline generation asks the model to use its own knowledge; an empty document retrieval can publish section text generated from a synthetic topic sentence. | [`generate-outline.post.test.ts`](../../server/api/course/generate-outline.post.test.ts), [`generate-section.post.test.ts`](../../server/api/course/generate-section.post.test.ts) | Model memory, synthetic topic text, and search snippets are not V2 evidence. Unsupported V2 teaching, feedback, or assessment content stays unpublished. |
| Outline editing | Titles and knowledge types are edited directly; sections can be added, removed, and reordered; the mutable embedded course outline is updated in place. | [`outline-editor.test.ts`](../../tests/component/learn/outline-editor.test.ts), [`courseSections.test.ts`](../../convex/courseSections.test.ts) | V1 edits cannot mutate a V2 learning map. V2 semantic edits fork a draft revision; accepted revisions remain immutable. |
| Generation and prefetch | Starting a course moves only its first section to `generating`, creates one legacy `section-generate` task, and starts one generation request. The current section may trigger exactly the following ordinal section; ready, completed, or already-generating sections are skipped, and a failed section has one bounded retry. | [`start-learning-button.test.ts`](../../tests/component/learn/start-learning-button.test.ts), [`courses.test.ts`](../../convex/courses.test.ts), [`courseSections.test.ts`](../../convex/courseSections.test.ts) | Preserve current-plus-one prefetch as product behavior, but legacy tasks/endpoints must not generate V2 sessions and V2 jobs must not change course-section state. |
| Completion, mastery, and review | Completing a ready section stores a clamped client score, increments course completion once, and advances the legacy review state machine. **Characterized defect:** the client supplies 100% when no quiz was completed, and the server accepts that score as authoritative. | [`section-page-completion.test.ts`](../../tests/component/learn/section-page-completion.test.ts), [`courseSections.test.ts`](../../convex/courseSections.test.ts), [`section-completion-card.test.ts`](../../tests/component/learn/section-completion-card.test.ts), [`review-session-progress.test.ts`](../../tests/component/learn/review-session-progress.test.ts) | V1 completion, review history, and scores cannot create V2 attempts or mastery. V2 mastery is server-derived from its own append-only attempts and pinned rubrics. |
| Offline | Only completed V1 sections produce cache payloads. Legacy cached content and queued attempts are keyed by course/section identity and replay only through legacy review commands. | [`courseSections.test.ts`](../../convex/courseSections.test.ts), [`offline-cache.test.ts`](../../tests/component/learn/offline-cache.test.ts), [`offline-attempts.test.ts`](../../tests/component/learn/offline-attempts.test.ts), [`offline-sync.test.ts`](../../tests/component/learn/offline-sync.test.ts) | V1 remains readable and playable offline under every future V2 flag state. V1 queued attempts must never replay into V2 mastery; V2 offline data requires an explicit versioned identity before beta hardening. |
| Calendar | Calendar storage, sync, missed-session handling, and deep links are course-owned. Disconnect preserves provider-first deletion and keeps credentials until cleanup succeeds. **Characterized limitation:** there is no V2 session identity, FreeBusy planning, or external edit/delete reconciliation. | [`calendarEvents.test.ts`](../../convex/calendarEvents.test.ts), [`calendarConnections.test.ts`](../../convex/calendarConnections.test.ts), [`calendarEventCleanup.test.ts`](../../convex/calendarEventCleanup.test.ts), [`calendar-connection-card.test.ts`](../../tests/component/learn/calendar-connection-card.test.ts) | V2 sessions cannot appear in V1 course events or be inferred from them. V2 Calendar stays behind its separate later-phase admission gate; V1 sync and disconnect remain available. |
| Course and account deletion | Course deletion is owner-scoped, durable, and provider-first for calendar events before the legacy local cascade. Account deletion explicitly removes V1 Learn rows without crossing user ownership. | [`courses.test.ts`](../../convex/courses.test.ts), [`course-delete.atdd.test.ts`](../../tests/component/learn/course-delete.atdd.test.ts), [`accountDeletion.test.ts`](../../convex/accountDeletion.test.ts), [`learnSchema.test.ts`](../../convex/learnSchema.test.ts) | Course deletion cannot follow V2 references or delete an upgraded Learning Void. Every future V2 table/job must join account deletion in the same schema slice that introduces it. |
| Export | The authenticated export explicitly enumerates legacy courses and sections; source rows use an owner-checked course child page; calendar credentials are omitted. Pagination is bounded. | [`dataExport.test.ts`](../../convex/dataExport.test.ts), [`learnSchema.test.ts`](../../convex/learnSchema.test.ts), [`me.get.test.ts`](../../server/api/export/me.get.test.ts) | V1 export stays stable. Future V2 collections must be explicit, separately identifiable, and exportable during V2 rollback without being merged into legacy course records. |

## Required cross-state results

| State | V1 result | V2 result |
| --- | --- | --- |
| Unflagged | All characterized V1 reads, writes, generation, review, offline, calendar, deletion, and export remain available. | No V2 route visibility, read, write, or job admission. |
| Flagged, not upgraded | V1 behavior and records are unchanged. | V2 uses only additive surfaces; no dual write. |
| Explicitly upgraded | Original V1 course remains unchanged and independently operable. | A new draft copies only the migration allowlist; no V1 completion, review, mastery, or calendar state is inferred. |
| Rollback | All characterized V1 behavior remains available. | Entry and new job admission stop; existing records remain available only for export, deletion, and later resume. |

The flagged, upgraded, and rollback rows become executable feature-gate fixtures
in LA2-02, once those runtime surfaces exist. Until then, this matrix is the
denial contract: later tickets must extend the suite without weakening any V1
characterization above.

## Verification

Run the complete repository gate before merging:

```bash
pnpm verify
```

For a fast LA2-00 loop, run the owning suites directly:

```bash
pnpm exec vitest run \
  convex/courses.test.ts \
  convex/courseSections.test.ts \
  convex/learnSchema.test.ts \
  convex/dataExport.test.ts \
  convex/accountDeletion.test.ts \
  convex/calendarEvents.test.ts \
  convex/calendarConnections.test.ts \
  convex/calendarEventCleanup.test.ts \
  server/api/course/generate-outline.post.test.ts \
  server/api/course/generate-section.post.test.ts \
  server/api/export/me.get.test.ts

pnpm exec vitest run --config vitest.config.component.ts \
  tests/component/learn/source-selector.test.ts \
  tests/component/learn/course-creator.test.ts \
  tests/component/learn/outline-editor.test.ts \
  tests/component/learn/start-learning-button.test.ts \
  tests/component/learn/section-page-completion.test.ts \
  tests/component/learn/section-completion-card.test.ts \
  tests/component/learn/offline-cache.test.ts \
  tests/component/learn/offline-attempts.test.ts \
  tests/component/learn/offline-sync.test.ts \
  tests/component/learn/calendar-connection-card.test.ts \
  tests/component/learn/course-delete.atdd.test.ts
```
