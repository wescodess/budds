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
identifiers, learner titles, generation prompts and diagnostics. The remaining
fixed V1 labels found by that sweep are listed below; no UI change is made here.

The `thread`/`mission` sweep finds no missed fixed presentation label beyond the
owner-reserved sentence at `app/pages/app/learn/index.vue:312`. Internal
`thread`/`mission` variables, tables, command/receipt diagnostics, authority
values, event names, selectors and storage keys remain unchanged. In particular,
`shared/learn-adaptive-completion.ts:15-17` keeps historical exact-match inputs
whose projected output says Void. Arbitrary learner/generated text and historical
records remain intact. Accepted B3 wording includes “Review this Void's sources”
and the “classic Voids” fallback.

## Missed fixed V1 labels requiring the producing UI fix

These are findings for the producing owner, not approved exceptions or a claim
that all V1 naming acceptance is complete. Their corrections require the
project's UI implementation routing; B5 leaves them unchanged.

| File and line | Fixed label and concrete surface |
| --- | --- |
| `app/components/learn/SourceSelector.vue:131` | “Create a Course” on V1 creation. |
| `app/components/learn/SourceSelector.vue:143` | “Consider completing reviews before starting new courses.” in the review warning. |
| `app/components/learn/SourceSelector.vue:201` | “The course will be generated from web sources.” in the empty-source state. |
| `app/components/learn/OutlineEditor.vue:202` | “Course Outline” on V1 outline editing. |
| `app/components/learn/SectionVoidTopBar.vue:28` | Accessible name “Back to course” during a V1 section. |
| `app/components/learn/SectionCompletionCard.vue:63` | “Course Complete!” after the last section. |
| `app/components/learn/SectionCompletionCard.vue:151` | “Back to Course Overview” after section completion. |
| `app/pages/app/folders/[id]/learn/index.vue:32` | “Courses in this folder” on folder Learn. |
| `app/pages/app/folders/[id]/learn/index.vue:44` | “No courses in this folder yet.” in the empty state. |
| `app/pages/app/folders/[id]/learn/index.vue:51` | “Create a course from this folder” in the creation CTA. |
| `app/pages/app/folders/[id]/learn/[courseId]/index.vue:46` | Accessible name “Back to folder courses” on the V1 overview. |
| `app/pages/app/folders/[id]/learn/[courseId]/[sectionId].vue:244` | “Back to course” in the unavailable-section recovery link. |
| `app/pages/app/folders/[id].vue:140` | `course: 'course'` produces “remove the course” in the deletion description. |
| `app/pages/app/folders/[id].vue:161` | `course: 'Course'` produces “Course deleted” in the deletion toast. |
| `app/components/folder-shell/FolderShellRail.vue:113` | “Course” fallback for an untitled V1 record. |
| `app/composables/useFolderPageContext.ts:181` | “Untitled Course” default supplied during V1 creation. |
| `convex/courses.ts:52` | “Untitled Course” persisted default for a blank new title. Existing titles stay unchanged. |
| `convex/reviewItems.ts:147` | “Unknown Course” fallback reaches `ReviewCard.vue:57` through `review.vue:403` when the parent is absent. |

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

- #399: the coexistence sentence and create dialog Course option/CTA.
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
