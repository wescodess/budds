# C4 teaching read audit

Scope: public Convex query registrations and content-bearing mutation/action/HTTP results for PR #514, following the 2026-11-21 capability-off compatibility decision. This inventory describes code and local regression coverage; it is not a deployment or provider validation.

The responses capability remains default-off; enabling it remains gated by #559. While it is off, existing teaching reads, chat history, shares and exports follow `dev`, including legacy content without retained provenance and copies whose sources are no longer present. The fixed C4.1 assessment projections and #515 map-edit contract remain always on. Existing ownership, publication, retention and personal-export checks from `dev` still apply. New signing is optional while off and never changes visible content. RAG streams bypass the new provenance buffering and limits while off; the existing provider chunks remain unchanged.

When responses are enabled, new message writes are verified: v3 binds owner, role, exact content, every source field and the stored scope. Assistant writes require a server receipt. Convex signs learner prose with unknown teaching scope. New client model/audio context is stripped. Replay checks the retained receipt and returns stored strings without normalization. Legacy v1, unsigned teaching, v2 empty/folder-only references and v3 unknown scope have no source authority; no conversation-folder fallback is used. The only production message insertion is `messages.appendMessage`; the other message writers delete rows. There is no public content/scope patch API.

When responses are enabled, signed source references are also resolved against current document/folder ownership, access, retained source identities/snapshots/excerpts and teaching lineage before replay, including ordinary history. Revocation withholds assistant/source content while preserving valid learner prose. Message export uses the same checks after its mandatory export authorization and reports `evidence_unavailable`; a fresh authorization cannot restore revoked quotes. Access validation is bounded to 64 references, 64 retained identities and 64 snapshots, with the existing folder, privacy-read and lineage budgets. It never repairs or re-pins a stale lineage during replay.

Schema changes are additive. `messages.helpScope` accepts v3 with an explicit `known`, `unknown` or `independent` state and nullable references, while retaining v1/v2 for existing rows. `quizAnswerAssessments.questionSnapshot` adds optional `scopeVersion` and `sourceDocumentId`; new snapshots bind their original source rather than accepting a replacement question's source. `reviewItems.sourceVersionId` records the immutable flashcard version used by new copies. With responses enabled, legacy copies without that origin remain unavailable. With responses enabled, these retained origin fields are omitted from learner projections. Off reads retain the dev row shape. No backfill, table, index, flag activation or migration is introduced.

With responses enabled, unknown is never an empty source set. All replay/export aliases withhold unknown assistant text, excerpts, source names, model/context fields and quotes, report `evidence_unavailable`, and preserve valid learner prose. Fresh retrieval or history-bearing answers never receive an independent receipt. History-bearing RAG signs `unknown` with null references; persistence stores a signed unavailable tombstone, not an unscoped protected copy. Independent receipts exist only for new general answers that used neither retrieval nor history, and still cannot establish irrelevance during an open check. v2 known document receipts retain exact-byte verification and live authority checks.

Queries cannot create exposure. With responses enabled, after admission, a teaching query with relevant formative work reads its normal projection dependencies and throws `help_delivery_required` with an opaque HMAC revision, never the body. The revision covers that projection, its current source scope and the bounded open-opportunity identities/revisions. The existing subscription re-requests its paired delivery mutation when the signal changes, reusing its delivery key; exposure remains deduplicated per key, help kind and opportunity even when the current source set changes. Current scope is always revalidated and is not an authorization supplied by the receipt. This applies through the shared wrapper to every `delivery` and `media_locator` row below. Held-out denial occurs before the content handler. Admission precedes construction and dispatch; the mutation records assistance only for a substantive returned body. Empty/unavailable projections and failures roll back or create no delivered exposure. Denied mutations return an admission with a null value, preserving non-delivered denial records. Scope follows source IDs, source manifests and bounded lineage dependencies/origins. Missing provenance and exhausted bounds deny rather than infer irrelevance from a container.

With responses enabled, every wrapped read and its delivery/preparation alias resolves current authority through `teachingReadScope`, even without an open opportunity. With responses off, the wrapper calls the existing handler without new scope resolution, admission, accounting or privacy-read budgets; aliases return the same ordinary value. Teaching producer/source adapters and cached task projections follow the same gate. With responses enabled, the wrapper accepts only scopes validated within that invocation; null, empty targets, folder-only scope, exhausted bounds or a failed dependency cannot authorize teaching. Scope validation checks live ownership/status, source retention and tombstones, current document access, every active artifact key's exact payload/lineage and its transitive source/origin pins using the existing pure C4 admission guard. Delivery handlers receive a read-only database context, so existing producer helpers cannot re-pin or repair a publication while reading it. The same authority resolver protects copied teaching in authorized export; source-free legacy copies become unavailable tombstones while learner answers remain available.

Legacy deck, Audio-list, interjection-history, course-source and folder-scope reads preserve dev ordering and collection behavior while off, including `collect()` where dev used it. The stricter teaching-specific limits apply only while enabled. The [A6 off-parity sweep](c4-off-parity.md) lists the full production diff inventory, check dispositions and pinned dev differential procedure.

