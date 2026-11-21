# C4 teaching read audit

Scope: public Convex query registrations and content-bearing mutation/action/HTTP results for PR #514, following round A5. This inventory describes code and local regression coverage; it is not a deployment or provider validation.

The responses capability remains default-off. New message writes are always verified: v3 binds owner, role, exact content, every source field and the stored scope. Assistant writes require a server receipt. Convex signs learner prose with unknown teaching scope. New client model/audio context is stripped. Replay checks the retained receipt and returns stored strings without normalization. Legacy v1, unsigned teaching, v2 empty/folder-only references and v3 unknown scope have no source authority; no conversation-folder fallback is used. The only production message insertion is `messages.appendMessage`; the other message writers delete rows. There is no public content/scope patch API.

Signed source references are also resolved against current document/folder ownership, access, retained source identities/snapshots/excerpts and teaching lineage before replay, including ordinary and default-off history. Revocation withholds assistant/source content while preserving valid learner prose. Message export uses the same checks after its mandatory export authorization and reports `evidence_unavailable`; a fresh authorization cannot restore revoked quotes. Access validation is bounded to 64 references, 64 retained identities and 64 snapshots, with the existing folder, privacy-read and lineage budgets. It never repairs or re-pins a stale lineage during replay.

Schema changes are additive. `messages.helpScope` accepts v3 with an explicit `known`, `unknown` or `independent` state and nullable references, while retaining v1/v2 for existing rows. `quizAnswerAssessments.questionSnapshot` adds optional `scopeVersion` and `sourceDocumentId`; new snapshots bind their original source rather than accepting a replacement question's source. `reviewItems.sourceVersionId` records the immutable flashcard version used by new copies. Legacy copies without that origin remain unavailable. These retained origin fields are omitted from learner projections. No backfill, table, index, flag activation or migration is introduced.

Unknown is never an empty source set. All replay/export aliases withhold unknown assistant text, excerpts, source names, model/context fields and quotes, report `evidence_unavailable`, and preserve valid learner prose. Fresh retrieval or history-bearing answers never receive an independent receipt. History-bearing RAG signs `unknown` with null references; persistence stores a signed unavailable tombstone, not an unscoped protected copy. Independent receipts exist only for new general answers that used neither retrieval nor history, and still cannot establish irrelevance during an open check. v2 known document receipts retain exact-byte verification and live authority checks.

Queries cannot create exposure. After admission, a teaching query with relevant formative work reads its normal projection dependencies and throws `help_delivery_required` with an opaque HMAC revision, never the body. The revision covers that projection, its current source scope and the bounded open-opportunity identities/revisions. The existing subscription re-requests its paired delivery mutation when the signal changes, reusing its delivery key; exposure remains deduplicated per key, help kind and opportunity even when the current source set changes. Current scope is always revalidated and is not an authorization supplied by the receipt. This applies through the shared wrapper to every `delivery` and `media_locator` row below. Held-out denial occurs before the content handler. Admission precedes construction and dispatch; the mutation records assistance only for a substantive returned body. Empty/unavailable projections and failures roll back or create no delivered exposure. Denied mutations return an admission with a null value, preserving non-delivered denial records. Scope follows source IDs, source manifests and bounded lineage dependencies/origins. Missing provenance and exhausted bounds deny rather than infer irrelevance from a container.

Every wrapped read and its delivery/preparation alias now resolves current authority through `teachingReadScope`, even without an open opportunity and with responses off. The wrapper accepts only scopes validated within that invocation; null, empty targets, folder-only scope, exhausted bounds or a failed dependency cannot authorize teaching. Scope validation checks live ownership/status, source retention and tombstones, current document access, every active artifact key's exact payload/lineage and its transitive source/origin pins using the existing pure C4 admission guard. Delivery handlers receive a read-only database context, so existing producer helpers cannot re-pin or repair a publication while reading it. The same authority resolver protects copied teaching in authorized export; source-free legacy copies become unavailable tombstones while learner answers remain available.

Each authority resolution uses the existing 3,072-read privacy budget, 64 source references, 64 lineage nodes, 256 edges and 512 targets, depth 8 and 1,024 visited result rows. Per-kind ranges have explicit overflow checks (200 questions/cards/assessments, 32 claims, 16 session blocks, 8 supports/origins). Overflow withholds teaching. Export pages remain capped at eight rows and reuse the request's budget.

