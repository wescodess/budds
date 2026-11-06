# Phase B Void naming and route inventory

This records B5 (#401) on the integration branch for [#394](https://github.com/wescodess/budds/issues/394).
The normative contracts are the superseding [rename resolution](https://github.com/wescodess/budds/issues/358#issuecomment-6651400245)
and [V1 exit checks](https://github.com/wescodess/budds/issues/378#issuecomment-6652055956).
The final verification head, command results and CI evidence are recorded on [PR #489](https://github.com/wescodess/budds/pull/489).
This inventory does not claim a review-gate pass.

## Scope and reproduction

The source inventory covers runtime application, shared, server, Convex, worker
and script files. Tests and generated files are excluded from the naming search;
their historical fixtures and internal identifiers are not learner copy. The
[complete remaining-hit ledger](phase-b-void-name-inventory.tsv) records every
matched source line and its reason for remaining. Reproduce it with:

```sh
rg --no-heading --sort path -n -i '\b(threads?|missions?)\b' \
  app convex server shared workers scripts \
  -g '!*.test.*' -g '!**/_generated/**' -g '!**/node_modules/**' \
  -g '!**/pnpm-lock.yaml' -g '!**/package-lock.json' -g '!**/uv.lock'
```

A supplemental V1 sweep uses the same roots and exclusions with
`\b(courses?)\b`. Inspect rendered template text, accessible attributes,
script string literals and server presentation fields separately from internal
identifiers, learner titles, generation prompts and diagnostics. The fixed V1
labels found by that sweep, and their follow-up resolution, are listed below.

The `thread`/`mission` sweep finds no missed fixed presentation label beyond the
owner-reserved sentence at `app/pages/app/learn/index.vue:312`. Internal
`thread`/`mission` variables, tables, command/receipt diagnostics, authority
values, event names, selectors and storage keys remain unchanged. In particular,
`shared/learn-adaptive-completion.ts:15-17` keeps historical exact-match inputs
whose projected output says Void. Arbitrary learner/generated text and historical
records remain intact. Accepted B3 wording includes “Review this Void's sources”
and the “classic Voids” fallback.

## Fixed V1 labels found by B5 and resolved in the B4 follow-up

B5 found these labels at `42e2f65` and left them unchanged. The B4 follow-up
renamed each in `8f5b70b` (`fix(learn): name the remaining fixed V1 labels Void`),
with mounted, route or Convex assertions on the new text. These labels name the
V1 container inside its own flow, where no other study item is called a Void.
Line numbers are unchanged. Existing stored titles are not rewritten and no display-time mapping
of learner-titled records is added.

| File and line | Surface | Old label | New label | Status |
| --- | --- | --- | --- | --- |
| `app/components/learn/SourceSelector.vue:131` | V1 creation heading | “Create a Course” | “Create a Void” | Resolved in `8f5b70b` |
| `app/components/learn/SourceSelector.vue:143` | Review backlog warning | “…before starting new courses.” | “…before starting new Voids.” | Resolved in `8f5b70b` |
| `app/components/learn/SourceSelector.vue:201` | Empty-source state | “The course will be generated from web sources.” | “The Void will be generated from web sources.” | Resolved in `8f5b70b` |
| `app/components/learn/OutlineEditor.vue:202` | V1 outline heading | “Course Outline” | “Void Outline” | Resolved in `8f5b70b` |
| `app/components/learn/SectionVoidTopBar.vue:28` | Section back button accessible name | “Back to course” | “Back to Void” | Resolved in `8f5b70b` |
| `app/components/learn/SectionCompletionCard.vue:63` | Last-section completion title | “Course Complete!” | “Void Complete!” | Resolved in `8f5b70b` |
| `app/components/learn/SectionCompletionCard.vue:151` | Completion back button | “Back to Course Overview” | “Back to Void Overview” | Resolved in `8f5b70b` |
| `app/pages/app/folders/[id]/learn/[courseId]/[sectionId].vue:244` | Unavailable-section recovery | “Back to course” | “Back to Void” | Resolved in `8f5b70b` |
| `app/composables/useFolderPageContext.ts:181` | Client default for a new untitled V1 record | “Untitled Course” | “Untitled Void” | Resolved in `8f5b70b` |
| `convex/courses.ts:52` | Persisted default for a blank new title | “Untitled Course” | “Untitled Void” | Resolved in `8f5b70b` |
| `convex/reviewItems.ts:147` | Review fallback when the parent is absent, shown by `ReviewCard.vue:57` | “Unknown Course” | “Unknown Void” | Resolved in `8f5b70b` |

## Folder-scoped V1 labels deferred to #399

`8f5b70b` also renamed the labels below, but in folders “Void” already names
every study item: the rail's “Voids” section lists chats, flash cards, audio
overviews, quizzes and courses, and the create dialog offers “Create chat void”
through “Create course void”. Calling a course “Void” on the same screen is a
subtype collision, for example “No Voids in this folder yet.” beside a rail that
lists three Voids, or a “Void deleted” toast for a record badged “Course”. Stage B
restored the base `22d323b` text in
`fix(learn): keep folder-scoped course labels for the owner wording decision`,
with the mounted assertions pinning the restored text, and left the wording to
the owner in #399.

| File and line | Surface | Current label | Reverted label | Status |
| --- | --- | --- | --- | --- |
| `app/pages/app/folders/[id]/learn/index.vue:32` | Folder Learn subheading | “Courses in this folder” | “Voids in this folder” | Restored in Stage B; deferred to #399 |
| `app/pages/app/folders/[id]/learn/index.vue:44` | Folder Learn empty state | “No courses in this folder yet.” | “No Voids in this folder yet.” | Restored in Stage B; deferred to #399 |
| `app/pages/app/folders/[id]/learn/index.vue:51` | Folder Learn creation CTA | “Create a course from this folder” | “Create a Void from this folder” | Restored in Stage B; deferred to #399 |
| `app/pages/app/folders/[id]/learn/[courseId]/index.vue:46` | V1 overview back link | “Back to folder courses” | “Back to folder Voids” | Restored in Stage B; deferred to #399 |
| `app/pages/app/folders/[id].vue:140` | Deletion description | “…remove the course.” | “…remove the Void.” | Restored in Stage B; deferred to #399 |
| `app/pages/app/folders/[id].vue:161` | Deletion toast | “Course deleted” | “Void deleted” | Restored in Stage B; deferred to #399 |
| `app/components/folder-shell/FolderShellRail.vue:113` | Untitled V1 record fallback | “Course” | “Void” | Restored in Stage B; deferred to #399 |

The rail's compact-touch kind badge at `FolderShellRail.vue:333` still says
“Course” beside Chat, Flash cards, Audio Overview and Quiz. It names a subtype,
like the create dialog's Course option, so a literal swap would lose the
distinction; it is deferred with #399 rather than renamed here.

Dashboard “Your Courses,” course folders, general course-material prose and
“course corrections” refer to folders, educational material or ordinary language,
rather than the learning container. `OutcomeCanvas.vue:13` contrasts an outcome
with a course title; `LearningHome.vue:253` says a course is not a prerequisite.
Generation prompts remain unchanged. `calendarEvents.ts:700` is an operational
return message, not a rendered label; command errors and receipt contents remain
internal. These are separate from the fixed V1 findings above.

## Routes, reports and preserved contracts

The updated current route/naming documents are
`docs/learn-anything-adaptive-experience-plan.md` and the route/ownership section
of `_bmad-output/planning-artifacts/implementation-contracts.md`. Older research,
September architecture/UX artifacts, readiness notes and epics retain their
historical evidence; the current documents explicitly cite the superseding
resolutions.

Adaptive producers use `learnVoidRoute` and `/app/learn/void/:threadId`; the
legacy path and name remain redirect-only. V2 paths and children retain their
`learningVoids` authority. New V1 Calendar and Start Learning links use
`buildV1CoursePath` with the authoritative owned folder. Both adaptive entry
points and the named `app-learn` (`legacy=v2`) / `index` rollback destinations
must survive a compatible rollback.

The report inspection used:

```sh
rg --files scripts shared convex app | rg -i 'metric|report|analytic'
rg -n -i 'route|pathname|page_path|pagePath|groupBy|group.*path' \
  scripts shared -g '*metrics*' -g '!*.test.*'
rg -n 'posthog|page_path|pagePath|pathname|routeFamily|route_family|groupBy' \
  scripts shared app convex -g '!*.test.*' -g '!**/_generated/**'
```

No existing report groups adaptive visits by route. The first-value report in
`shared/learn-adaptive-metrics.ts` groups internal command/start opportunities by
owner, thread and opportunity ordinal; the operational/outcome registries and
`scripts/adaptive-learn-metrics.mjs` use pinned events and fixture identities,
not URL families. No normalization code is needed. Any future route-grouped
report must treat `/app/learn/thread/:threadId` and
`/app/learn/void/:threadId` as one logical adaptive denominator while retaining
the observed raw path in its existing source. Do not add path/query/fragment
payloads to activity events, rename events, change dimensions or integrate
analytics for this rename.

## Deferred owner items and verification boundary

- #399: the coexistence sentence, the create dialog Course option/CTA, the rail's Course kind badge, and the folder-scoped V1 labels restored in Stage B (folder Learn subheading, empty state and creation CTA, overview back link, deletion description and toast, untitled rail fallback).
- #377: signed-out Learn deep-link restoration through authentication.
- Failed/missing-link terminal recovery UI, including wrong-table V2 links.
- Historical provider-description repair or any data migration/backfill.

The required final-head commands are `pnpm verify`,
`pnpm verify:learn-v2-beta` and `pnpm verify:learn-v2-calendar`, under the workflow's
CI placeholders and `VITEST_MAX_WORKERS=1`, with unchanged policies. Focused
route/history, owned V1 producer, V2 regression and server redirect/header checks
remain required even if an aggregate stops early. CI at the same head supplies
`test:e2e:learn` and `test:e2e:learn:authority`; local or synthetic evidence does
not establish live authentication, deployed routes, providers or production
acceptance. The orchestrator owns the final-head review ledger.