Each enabled authority resolution uses the existing 3,072-read privacy budget, 64 source references, 64 lineage nodes, 256 edges and 512 targets, depth 8 and 1,024 visited result rows. Per-kind ranges have explicit overflow checks (200 questions/cards/assessments, 32 claims, 16 session blocks, 8 supports/origins). Overflow withholds teaching. Export pages remain capped at eight rows and reuse the request's budget.

| Read family, including paired aliases | Current authority check | Capability |
| --- | --- | --- |
| `courses.get`, `listByUser`, `listByFolder` | Owned course and its declared document sources; live document access, retention and lineage. An absent source list cannot authorize an outline. | Responses; original access always on |
| `courseSections.get`, `listByCourse`, `getNextSection`, `getOfflineCachePayload` and HTTP section cache | Every retained section key through C4 payload/lineage admission; nested quizzes, versions and Audio; unregistered sections require declared course sources. The offline cache is not authority. | Responses; original access always on |
| `quizzes.getWithQuestions` and teaching-returning Quiz mutations | Every question's current lineage and source document; no ordinary shortcut while enabled. | Responses; original access always on |
| `quizzes.getAttemptResults`, pending grading inputs and corresponding submission results | Current question authority plus the frozen snapshot's versioned original document binding, independent of later question edits. Missing/substituted snapshot origins are unavailable. Learner answers remain exportable. | Responses; original access always on |
| `flashcardRooms.getRoom`, `getRoomVersion`, `listRoomVersions` | Immutable version payload/lineage and each card's document source; live card content must match the current version. | Responses; original access always on |
| All three `reviewItems` readers | Each actual review row, its retained `sourceVersionId`, matching version card, current card, section and original sources. A container's scope cannot authorize copied text. | Responses; original access always on |
| Legacy Audio turns, URLs, course playback and token shares | Live owner/publication plus Audio artifact payload/lineage and original document sources. | Responses; original access always on |
| V2 Audio playback, media and interjection reads/token shares | Episode/interjection publication and current artifact lineage; manifest/task document revision, hash, object-key and folder pins. Media follows its actual publication, not just the job's folder. | Responses; original access always on |
| `learnV2Sources.listSourceReview`, Journey mission reads | Current retained snapshots/excerpts, rights, void/folder ownership and backing document authority. Safe unavailable summaries may remain. | Responses; original access always on |
| `learnV2SessionContent.getSessionContent`, assistance replay | Selected content revision, every block lineage, claim supports and retained source snapshots; no current-void fallback for a deleted support. | Responses; original access always on |
| Adaptive Canvas, artifact/reflection and evidence reads | Actual activity (including requested historical evidence), its session blocks and source snapshots. A source-free non-factual plan must replay canonically without evidence or generation content; an attributed conversion may use only verified learner-authored chat prose. | Responses; original access always on |
| Message history/replay and message export | Exact receipt integrity plus current signed source authority; unknown scope withholds all assistant/source-derived content. Own learner text is separate. | Responses; original access always on |
| Authorized export of teaching copies | `exportTeachingCopy` calls the same current authority resolver for course/section, Quiz/snapshot, card/version/review and Audio/transcript families. Unknown/revoked copies return non-sensitive unavailable tombstones; lawful export authorization alone is not source permission. | Responses; original access always on |
| Worker-only inputs | Existing ordinary-only contextual and C4 lineage guards; pending Quiz inputs additionally resolve frozen source authority. They are not learner delivery acknowledgements. | Responses; original access always on |
| `tasks.get`, `tasks.listByFolder` and task export | Fixed task summaries retain learner-authored titles, closed progress/error states, counts and validated navigation IDs; cached provider results and arbitrary metadata are never returned. | Responses (cached-content projection) |
| Metadata, assessment and own-work rows below | Existing fixed projections/ownership/grants; no generated body or source excerpt is introduced. Original-file export retains its disclosed exception. | Always on fixed projections; new teaching visibility Responses |
| `replaceDraftMap`, `acceptBlueprintMap` (#515) | Existing assessment-contract validation and fixed map projection. | Always on |

With responses enabled, private media is prepared before R2 access, then a server-held credential is required for authenticated media delivery before forwarding each chunk. A learner cannot forge that accounting acknowledgement. The same receipt is reused for all chunks, so partial delivery counts once and later failure retains that fact. No chunk is prefetched into the downstream stream. This costs one bounded Convex delivery mutation per upstream media chunk; each invocation revalidates current admission, lineage and source pins. Metadata preparation and failed fetches record no delivered assistance. While off, media routes use the original query and proxy the existing body without a delivery mutation or per-chunk admission.

The four share-token query families and their aliases explicitly permit anonymous ordinary teaching. Their original live token, publication and owner checks always apply; the new lineage and source-pin checks apply with responses enabled. Anonymous reads do not use or account against the publisher's opportunity. With responses enabled, authenticated reads continue through the viewer's contextual admission; an owner cannot bypass their own held-out check by using their share token.

The personal export/original-file exception follows [the disclosure resolution, section 3.5](https://github.com/wescodess/budds/issues/373#issuecomment-6651824980): do not suspend lawful export during an open check; require its existing bounded export authorization and contamination/unknown accounting. Those endpoints do not become unaccounted teaching reads.

All 128 public query names are listed below. Every new `Delivery`/`Preparation` alias belongs to the query in its row.

| Handling | Rule |
| --- | --- |
| `delivery` | With responses enabled, the original query permits ordinary work only. The paired `Delivery` mutation admits, constructs the existing projection, and records substantive delivery atomically. |
| `summary_or_own_work` | Audited summary, scheduling, access, neutral identity, or learner-authored work. No generated lesson, answer, source excerpt or playable media body. |
| `media_locator` | With responses enabled, the query is restricted to ordinary reads. `Preparation` mutation returns only a private R2 locator after admission. Server-credentialed `Delivery` mutation is mandatory before each HTTP audio chunk. |
| `worker_ordinary_only` | Capability/owner and lineage checks remain. Relevant formative, held-out, unavailable and unknown scopes cannot return worker inputs; these are not learner delivery acknowledgements. |
| `personal_export` | Existing mandatory `authorizePersonalExport` and `requirePersonalExportAuthorization`; original files and personal records remain available under the disclosure resolution, with imported/unknown exposure before release. |
| `assessment_or_own_response` | Existing C1/C2 fixed assessment, grant, own-work and unavailable projections. No implicit teaching or new assessment grant. |
| `message_metadata` | With responses enabled, metadata and permitted learner prose only. Assistant/source replay uses `messages.replayByConversation`, which verifies retained signatures and commits delivery. |

| Public query | Handling | Capability |
| --- | --- | --- |
| `audioOverviewInterjections.getTurnUrls` | `delivery` | Responses; original access always on |
| `audioOverviewInterjections.listByOverview` | `delivery` | Responses; original access always on |
| `audioOverviewInterjectionsV2.getForOwner` | `delivery` | Responses; original access always on |
| `audioOverviewInterjectionsV2.getStatusForOwner` | `summary_or_own_work` | Always on original access and fixed projection |
| `audioOverviewInterjectionsV2.resolveMediaForOwner` | `media_locator` | Responses; original access always on |
| `audioOverviewJobs.getAlignmentContext` | `worker_ordinary_only` | Responses; original access always on |
| `audioOverviewJobs.getStepContext` | `worker_ordinary_only` | Responses; original access always on |
| `audioOverviewRooms.getForConversation` | `summary_or_own_work` | Always on original access and fixed projection |
| `audioOverviewRooms.listByFolder` | `summary_or_own_work` | Always on original access and fixed projection |
| `audioOverviews.getByShareToken` | `delivery` | Responses; original access always on |
| `audioOverviews.getCourseScopedOverview` | `delivery` | Responses; original access always on |
| `audioOverviews.getInterjectionMetadata` | `summary_or_own_work` | Always on original access and fixed projection |
| `audioOverviews.getTurnUrls` | `delivery` | Responses; original access always on |
| `audioOverviews.getTurnUrlsByShareToken` | `delivery` | Responses; original access always on |
| `audioOverviews.getWithTurns` | `delivery` | Responses; original access always on |
| `audioOverviews.listByFolder` | `summary_or_own_work` | Always on original access and fixed projection |
| `audioOverviews.listByRoom` | `summary_or_own_work` | Always on original access and fixed projection |
| `audioOverviewV2.getForWorkflow` | `worker_ordinary_only` | Responses; original access always on |
| `audioOverviewV2.getPlaybackByShareToken` | `delivery` | Responses; original access always on |
| `audioOverviewV2.getPlaybackForOwner` | `delivery` | Responses; original access always on |
| `audioOverviewV2.listAlignmentSegments` | `worker_ordinary_only` | Responses; original access always on |
| `audioOverviewV2.resolveMediaByShareToken` | `media_locator` | Responses; original access always on |
| `audioOverviewV2.resolveMediaForOwner` | `media_locator` | Responses; original access always on |
| `calendarConnections.getByUser` | `summary_or_own_work` | Always on original access and fixed projection |
| `calendarEvents.listByCourse` | `summary_or_own_work` | Always on original access and fixed projection |
| `calendarEvents.listByUser` | `summary_or_own_work` | Always on original access and fixed projection |
| `calendarEvents.listScheduled` | `summary_or_own_work` | Always on original access and fixed projection |
| `contentFlags.getFlagRateForCourse` | `summary_or_own_work` | Always on original access and fixed projection |
| `conversations.getConversation` | `summary_or_own_work` | Always on original access and fixed projection |
| `conversations.getMostRecentForFolder` | `summary_or_own_work` | Always on original access and fixed projection |
| `conversations.listRecentForUser` | `summary_or_own_work` | Always on original access and fixed projection |
| `courses.get` | `delivery` | Responses; original access always on |
| `courses.listByFolder` | `delivery` | Responses; original access always on |
| `courses.listByUser` | `delivery` | Responses; original access always on |
| `courseSections.checkPreFetchStatus` | `summary_or_own_work` | Always on original access and fixed projection |
| `courseSections.get` | `delivery` | Responses; original access always on |
| `courseSections.getNextSection` | `delivery` | Responses; original access always on |
| `courseSections.getOfflineCachePayload` | `delivery` | Responses; original access always on |
| `courseSections.listByCourse` | `delivery` | Responses; original access always on |
| `courseSourceDocs.listByCourse` | `summary_or_own_work` | Always on original access and fixed projection |
| `dataExport.getAttemptAnswersPage` | `personal_export` | Original export policy always on; new teaching revocation Responses |
| `dataExport.getCourseSourceDocsPage` | `personal_export` | Original export policy always on; new teaching revocation Responses |
| `dataExport.getDocumentDownloadUrl` | `personal_export` | Original export policy always on; new teaching revocation Responses |
| `dataExport.getExportMetadata` | `summary_or_own_work` | Always on original access and fixed projection |
| `dataExport.getUserDataPage` | `personal_export` | Original export policy always on; new teaching revocation Responses |
| `documents.countsByFolder` | `summary_or_own_work` | Always on original access and fixed projection |
| `documents.getTeachingScope` | `summary_or_own_work` | Always on original access and fixed projection |
| `documents.listDocumentsByFolder` | `summary_or_own_work` | Always on original access and fixed projection |
| `flashcardRooms.getRoom` | `delivery` | Responses; original access always on |
| `flashcardRooms.getRoomVersion` | `delivery` | Responses; original access always on |
| `flashcardRooms.listRoomsByFolder` | `summary_or_own_work` | Always on original access and fixed projection |
| `flashcardRooms.listRoomVersions` | `delivery` | Responses; original access always on |
| `folders.getFolder` | `summary_or_own_work` | Always on original access and fixed projection |
| `folders.getFolderDescendantCounts` | `summary_or_own_work` | Always on original access and fixed projection |
| `folders.listAllFolders` | `summary_or_own_work` | Always on original access and fixed projection |
| `folders.listChildFolders` | `summary_or_own_work` | Always on original access and fixed projection |
| `folders.listSubtree` | `summary_or_own_work` | Always on original access and fixed projection |
| `folders.listTopLevelFolders` | `summary_or_own_work` | Always on original access and fixed projection |
| `folders.resolveScope` | `summary_or_own_work` | Always on original access and fixed projection |
| `folders.searchScopeItems` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnAdaptive.getArtifactCanvas` | `delivery` | Responses; original access always on; new teaching visibility Responses |
| `learnAdaptive.getMemory` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptive.getReflectionCanvas` | `delivery` | Responses; original access always on; new teaching visibility Responses |
| `learnAdaptive.getThread` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptive.inspectContributionSource` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptive.listPromotionProposals` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptive.listResumeCandidates` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptive.listThreadArtifacts` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptive.listThreadContributions` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptive.listThreadHistory` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptiveAccess.adaptiveStatus` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnAdaptiveCanvas.getCanvas` | `delivery` | Responses; original access always on |
| `learnAdaptiveClarifications.getInitialDecision` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnAdaptiveDrafts.getThreadDraft` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnAdaptiveEvidence.getThreadActivityEvidence` | `delivery` | Responses; original access always on |
| `learnAdaptiveExperiment.getGuardrailStatus` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnAdaptiveExperiment.getMyStatus` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnAdaptiveRecovery.getDiagnosticCanvas` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnAdaptiveRouting.replayDecision` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnProfile.getProfile` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Access.status` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Assessments.getAssessment` | `assessment_or_own_response` | Always on original access and fixed projection |
| `learnV2Assessments.getAssessmentState` | `assessment_or_own_response` | Always on original access and fixed projection |
| `learnV2Assessments.getFeatureReadiness` | `assessment_or_own_response` | Always on original access and fixed projection |
| `learnV2Assessments.getPostSealTeaching` | `assessment_or_own_response` | Always on original access and fixed projection |
| `learnV2Blueprints.getBlueprintGenerationJob` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Blueprints.getBlueprintMap` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Calendar.getStatus` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Calendar.listProjections` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2CalendarReconciliation.listProposals` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2FolderManifests.getLatestManifestForBlueprint` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2FolderManifests.getManifest` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2FolderManifests.listManifestEntries` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2FolderManifests.listManifestFolders` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Journey.getCurrentMission` | `delivery` | Responses; original access always on |
| `learnV2Journey.getMission` | `delivery` | Responses; original access always on |
| `learnV2Journey.getSessionCandidate` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Journey.listHub` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Lifecycle.getBlueprintRevision` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Lifecycle.getLearningVoid` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Lifecycle.listLearningVoids` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2MeasurementReports.exportAggregateReport` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2MeasurementReports.getReport` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2MeasurementReports.getReportCells` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Plans.getPlanPreview` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2Responses.getResponseState` | `assessment_or_own_response` | Always on original access and fixed projection |
| `learnV2Search.quotaStatus` | `summary_or_own_work` | Always on original access and fixed projection |
| `learnV2SessionContent.getSessionContent` | `delivery` | Responses; original access always on |
| `learnV2Sources.getSource` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnV2Sources.listSourceReview` | `delivery` | Responses; original access always on |
| `learnV2Sources.listSources` | `summary_or_own_work` | Always on original access and fixed projection; new teaching visibility Responses |
| `learnV2Today.getToday` | `summary_or_own_work` | Always on original access and fixed projection |
| `messages.listByConversation` | `message_metadata` | Responses; original access always on |
| `quizAnswerAssessments.listPendingForAttempt` | `worker_ordinary_only` | Responses; original access always on |
| `quizAnswerAssessments.listPendingForShadowAttempt` | `worker_ordinary_only` | Responses; original access always on |
| `quizzes.getAttemptResults` | `delivery` | Responses; original access always on |
| `quizzes.getQuizHistory` | `summary_or_own_work` | Always on original access and fixed projection |
| `quizzes.getWithQuestions` | `delivery` | Responses; original access always on |
| `quizzes.listAttempts` | `summary_or_own_work` | Always on original access and fixed projection |
| `quizzes.listByFolder` | `summary_or_own_work` | Always on original access and fixed projection |
| `reviewItems.getReviewBacklogCount` | `summary_or_own_work` | Always on original access and fixed projection |
| `reviewItems.listBySection` | `delivery` | Responses; original access always on |
| `reviewItems.listDueForUser` | `delivery` | Responses; original access always on |
| `reviewItems.listDueWithContext` | `delivery` | Responses; original access always on |
| `tasks.get` | `summary_or_own_work` | Original access always on; cached-content projection Responses |
| `tasks.listByFolder` | `summary_or_own_work` | Original access always on; cached-content projection Responses |
| `users.getDailyQuota` | `summary_or_own_work` | Always on original access and fixed projection |
| `users.getUser` | `summary_or_own_work` | Always on original access and fixed projection |

Additional content returns audited:

C5.4 implements the existing assessment delivery registrations through `convex/lib/learnV2AssessmentDelivery.ts`. The shared helper accepts a server-selected Today/Canvas flow; Canvas-specific admission remains with the Canvas adapter. Grants record consumption transactionally and replay only after current authority is revalidated.

| Entry point | Handling | Capability |
| --- | --- | --- |
| `learnV2Assessments.grantAssessmentDelivery` | `assessment_or_own_response`: one exact-item grant receipt, with no prompt or teaching snapshot. The public adapter selects Today; Canvas uses the shared owner helper after its admission. | Responses; enrollment and frozen protocol additionally required for measurement. Off retains the disabled result. |
| `learnV2Assessments.getAssessment` | `assessment_or_own_response`: the granted prompt and declared stimulus only, through the shared disclosure projection. No grant, mismatched flow, stale pins or revoked evidence withhold the body. | Responses; off retains the disabled result. |
| `learnV2Assessments.getAssessmentState` | `assessment_or_own_response`: lifecycle, owned references and closed capabilities only. No read creates a grant. | Responses; off retains the disabled result. |

C5.4 connects both Today server entry points (the Today list and the session deep link) to the same cold opportunity and grant. The server records `today` or `session_deep_link` attribution at enrollment. Owners without an enabled measurement catalogue, and non-admitted assignments, keep the ordinary path.

| Entry point | Handling | Capability |
| --- | --- | --- |
| `learnV2Today.getToday` | `summary_or_own_work`: adds `assessment.kind`, a closed reason code and the shared assessment state. Open checks set `assessmentRubricVersion` to null. Blocked checks name a reason with no retry. No item body, teaching or grant. | Responses for test-only sessions; responses and enrollment for measured learning. Off is identical to dev. |
| `learnV2Journey.getSessionCandidate` | `summary_or_own_work`: unchanged fixed projection. It serves the deep link and never returns a prompt or grant. | Always on original access and fixed projection. |
| `learnV2SessionContent.startStudySession` | `assessment_or_own_response`: may enroll, then returns an `assessment` receipt holding references, state and the shared grant receipt, never content. A replayed or cross-tab start returns the same grant. Teaching starts only after a seal or a missed cold check, and records instruction exposure in the same mutation. The optional `entryPoint` argument carries attribution only. | Responses for test-only sessions; responses and enrollment for measured learning. Off is identical to dev. |
| `learnV2SessionContent.getSessionContent`, `getSessionContentDelivery` | Before a seal: a fixed envelope with empty blocks, claims and supports, the summary, the granted prompt only through `getAssessment`'s projection, and own sealed work. After a seal: separate-case teaching through an explicit allowlist with no rubric snapshot. Every block, claim and rubric case must be registered instructional and unreserved. Queries need a recorded instruction delivery; the delivery mutation records it after help admission. | Responses for test-only sessions; responses and enrollment for measured learning. Off is identical to dev. |
| `learnV2SessionContent.retrySessionContentGeneration` | Unchanged for learning sessions: regeneration never touches the held-out cold item. Test-only sessions still reject retry. | Responses for test-only sessions. Off is identical to dev. |
| `convex/lib/learnV2HelpAdmission.ts` | A `preparing` opportunity whose `openAt` is strictly in the future is not an open check. It neither denies nor counts toward the open-check limit. Delivered help in its scope records one assignment-level `practice` exposure per opportunity, without an opportunity link, so it cannot mark that check assisted. Opportunities at or past `openAt`, or with non-finite `openAt`, still deny and record `requested_denied`. Reserved cases stay excluded by the instructional-case check. | Responses; off returns `ordinary` exactly as dev. |

C5.1–C5.3 adds one public enrollment mutation and implements the existing sealed-scoring entry points. These classifications supplement the C4 inventory above; there are no new public queries.

| Entry point | Handling | Capability |
| --- | --- | --- |
| `learnV2Measurement.enrollProspect` | `summary_or_own_work`: assignment identity and admission reasons only; no item, prompt, key or teaching body. | Enrollment; missing frozen protocol returns `protocol_not_frozen`; no delivery grant. |
| `learnV2Mastery.acceptMasterySubmission` | `assessment_or_own_response`: saved-response receipt only; acceptance freezes assistance and mastery basis before scoring. | Responses; off retains the existing disabled receipt. |
| `learnV2Mastery.scoreMasterySubmission` | `assessment_or_own_response`: approved score, threshold and feedback codes only; no rubric, criterion labels, source excerpts or teaching. | Scoring and existing response authority; off retains the disabled result. |
| `learnV2Mastery.submitMasteryAttempt` | Existing ordinary scoring/feedback while off; enabled compatibility path accepts the immutable submission and returns assessment outcome metadata. | Existing access always on; sealed scoring is gated. |
| `learnV2MapCalibration.submitCalibrationAttempt` | `assessment_or_own_response`: existing calibration result while off; enabled compatibility path returns the same fixed sealed-score projection. | Existing access always on; sealed scoring is gated. |
| `learnV2Mastery.getMasterySubmissionScoringState`, `getSealedMasteryAttemptOutcome` | Internal reads reached by scoring actions: fixed assessment result or attempt/state/review metadata, without teaching content. | Scoring and owner/response authority; no public query registration. |
| `learnV2Mastery.recordAssistanceUse` | `delivery`: admission before both first delivery and replay, current teaching authority and transactional accounting through C4's `defineTeachingMutation`. Unsealed test-only help is refused before content returns. | Responses; off preserves dev help and replay. |
| `learnV2SessionContent.getSessionContent`, `getSessionContentDelivery`, `startStudySession`, `retrySessionContentGeneration` | Existing teaching read/delivery wrapper and session commands. Explicit assessment sessions remain withheld; legacy `retained_review` placement alone becomes test-only only with responses enabled. | Responses for new retained-flow behavior; explicit assessment omissions remain always on. |

C5.5 keeps ordinary Canvas teaching on the existing C4 read/delivery wrapper. Assessment-backed Canvas reads call `readLearnAssessmentForOwner` with the server-selected `canvas` flow and use the same disclosure projection as Today. They do not run a teaching projection to deliver a check. Preparation creates the owned check envelope, activity, enrollment and opportunity binding atomically, without a grant. Attachment calls `grantLearnAssessmentDeliveryForOwner` with `flow: 'canvas'`; an unsupported response format or renderer bound is refused before consuming a grant. A failed grant retains a prior preparation without starting the session or creating another wrapper.

| Entry point / contract | Handling | Capability |
| --- | --- | --- |
| `learnAdaptiveCanvas.prepareCanvasSession` | `summary_or_own_work`: opportunity and content references only. Authenticated V2/adaptive access, current plan/Blueprint/session, live T0, positive history, validated family, frozen protocol/Canvas flow, scorer pins and both generation/scoring pilot admission are conjunctive. One transaction creates a block-free check envelope, current factual activity, Canvas enrollment and opportunity binding. It grants and discloses no item. Repetition retains the binding; invalid admission creates no grant or wrapper. | Responses, delivery and enrollment; off returns `not_admitted` / `disabled` without changing records. Canvas collection remains disabled. |
| `learnAdaptiveCanvas.listDueChecks` | `summary_or_own_work`: authenticated, bounded discovery of owned open delayed-check session references, revisions, horizons and times. Reads at most 33 rows per ready/open phase and refuses overflow rather than truncating. Current Canvas binding, pilot and assessment authority are required. No item body, sibling, key, rubric, grant or teaching is returned. | Responses and delivery; disabled before discovery reads. Enrollment/protocol and evidence are revalidated by assessment authority. |
| `learnAdaptiveCanvas.attachReadySession` | `assessment_or_own_response`: owned opportunity/flow/grant attachment and reference receipt. A fresh session first runs the same atomic preparation helper, then grants in the owning attachment transaction. Unsupported response formats are withheld before a grant. | Responses and delivery for the assessment adapter; fresh preparation also requires enrollment. Original attachment remains unchanged off. |
| `learnAdaptiveCanvas.getCanvas`, `getCanvasDelivery`, internal `loadReadyCanvas` | Assessment variant: exact granted prompt/stimulus and canonical own-work recovery; neutral fallback/accessibility/control fields. Ordinary teaching: existing `delivery` wrapper, admission and accounting. | Responses for new assessment behavior; C4.1 assessment omissions remain always on. |
| `learnAdaptiveCanvas.submitCanvasResponse` | `assessment_or_own_response`: canonical save-and-seal receipt, without an activity body copy. Staged activity status grants no disclosure or mastery. | Responses; original staging and replay remain unchanged off. |
| `learnAdaptive.submitResponse` | `assessment_or_own_response`: scores the owned saved submission ID, preserving Canvas admission and reconciliation state. | Responses; original compatibility action remains unchanged off. |
| `learnAdaptiveCanvas.getCanvasSubmissionAuthority`, `recordCanvasSubmissionOutcome` | Internal owner/Canvas-anchor and canonical-plan checks, with bounded phase/attempt synchronization. An ordinary completed result advances only the current session delivery anchor; the sealed acceptance pins remain immutable. No response or teaching payload. | Responses and original adaptive access; no public registration. |
| `learnAdaptive.loadContributionSource`, `recordContribution`, `convertContributionToActivity` | Existing neutral attribution/conversion results; current producer lineage guard for document, Quiz, card and Audio origins. Chat conversion admits verified learner prose. No V2 evidence is inferred and no exposure is cleared. | Responses for new lineage checks; original contribution behavior remains unchanged off. |
| `shared/learn-adaptive-activity-plan.ts`: `learn-adaptive.assessment-plan.v1` | Versioned measurement-reference variant inside the existing canonical snapshot. References only the opportunity/grant, one item revision/response format and bounded measurement-claim identities/digests. No teaching-claim identity, primitive body, key, rubric, solution or sibling form. Replay and Canvas authority revalidate the reference. | New variant is assessment-only; legacy canonical bytes and storage envelope versions remain unchanged. |
| `convex/lib/learnV2Responses.ts` measurement dependencies | Measurement envelopes validate their own item claims/supports without requiring unrelated teaching claims. Ordinary content retains its existing claim checks. | Responses; no capability-off acceptance behavior changes. |

The C5 application binding runs in `startStudySession` before the ordinary lesson's response can be accepted. It pins the published `independent_application` prompt, instructional case, rubric, evidence manifest, started session revision and closed-inventory compatibility scorer, then records the ordinary delivery grant. Cold remains a separate opportunity. The existing `transfer_challenge` storage variant remains supported only when its pinned prompt digest matches. The registered Today journey covers cold grant/seal/score, separate-case teaching, ordinary acceptance/scoring and the v2 first-Independent link to the earliest original day-7 slot. Its assisted control preserves the ordinary guided cap and creates no Independent claim.

Only the owned application's exact started lesson payload is exempt from counting that baseline lesson as additional help. The content read still resolves current C4 teaching authority, checks other open assessments and records intervening learning. This server-only parameter is absent from public help requests. Hint/reveal mutations and all other teaching/help routes retain accounting; an unsealed application's current session revision advances atomically with hint/reveal, while sealed acceptance pins stay fixed. All added handling returns before reads or writes while responses are off.

Rubric measurement scoring now pins `learn-v2.measurement-rubric-scorer.v1`, `learn-v2.measurement-rubric-prompt.v1` and `learn-v2.measurement-rubric-payload.v1` in a separate `measurement_rubric` configuration. Its request includes the exact delivered `declaredStimulus`, including null and whitespace, after checking the prompt/stimulus/format digest. The new implementation digest participates in configuration identity. It cannot enter the closed legacy allowlist, and an older measurement binding is never repinned or silently scored with this request. The baseline request/prompt/parser implementation pins, response parser/schema, weighted arithmetic, 80 comparator, transition and automatic route remain unchanged. Keyed/numeric/ordered grading remains deterministic. No production scorer entry, flag default, schema field/index or migration is added; new configuration approval and validation remain prerequisites to collection.

Delayed delivery uses `convex/lib/learnV2DelayedDelivery.ts` in the bounded materialization transaction. Each deliverable due assigned opportunity receives its own block-free check session/content binding; Canvas additionally receives its own factual assessment-reference activity. Binding copies no cold or sibling prompt. Today prioritizes its due bound checks independently of mastery; Canvas discovers its checks through `listDueChecks` and attaches the returned session. Each owning start/attachment mutation calls `grantLearnAssessmentDeliveryForOwner` with its fixed flow, then advances the session and opportunity delivery pins together. Existing grant/acceptance/scoring validation remains in force. A missed or failed day 7 does not suppress day 30. Closed or sealed checks do not mask the next due Today slot.

The retained follow-up writer resolves its shell to the earliest qualifying assigned original and a validated check binding, or persists a blocked state with an explicit reason such as `no_item`, `protocol_not_frozen` or `missed_window`. It creates no generation job for a check. First-slot identities, clocks and original/missed facts remain unchanged; a later slot cannot replace a missed first slot. Future `preparing` opportunities retain their existing pre-open teaching rule, and an open unsealed check still denies teaching for its objective. This uses existing storage fields and indexes; no schema or flag-default change is introduced.

Post-seal teaching remains a dependency on [C5.6 #535](https://github.com/wescodess/budds/issues/535): `getPostSealTeaching`, `authorizePracticeAssistance` and the separate-case practice binding must land before Canvas collection is admitted. Sealed Canvas retains its saved/submitted/scoring/scored status; teaching override controls remain unavailable. This change supplies no teaching continuation and enables no collection.

| Entry point | Handling | Capability |
| --- | --- | --- |
| `messages.appendMessage`, `messages.replayByConversation` | Exact role-bound signed writes and verified, accounted replay; current source access is checked even for ordinary replay; legacy teaching is unknown. | Responses; original access always on |
| `quizzes.startAttempt`, `submitAnswer`, `submitAllAnswers`, `submitAttempt`, `updateQuestion`, `updateQuiz` | Admission before the handler and substantive returned teaching accounted in the same mutation. Metadata-only updates do not count. | Responses; original access always on |
| `learnV2Mastery.recordAssistanceUse` | Contextual admission and delivered assistance also cover the legacy hint/reveal replay path. | Responses; original access always on |
| Assessment delivery/submission/calibration actions and receipts | Existing C1/C2 fixed grants, own work, closed feedback and references; no raw scoring payload or implicit teaching grant. | Always on assessment grants and fixed projections |
| Audio lifecycle, course/card/Quiz publication and task mutations | Audited result contracts return IDs, own inputs, progress or publication status. Worker source/body reads use the ordinary-only guard. | Original write/access policy always on; teaching lineage Responses |
| `GET /api/learn/section-cache-payload` | Paired section delivery mutation; no query bypass. | Responses; original access always on |
| Owner, shared and interjection Audio media GET routes | Preparation, private fetch, then credentialed delivery before every chunk; one receipt per request. | Responses; original access always on |
| `POST /api/audio-overview/interject` | Metadata-only preparation/status reads; final V2 answer uses the delivery mutation. Legacy answer delivery retains its admitted guard. | Responses; original access always on |
| `POST /api/chat/general`, `/api/rag/chat`, `/api/rag/search` | Existing pre-retrieval/dispatch admission, result pin/lineage validation, delivery accounting and per-chunk recheck; exact canonical answers are signed before persistence; history-bearing answers carry explicit unknown scope. | Responses; original access always on |
| Quiz topics/generation, flashcard generation, course outline/section generation, Audio generation and job step HTTP routes | Existing ordinary-only generation admission before retrieval/dispatch; stored reads now enforce their own boundary as well. | Responses; original access always on |
| Learn source fetch/review and public search actions | Existing contextual admission and actual source/result delivery accounting; no provider calls in regressions. | Responses; original access always on |
| `GET /api/export/me`, original document reads/downloads | Existing mandatory personal export authorization and fixed privacy projections, including direct RPC; teaching copies additionally use the shared current-authority resolver. | Original export policy always on; new teaching revocation Responses |

Off-state parity is registered in `convex/learnV2DisclosureOffParity.test.ts`: unsigned/v1/known/unknown chat, new message fields with and without signing configuration, legacy review/snapshot origins, deleted-source copies and exports, anonymous/owner shares, large legacy collections, source review and unchanged teaching exposures. `server/api/disclosure-off-parity.test.ts` covers registered media and section-cache queries plus inactive retrieval/admission adapters. The registered RAG suite also forwards an off-state answer larger than the enabled provenance-buffer limit without accounting. Capability-on regressions retain their denial and revocation assertions.

Regression inventory: registered deletion/restriction read/delivery and export matrices, origin-rebinding probes and reactivity/accounting controls in `convex/learnV2TeachingReads.test.ts`; signed write/replay probes in `convex/learnV2HelpConsumers.test.ts`; registered HTTP/media/stream probes in `server/api/teaching-read-delivery.test.ts` and existing help-consumer tests. Original C1/C2 privacy, export and lineage suites remain required. The query inventory is checked against public registrations to require an explicit audit entry for a new query.

C5.5 registered-boundary evidence is in `convex/learnV2CanvasContract.test.ts`: attachment and lost grant/attachment receipts; exact prompt/stimulus/response-format projection; Today/Canvas grant and acceptance races, including the merged Today `startStudySession` route with `flow_mismatch`; cold, delayed, retained and ordinary pass/fail score/replay; lifecycle withholding and reconciliation without redispatch; direct-V2 pilot/entitlement denial; diagnostic versus legacy authority; contribution-lineage rejection; and the actual Phase A UUID/fallback key shapes. Provider replies and publication validation evidence are synthetic. Grant, acceptance and scoring authority are not mocked. These checks establish local application behavior, not production admission or learning outcomes.