| Read family, including paired aliases | Current authority check |
| --- | --- |
| `courses.get`, `listByUser`, `listByFolder` | Owned course and its declared document sources; live document access, retention and lineage. An absent source list cannot authorize an outline. |
| `courseSections.get`, `listByCourse`, `getNextSection`, `getOfflineCachePayload` and HTTP section cache | Every retained section key through C4 payload/lineage admission; nested quizzes, versions and Audio; unregistered sections require declared course sources. The offline cache is not authority. |
| `quizzes.getWithQuestions` and teaching-returning Quiz mutations | Every question's current lineage and source document; no ordinary/flag-off shortcut. |
| `quizzes.getAttemptResults`, pending grading inputs and corresponding submission results | Current question authority plus the frozen snapshot's versioned original document binding, independent of later question edits. Missing/substituted snapshot origins are unavailable. Learner answers remain exportable. |
| `flashcardRooms.getRoom`, `getRoomVersion`, `listRoomVersions` | Immutable version payload/lineage and each card's document source; live card content must match the current version. |
| All three `reviewItems` readers | Each actual review row, its retained `sourceVersionId`, matching version card, current card, section and original sources. A container's scope cannot authorize copied text. |
| Legacy Audio turns, URLs, course playback and token shares | Live owner/publication plus Audio artifact payload/lineage and original document sources. |
| V2 Audio playback, media and interjection reads/token shares | Episode/interjection publication and current artifact lineage; manifest/task document revision, hash, object-key and folder pins. Media follows its actual publication, not just the job's folder. |
| `learnV2Sources.listSourceReview`, Journey mission reads | Current retained snapshots/excerpts, rights, void/folder ownership and backing document authority. Safe unavailable summaries may remain. |
| `learnV2SessionContent.getSessionContent`, assistance replay | Selected content revision, every block lineage, claim supports and retained source snapshots; no current-void fallback for a deleted support. |
| Adaptive Canvas, artifact/reflection and evidence reads | Actual activity (including requested historical evidence), its session blocks and source snapshots. A source-free non-factual plan must replay canonically without evidence or generation content; an attributed conversion may use only verified learner-authored chat prose. |
| Message history/replay and message export | Exact receipt integrity plus current signed source authority; unknown scope withholds all assistant/source-derived content. Own learner text is separate. |
| Authorized export of teaching copies | `exportTeachingCopy` calls the same current authority resolver for course/section, Quiz/snapshot, card/version/review and Audio/transcript families. Unknown/revoked copies return non-sensitive unavailable tombstones; lawful export authorization alone is not source permission. |
| Worker-only inputs | Existing ordinary-only contextual and C4 lineage guards; pending Quiz inputs additionally resolve frozen source authority. They are not learner delivery acknowledgements. |
| `tasks.get`, `tasks.listByFolder` and task export | Fixed task summaries retain learner-authored titles, closed progress/error states, counts and validated navigation IDs; cached provider results and arbitrary metadata are never returned. |
| Metadata, assessment and own-work rows below | Existing fixed projections/ownership/grants; no generated body or source excerpt is introduced. Original-file export retains its disclosed exception. |

Private media is prepared before R2 access, then a server-held credential is required for authenticated media delivery before forwarding each chunk. A learner cannot forge that accounting acknowledgement. The same receipt is reused for all chunks, so partial delivery counts once and later failure retains that fact. No chunk is prefetched into the downstream stream. This costs one bounded Convex delivery mutation per upstream media chunk; each invocation revalidates current admission, lineage and source pins. Metadata preparation and failed fetches record no delivered assistance.

The four share-token query families and their aliases explicitly permit anonymous ordinary teaching. Their existing live token, publication, owner, lineage and source-pin checks still apply. Anonymous reads do not use or account against the publisher's opportunity. Authenticated reads continue through the viewer's contextual admission; an owner cannot bypass their own held-out check by using their share token.

The personal export/original-file exception follows [the disclosure resolution, section 3.5](https://github.com/wescodess/budds/issues/373#issuecomment-6651824980): do not suspend lawful export during an open check; require its existing bounded export authorization and contamination/unknown accounting. Those endpoints do not become unaccounted teaching reads.

All 128 public query names are listed below. Every new `Delivery`/`Preparation` alias belongs to the query in its row.

| Handling | Rule |
| --- | --- |
| `delivery` | Original query permits ordinary work only. The paired `Delivery` mutation admits, constructs the existing projection, and records substantive delivery atomically. |
| `summary_or_own_work` | Audited summary, scheduling, access, neutral identity, or learner-authored work. No generated lesson, answer, source excerpt or playable media body. |
| `media_locator` | Query restricted to ordinary reads. `Preparation` mutation returns only a private R2 locator after admission. Server-credentialed `Delivery` mutation is mandatory before each HTTP audio chunk. |
| `worker_ordinary_only` | Capability/owner and lineage checks remain. Relevant formative, held-out, unavailable and unknown scopes cannot return worker inputs; these are not learner delivery acknowledgements. |
| `personal_export` | Existing mandatory `authorizePersonalExport` and `requirePersonalExportAuthorization`; original files and personal records remain available under the disclosure resolution, with imported/unknown exposure before release. |
| `assessment_or_own_response` | Existing C1/C2 fixed assessment, grant, own-work and unavailable projections. No implicit teaching or new assessment grant. |
| `message_metadata` | With responses enabled, metadata and permitted learner prose only. Assistant/source replay uses `messages.replayByConversation`, which verifies retained signatures and commits delivery. |

| Public query | Handling |
| --- | --- |
| `audioOverviewInterjections.getTurnUrls` | `delivery` |
| `audioOverviewInterjections.listByOverview` | `delivery` |
| `audioOverviewInterjectionsV2.getForOwner` | `delivery` |
| `audioOverviewInterjectionsV2.getStatusForOwner` | `summary_or_own_work` |
| `audioOverviewInterjectionsV2.resolveMediaForOwner` | `media_locator` |
| `audioOverviewJobs.getAlignmentContext` | `worker_ordinary_only` |
| `audioOverviewJobs.getStepContext` | `worker_ordinary_only` |
| `audioOverviewRooms.getForConversation` | `summary_or_own_work` |
| `audioOverviewRooms.listByFolder` | `summary_or_own_work` |
| `audioOverviews.getByShareToken` | `delivery` |
| `audioOverviews.getCourseScopedOverview` | `delivery` |
| `audioOverviews.getInterjectionMetadata` | `summary_or_own_work` |
| `audioOverviews.getTurnUrls` | `delivery` |
| `audioOverviews.getTurnUrlsByShareToken` | `delivery` |
| `audioOverviews.getWithTurns` | `delivery` |
| `audioOverviews.listByFolder` | `summary_or_own_work` |
| `audioOverviews.listByRoom` | `summary_or_own_work` |
| `audioOverviewV2.getForWorkflow` | `worker_ordinary_only` |
| `audioOverviewV2.getPlaybackByShareToken` | `delivery` |
| `audioOverviewV2.getPlaybackForOwner` | `delivery` |
| `audioOverviewV2.listAlignmentSegments` | `worker_ordinary_only` |
| `audioOverviewV2.resolveMediaByShareToken` | `media_locator` |
| `audioOverviewV2.resolveMediaForOwner` | `media_locator` |
| `calendarConnections.getByUser` | `summary_or_own_work` |
| `calendarEvents.listByCourse` | `summary_or_own_work` |
| `calendarEvents.listByUser` | `summary_or_own_work` |
| `calendarEvents.listScheduled` | `summary_or_own_work` |
| `contentFlags.getFlagRateForCourse` | `summary_or_own_work` |
| `conversations.getConversation` | `summary_or_own_work` |
| `conversations.getMostRecentForFolder` | `summary_or_own_work` |
| `conversations.listRecentForUser` | `summary_or_own_work` |
| `courses.get` | `delivery` |
| `courses.listByFolder` | `delivery` |
| `courses.listByUser` | `delivery` |
| `courseSections.checkPreFetchStatus` | `summary_or_own_work` |
| `courseSections.get` | `delivery` |
| `courseSections.getNextSection` | `delivery` |
| `courseSections.getOfflineCachePayload` | `delivery` |
| `courseSections.listByCourse` | `delivery` |
| `courseSourceDocs.listByCourse` | `summary_or_own_work` |
| `dataExport.getAttemptAnswersPage` | `personal_export` |
| `dataExport.getCourseSourceDocsPage` | `personal_export` |
| `dataExport.getDocumentDownloadUrl` | `personal_export` |
| `dataExport.getExportMetadata` | `summary_or_own_work` |
| `dataExport.getUserDataPage` | `personal_export` |
| `documents.countsByFolder` | `summary_or_own_work` |
| `documents.getTeachingScope` | `summary_or_own_work` |
| `documents.listDocumentsByFolder` | `summary_or_own_work` |
| `flashcardRooms.getRoom` | `delivery` |
| `flashcardRooms.getRoomVersion` | `delivery` |
| `flashcardRooms.listRoomsByFolder` | `summary_or_own_work` |
| `flashcardRooms.listRoomVersions` | `delivery` |
| `folders.getFolder` | `summary_or_own_work` |
| `folders.getFolderDescendantCounts` | `summary_or_own_work` |
| `folders.listAllFolders` | `summary_or_own_work` |
| `folders.listChildFolders` | `summary_or_own_work` |
| `folders.listSubtree` | `summary_or_own_work` |
| `folders.listTopLevelFolders` | `summary_or_own_work` |
| `folders.resolveScope` | `summary_or_own_work` |
| `folders.searchScopeItems` | `summary_or_own_work` |
| `learnAdaptive.getArtifactCanvas` | `delivery` |
| `learnAdaptive.getMemory` | `summary_or_own_work` |
| `learnAdaptive.getReflectionCanvas` | `delivery` |
| `learnAdaptive.getThread` | `summary_or_own_work` |
| `learnAdaptive.inspectContributionSource` | `summary_or_own_work` |
| `learnAdaptive.listPromotionProposals` | `summary_or_own_work` |
| `learnAdaptive.listResumeCandidates` | `summary_or_own_work` |
| `learnAdaptive.listThreadArtifacts` | `summary_or_own_work` |
| `learnAdaptive.listThreadContributions` | `summary_or_own_work` |
| `learnAdaptive.listThreadHistory` | `summary_or_own_work` |
| `learnAdaptiveAccess.adaptiveStatus` | `summary_or_own_work` |
| `learnAdaptiveCanvas.getCanvas` | `delivery` |
| `learnAdaptiveClarifications.getInitialDecision` | `summary_or_own_work` |
| `learnAdaptiveDrafts.getThreadDraft` | `summary_or_own_work` |
| `learnAdaptiveEvidence.getThreadActivityEvidence` | `delivery` |
| `learnAdaptiveExperiment.getGuardrailStatus` | `summary_or_own_work` |
| `learnAdaptiveExperiment.getMyStatus` | `summary_or_own_work` |
| `learnAdaptiveRecovery.getDiagnosticCanvas` | `summary_or_own_work` |
| `learnAdaptiveRouting.replayDecision` | `summary_or_own_work` |
| `learnProfile.getProfile` | `summary_or_own_work` |
| `learnV2Access.status` | `summary_or_own_work` |
| `learnV2Assessments.getAssessment` | `assessment_or_own_response` |
| `learnV2Assessments.getAssessmentState` | `assessment_or_own_response` |
| `learnV2Assessments.getFeatureReadiness` | `assessment_or_own_response` |
| `learnV2Assessments.getPostSealTeaching` | `assessment_or_own_response` |
| `learnV2Blueprints.getBlueprintGenerationJob` | `summary_or_own_work` |
| `learnV2Blueprints.getBlueprintMap` | `summary_or_own_work` |
| `learnV2Calendar.getStatus` | `summary_or_own_work` |
| `learnV2Calendar.listProjections` | `summary_or_own_work` |
| `learnV2CalendarReconciliation.listProposals` | `summary_or_own_work` |
| `learnV2FolderManifests.getLatestManifestForBlueprint` | `summary_or_own_work` |
| `learnV2FolderManifests.getManifest` | `summary_or_own_work` |
| `learnV2FolderManifests.listManifestEntries` | `summary_or_own_work` |
| `learnV2FolderManifests.listManifestFolders` | `summary_or_own_work` |
| `learnV2Journey.getCurrentMission` | `delivery` |
| `learnV2Journey.getMission` | `delivery` |
| `learnV2Journey.getSessionCandidate` | `summary_or_own_work` |
| `learnV2Journey.listHub` | `summary_or_own_work` |
| `learnV2Lifecycle.getBlueprintRevision` | `summary_or_own_work` |
| `learnV2Lifecycle.getLearningVoid` | `summary_or_own_work` |
| `learnV2Lifecycle.listLearningVoids` | `summary_or_own_work` |
| `learnV2MeasurementReports.exportAggregateReport` | `summary_or_own_work` |
| `learnV2MeasurementReports.getReport` | `summary_or_own_work` |
| `learnV2MeasurementReports.getReportCells` | `summary_or_own_work` |
| `learnV2Plans.getPlanPreview` | `summary_or_own_work` |
| `learnV2Responses.getResponseState` | `assessment_or_own_response` |
| `learnV2Search.quotaStatus` | `summary_or_own_work` |
| `learnV2SessionContent.getSessionContent` | `delivery` |
| `learnV2Sources.getSource` | `summary_or_own_work` |
| `learnV2Sources.listSourceReview` | `delivery` |
| `learnV2Sources.listSources` | `summary_or_own_work` |
| `learnV2Today.getToday` | `summary_or_own_work` |
| `messages.listByConversation` | `message_metadata` |
| `quizAnswerAssessments.listPendingForAttempt` | `worker_ordinary_only` |
| `quizAnswerAssessments.listPendingForShadowAttempt` | `worker_ordinary_only` |
| `quizzes.getAttemptResults` | `delivery` |
| `quizzes.getQuizHistory` | `summary_or_own_work` |
| `quizzes.getWithQuestions` | `delivery` |
| `quizzes.listAttempts` | `summary_or_own_work` |
| `quizzes.listByFolder` | `summary_or_own_work` |
| `reviewItems.getReviewBacklogCount` | `summary_or_own_work` |
| `reviewItems.listBySection` | `delivery` |
| `reviewItems.listDueForUser` | `delivery` |
| `reviewItems.listDueWithContext` | `delivery` |
| `tasks.get` | `summary_or_own_work` |
| `tasks.listByFolder` | `summary_or_own_work` |
| `users.getDailyQuota` | `summary_or_own_work` |
| `users.getUser` | `summary_or_own_work` |

Additional content returns audited:

| Entry point | Handling |
| --- | --- |
| `messages.appendMessage`, `messages.replayByConversation` | Exact role-bound signed writes and verified, accounted replay; current source access is checked even for ordinary replay; legacy teaching is unknown. |
| `quizzes.startAttempt`, `submitAnswer`, `submitAllAnswers`, `submitAttempt`, `updateQuestion`, `updateQuiz` | Admission before the handler and substantive returned teaching accounted in the same mutation. Metadata-only updates do not count. |
| `learnV2Mastery.recordAssistanceUse` | Contextual admission and delivered assistance also cover the legacy hint/reveal replay path. |
| Assessment delivery/submission/calibration actions and receipts | Existing C1/C2 fixed grants, own work, closed feedback and references; no raw scoring payload or implicit teaching grant. |
| Audio lifecycle, course/card/Quiz publication and task mutations | Audited result contracts return IDs, own inputs, progress or publication status. Worker source/body reads use the ordinary-only guard. |
| `GET /api/learn/section-cache-payload` | Paired section delivery mutation; no query bypass. |
| Owner, shared and interjection Audio media GET routes | Preparation, private fetch, then credentialed delivery before every chunk; one receipt per request. |
| `POST /api/audio-overview/interject` | Metadata-only preparation/status reads; final V2 answer uses the delivery mutation. Legacy answer delivery retains its admitted guard. |
| `POST /api/chat/general`, `/api/rag/chat`, `/api/rag/search` | Existing pre-retrieval/dispatch admission, result pin/lineage validation, delivery accounting and per-chunk recheck; exact canonical answers are signed before persistence; history-bearing answers carry explicit unknown scope. |
| Quiz topics/generation, flashcard generation, course outline/section generation, Audio generation and job step HTTP routes | Existing ordinary-only generation admission before retrieval/dispatch; stored reads now enforce their own boundary as well. |
| Learn source fetch/review and public search actions | Existing contextual admission and actual source/result delivery accounting; no provider calls in regressions. |
| `GET /api/export/me`, original document reads/downloads | Existing mandatory personal export authorization and fixed privacy projections, including direct RPC; teaching copies additionally use the shared current-authority resolver. |

Regression inventory: registered deletion/restriction read/delivery and export matrices, origin-rebinding probes and reactivity/accounting controls in `convex/learnV2TeachingReads.test.ts`; signed write/replay probes in `convex/learnV2HelpConsumers.test.ts`; registered HTTP/media/stream probes in `server/api/teaching-read-delivery.test.ts` and existing help-consumer tests. Original C1/C2 privacy, export and lineage suites remain required. The query inventory is checked against public registrations to require an explicit audit entry for a new query.
