/* eslint-disable @typescript-eslint/no-explicit-any -- Convex generated journey projection is intentionally adapted at this single boundary. */
import { computed, ref, toValue, watch, type MaybeRef } from 'vue'
import { api } from '#convex/api'
import type { LearnAssessmentContract, LearnHubSnapshot, LearnMissionSnapshot, LearnOutcomeDraft, LearnPlanSnapshot, LearnReadinessItem, LearnSourceSnapshot, LearnObjectiveSnapshot, LearnMapEdit, LearnScheduleInput } from '~/types/learn-v2-journey'
import { parseLearnV2PlanResult } from '~/utils/learn-v2-plan-result'
import { applyLearnMapEdit, type LearnMapCandidate } from '~/utils/learn-v2-map-editor'

type Mission = any
const key = (name: string) => `${name}:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
const dateTime = (value?: number | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value) : 'Not scheduled yet'
const sourceFailureMessage = (reason?: string) => (({
  authentication_required: 'This source requires sign-in, so Budds cannot retrieve it. Add a public replacement.',
  robots_denied: 'The publisher does not allow automated retrieval. Add a public replacement.',
  policy_denied: 'The source cannot be used under the evidence policy. Add a public replacement.',
  unsupported_mime: 'This source format is not supported. Add an HTML, plain-text, or PDF replacement.',
  declared_size_overflow: 'This source is too large to review safely. Add a smaller replacement.',
  wire_size_overflow: 'This source is too large to review safely. Add a smaller replacement.',
  decoded_size_overflow: 'This source is too large to review safely. Add a smaller replacement.',
} as Record<string, string>)[reason ?? ''] ?? 'Budds could not retrieve this source safely. Retry if it was temporary, or add a public replacement.')
const retryableSourceMessage = (reason?: string) => reason === 'rate_limited' || reason === 'owner_capacity' || reason === 'global_capacity'
  ? 'Evidence checks are busy right now. Retry in a moment.'
  : 'The evidence check did not finish. Retry the source.'
const mapStatus = (status: string): LearnMissionSnapshot['lifecycle'] => (({ draft: 'draft', sourcing: 'source_review', source_review: 'source_review', map_review: 'map_review', calibration: 'calibration', plan_review: 'plan_review', scheduled: 'active', active: 'active', needs_attention: 'blocked', failed: 'blocked', paused: 'blocked', archived: 'superseded', completed: 'superseded' } as const)[status as keyof Record<string, LearnMissionSnapshot['lifecycle']>] ?? 'draft')

function nextAction(row: any) {
  const actions: Record<string, LearnMissionSnapshot['nextAction']> = {
    source_selection: { kind: 'finish_setup', label: 'Continue source setup', detail: 'Choose the evidence that can support this learning plan.' },
    source_review: { kind: 'review_sources', label: 'Review sources', detail: 'Accept evidence before generating your learning map.' },
    blueprint_generation: { kind: 'review_sources', label: 'Generate learning map', detail: 'Your accepted evidence is ready to shape into capabilities.' },
    map_review: { kind: 'review_map', label: 'Review learning map', detail: 'Confirm the capabilities and prerequisites before calibration.' },
    calibration: { kind: 'calibrate', label: 'Calibrate your starting point', detail: 'A short cold attempt tailors the schedule; it does not award mastery.' },
    plan_preview: { kind: 'review_plan', label: 'Build plan preview', detail: 'Check feasibility, buffers, and your first sessions.' },
    plan_acceptance: { kind: 'review_plan', label: 'Review plan', detail: 'Accept an in-app plan before sessions are scheduled.' },
    mastery: { kind: 'resume_session', label: 'Resume session', detail: 'Finish your current deliberate-practice session.' },
    study_session: { kind: 'start_session', label: 'Start next session', detail: 'Your next evidence-grounded practice is ready.' },
  }
  return actions[row.nextAction] ?? { kind: 'resolve_block', label: 'Review learning plan', detail: 'This plan needs attention before it can continue.' }
}

function missionSnapshot(row: any): LearnMissionSnapshot {
  const mastery = row.mastery ?? []
  const states = mastery.map((item: any) => item.record?.state ?? 'unseen')
  return { id: String(row.learningVoid?._id ?? row._id), title: row.learningVoid?.title ?? row.title ?? 'Learning plan', folderName: row.folder?.name ?? 'Folder', lifecycle: mapStatus(row.learningVoid?.status ?? row.status ?? 'draft'), nextAction: nextAction(row), mastery: { retained: states.filter((state: string) => state === 'retained').length, independent: states.filter((state: string) => state === 'independent').length, learning: states.filter((state: string) => ['learning', 'guided', 'provisionally_known'].includes(state)).length, needsReview: states.filter((state: string) => state === 'needs_review').length, total: Math.max(states.length, row.map?.objectives?.length ?? 0) }, upcomingLabel: row.plan?.sessions?.[0] ? `Next: ${dateTime(row.plan.sessions[0].scheduledStartAt)}` : undefined }
}

export function useLearnV2Journey(learningVoidId?: MaybeRef<string | null | undefined>) {
  const { allowed, checkingAccess } = useLearnV2Access()
  const id = computed(() => toValue(learningVoidId) ?? null)
  // The Convex Vue query adapter owns the args ref while subscribing. Passing
  // a computed here causes it to attempt a write to readonly state on route
  // hydration, which surfaces as NUXT_E1001 in the browser.
  const missionArgs = ref<{ learningVoidId: string | null }>({ learningVoidId: id.value })
  watch(id, learningVoidId => { missionArgs.value = { learningVoidId } }, { flush: 'sync' })
  const hubQuery = import.meta.client ? useConvexQuery(api.learnV2Journey.listHub, {}, { enabled: allowed }) : { data: ref<any>(null), pending: ref(false) }
  const missionQuery = import.meta.client ? useConvexQuery(api.learnV2Journey.getMission, missionArgs as never, { enabled: computed(() => allowed.value && !!id.value) }) : { data: ref<Mission | null>(null), pending: ref(false) }
  const sourceReviewArgs = ref<{ blueprintRevisionId: string | null; paginationOpts: { cursor: null; numItems: number } }>({ blueprintRevisionId: null, paginationOpts: { cursor: null, numItems: 64 } })
  const createVoid = import.meta.client ? useConvexMutation(api.learnV2Lifecycle.createLearningVoid) : { mutate: async () => null }
  const updateVoidDraft = import.meta.client ? useConvexMutation(api.learnV2Lifecycle.updateLearningVoidDraft) : { mutate: async () => null }
  const createBlueprint = import.meta.client ? useConvexMutation(api.learnV2Lifecycle.createBlueprintDraft) : { mutate: async () => null }
  const transitionVoid = import.meta.client ? useConvexMutation(api.learnV2Lifecycle.transitionLearningVoid) : { mutate: async () => null }
  const transitionBlueprint = import.meta.client ? useConvexMutation(api.learnV2Lifecycle.transitionBlueprintRevision) : { mutate: async () => null }
  const freezeManifest = import.meta.client ? useConvexMutation(api.learnV2FolderManifests.freezeManifest) : { mutate: async () => null }
  const configureIntent = import.meta.client ? useConvexMutation(api.learnV2Blueprints.configureBlueprintIntent) : { mutate: async () => null }
  const startGeneration = import.meta.client ? useConvexMutation(api.learnV2Blueprints.startBlueprintGeneration) : { mutate: async () => null }
  const forkBlueprint = import.meta.client ? useConvexMutation(api.learnV2Lifecycle.forkBlueprintDraft) : { mutate: async () => null }
  const replaceMap = import.meta.client ? useConvexMutation(api.learnV2MapCalibration.replaceDraftMap) : { mutate: async () => null }
  const acceptSourceMutation = import.meta.client ? useConvexMutation(api.learnV2Sources.acceptSource) : { mutate: async () => null }
  const rejectSourceMutation = import.meta.client ? useConvexMutation(api.learnV2Sources.rejectSource) : { mutate: async () => null }
  const prepareFolderSource = import.meta.client ? useConvexMutation(api.learnV2Sources.prepareFolderSourceForReview) : { mutate: async () => null }
  const prepareFetchedSource = import.meta.client ? useConvexMutation(api.learnV2Sources.prepareFetchedSourceForReview) : { mutate: async () => null }
  const registerCandidate = import.meta.client ? useConvexMutation(api.learnV2Sources.registerCandidate) : { mutate: async () => null }
  const fetchAndPrepare = import.meta.client ? useConvexAction(api.learnV2SourceActions.fetchAndPrepareSourceForReview) : { mutate: async () => null }
  const searchPublicWeb = import.meta.client ? useConvexAction(api.learnV2SearchActions.searchPublicWeb) : { mutate: async () => null }
  const acceptMap = import.meta.client ? useConvexMutation(api.learnV2MapCalibration.acceptBlueprintMap) : { mutate: async () => null }
  const submitCalibration = import.meta.client ? useConvexAction(api.learnV2MapCalibration.submitCalibrationAttempt) : { mutate: async () => null }
  const completeCalibrationMutation = import.meta.client ? useConvexMutation(api.learnV2MapCalibration.completeCalibration) : { mutate: async () => null }
  const createPreviewMutation = import.meta.client ? useConvexMutation(api.learnV2Plans.createPlanPreview) : { mutate: async () => null }
  const editPreviewMutation = import.meta.client ? useConvexMutation(api.learnV2Plans.editPlanPreview) : { mutate: async () => null }
  const acceptPreviewMutation = import.meta.client ? useConvexMutation(api.learnV2Plans.acceptPlanPreview) : { mutate: async () => null }
  const error = ref<string | null>(null)
  const busy = ref(false)
  const savedDraft = ref<{ id: string, folderId: string, voidRevision: number, blueprintId: any, blueprintRecordRevision: number } | null>(null)
  const researching = ref(false)
  const researchResults = ref<Array<{ title: string; url: string; snippet?: string }>>([])
  const mission = computed(() => missionQuery.data.value as Mission | null | undefined)
  watch(mission, value => { sourceReviewArgs.value = { blueprintRevisionId: value?.currentBlueprint?._id ?? null, paginationOpts: { cursor: null, numItems: 64 } } }, { flush: 'sync' })
  const sourceReviewQuery = import.meta.client ? useConvexQuery(api.learnV2Sources.listSourceReview, sourceReviewArgs as never, { enabled: computed(() => allowed.value && !!sourceReviewArgs.value.blueprintRevisionId) }) : { data: ref<any>(null), pending: ref(false) }
  const hub = computed<LearnHubSnapshot>(() => {
    const rows = (hubQuery.data.value as any)?.items ?? []
    const missions = rows.map((row: any) => missionSnapshot(row))
    return { missions, today: missions.find((item: LearnMissionSnapshot) => ['start_session', 'resume_session', 'review_now'].includes(item.nextAction.kind)) ?? missions[0] ?? null }
  })
  const snapshot = computed(() => mission.value ? missionSnapshot(mission.value) : null)
  const sources = computed<LearnSourceSnapshot[]>(() => ((sourceReviewQuery.data.value as any)?.page ?? mission.value?.sources?.items ?? []).map((row: any) => ({ id: String(row._id), sourceKey: String(row.identity?._id ?? row.sourceIdentityId), title: row.identity?.title ?? row.title ?? row.publicLocator ?? 'Evidence source', origin: row.identity?.origin ?? row.origin ?? 'folder_document', publisher: row.identity?.publisherDomain ?? row.publisherDomain ?? (row.publicLocator ? new URL(row.publicLocator).hostname : undefined), retrievedLabel: row.retrieval?.fetchedAt || row.retrievedAt ? `Retrieved ${dateTime(row.retrieval?.fetchedAt ?? row.retrievedAt)}` : (row.effectiveStatus ?? row.status).replaceAll('_', ' '), coverage: row.effectiveStatus === 'unavailable' ? 'gap' : row.effectiveStatus === 'user_accepted' ? 'strong' : 'partial', lifecycle: row.effectiveStatus ?? row.status, objectives: row.reviewedObjectives?.map((objective: any) => objective.title) ?? row.mappedObjectives?.map((objective: any) => objective.title) ?? [], accessNote: (row.effectiveStatus ?? row.status) === 'unavailable' ? sourceFailureMessage(row.unavailableReason) : row.rights?.access === 'locator_only' ? 'The original is available by locator, but Budds cannot retain an excerpt.' : undefined, excerpt: typeof row.excerpt === 'string' ? row.excerpt : row.excerpt?.text, originalUrl: typeof row.publicLocator === 'string' ? row.publicLocator : undefined })))
  const canResearch = computed(() => mission.value?.currentBlueprint?.sourcePolicy !== 'folder_only')
  const objectives = computed<LearnObjectiveSnapshot[]>(() => {
    const map = mission.value?.map
    if (!map) return []
    const objectiveKeyById = new Map(map.objectives.map((row: any) => [String(row._id), row.stableKey ?? `objective-${row.order + 1}`]))
    return map.objectives.map((row: any) => {
      const milestone = map.milestones.find((item: any) => String(item._id) === String(row.milestoneId))
      const assessmentContract = row.assessmentContract as LearnAssessmentContract
      const sourceLinks = (row.sourceLinks ?? []).map((link: any) => {
        const source = mission.value?.sources?.items?.find((item: any) => String(item._id) === String(link.sourceSnapshotId))
        return { sourceKey: String(source?.identity?._id ?? source?.sourceIdentityId ?? link.sourceSnapshotId), title: source?.identity?.title ?? source?.title ?? source?.publicLocator ?? 'Evidence source', origin: source?.identity?.origin ?? source?.origin ?? 'folder_document', coverage: link.coverage, evidenceStatus: link.evidenceStatus ?? 'evidence_available' }
      })
      return { id: String(row._id), stableKey: row.stableKey ?? `objective-${row.order + 1}`, title: row.title, capability: row.capability, milestoneKey: milestone?.stableKey ?? `milestone-${(milestone?.order ?? 0) + 1}`, milestone: milestone?.title ?? 'Capability', effortMinutes: row.estimatedMinutes ?? 25, depth: row.depth ?? ({ overview: 'foundational', working: 'working', deep: 'advanced' } as const)[mission.value?.currentBlueprint?.desiredDepth as 'overview' | 'working' | 'deep'] ?? 'working', mastery: mission.value?.mastery?.find((entry: any) => String(entry.objectiveId) === String(row._id))?.record?.state ?? 'unseen', coverage: row.coverage ?? 'gap', gapReason: row.gapReason, prerequisiteIds: row.prerequisiteObjectiveIds?.map(String) ?? [], prerequisiteKeys: row.prerequisiteObjectiveIds?.map((id: unknown) => objectiveKeyById.get(String(id))).filter(Boolean) ?? [], assessment: assessmentContract?.instructions ?? 'Assessment contract pending review', assessmentContract, sourceLinks }
    })
  })
  const readiness = computed<LearnReadinessItem[]>(() => { const row = mission.value; if (!row) return []; const status = row.learningVoid.status; return [{ id: 'outcome', label: 'Outcome', state: row.currentBlueprint?.desiredOutcome ? 'complete' : 'current' }, { id: 'sources', label: 'Sources', state: row.sources.counts.accepted ? 'complete' : status === 'source_review' || status === 'sourcing' ? 'current' : 'locked', detail: row.sources.counts.accepted ? `${row.sources.counts.accepted} accepted` : 'Accept evidence' }, { id: 'map', label: 'Learning map', state: row.map?.objectives?.length ? 'complete' : status === 'map_review' ? 'current' : 'locked' }, { id: 'plan', label: 'Study plan', state: row.plan?.accepted ? 'complete' : status === 'plan_review' ? 'current' : 'locked' }] })
  const plan = computed<LearnPlanSnapshot | null>(() => { const row = mission.value; const revision = row?.plan?.preview ?? row?.plan?.accepted; if (!row || !revision) return null; const result = parseLearnV2PlanResult(revision.resultSnapshot); return { feasibility: revision.feasibility ?? 'pending', headline: result.status === 'feasible' ? 'Your plan is feasible' : 'Your plan needs an adjustment', detail: result.reasonCodes?.join(', ') || 'Review the timeline before accepting.', weeklyLoadLabel: 'Based on your availability', targetLabel: revision.timezone, sessions: (row.plan.sessions ?? []).map((session: any) => ({ id: String(session._id), title: objectives.value.find(objective => objective.id === String(session.primaryObjectiveId))?.title ?? 'Study session', when: dateTime(session.scheduledStartAt), durationMinutes: Math.max(1, Math.round((session.scheduledEndAt - session.scheduledStartAt) / 60_000)), kind: session.placementKind ?? 'learning', objectiveId: String(session.primaryObjectiveId) })), alternatives: result.alternatives?.map(item => item.code).filter((code): code is string => typeof code === 'string') } })
  async function run(work: () => Promise<any>) { busy.value = true; error.value = null; try { return await work() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not update this learning plan. Please try again.'; throw cause } finally { busy.value = false } }
  function intentArgs(draft: LearnOutcomeDraft) { return { desiredOutcome: draft.outcome, mode: draft.mode, desiredDepth: draft.depth, sourcePolicy: draft.sourcePolicy, targetLocalDate: draft.targetDate || null, sessionMinutes: draft.sessionMinutes } }
  async function saveOutcomeDraft(folderId: string, draft: LearnOutcomeDraft) { return await run(async () => {
    const existing = mission.value
    if (existing?.learningVoid.status === 'draft' && existing.currentBlueprint?.status === 'draft') {
      if (String(existing.learningVoid.folderId) !== folderId) throw new Error('Choose the folder already attached to this draft')
      const updated: any = await updateVoidDraft.mutate({ learningVoidId: existing.learningVoid._id, title: draft.outcome, expectedRevision: existing.learningVoid.revision, idempotencyKey: key('save-draft-title') })
      const configured: any = await configureIntent.mutate({ blueprintRevisionId: existing.currentBlueprint._id, expectedBlueprintRecordRevision: existing.currentBlueprint.recordRevision, ...intentArgs(draft), idempotencyKey: key('save-draft-intent') })
      savedDraft.value = { id: String(updated._id), folderId, voidRevision: updated.revision, blueprintId: existing.currentBlueprint._id, blueprintRecordRevision: configured.recordRevision }
      return String(updated._id)
    }
    const created: any = await createVoid.mutate({ folderId: folderId as never, title: draft.outcome, idempotencyKey: key('create-void') })
    const blueprint: any = await createBlueprint.mutate({ learningVoidId: created._id, expectedVoidRevision: created.revision, idempotencyKey: key('create-blueprint') })
    const configured: any = await configureIntent.mutate({ blueprintRevisionId: blueprint._id, expectedBlueprintRecordRevision: blueprint.recordRevision, ...intentArgs(draft), idempotencyKey: key('save-draft-intent') })
    savedDraft.value = { id: String(created._id), folderId, voidRevision: created.revision + 1, blueprintId: blueprint._id, blueprintRecordRevision: configured.recordRevision }
    return String(created._id)
  }) }
  async function createMission(folderId: string, draft: LearnOutcomeDraft) { return await run(async () => {
    const existing = mission.value
    const persisted = savedDraft.value
    let id: string; let blueprintId: any; let voidRevision: number; let blueprintRecordRevision: number
    if (existing?.learningVoid.status === 'draft' && existing.currentBlueprint?.status === 'draft') {
      if (String(existing.learningVoid.folderId) !== folderId) throw new Error('Choose the folder already attached to this draft')
      const updated: any = await updateVoidDraft.mutate({ learningVoidId: existing.learningVoid._id, title: draft.outcome, expectedRevision: existing.learningVoid.revision, idempotencyKey: key('resume-draft-title') })
      const configured: any = await configureIntent.mutate({ blueprintRevisionId: existing.currentBlueprint._id, expectedBlueprintRecordRevision: existing.currentBlueprint.recordRevision, ...intentArgs(draft), idempotencyKey: key('resume-draft-intent') })
      id = String(updated._id); blueprintId = existing.currentBlueprint._id; voidRevision = updated.revision; blueprintRecordRevision = configured.recordRevision
    } else if (persisted) {
      if (persisted.folderId !== folderId) throw new Error('Choose the folder already attached to this draft')
      const updated: any = await updateVoidDraft.mutate({ learningVoidId: persisted.id as never, title: draft.outcome, expectedRevision: persisted.voidRevision, idempotencyKey: key('resume-saved-draft-title') })
      const configured: any = await configureIntent.mutate({ blueprintRevisionId: persisted.blueprintId, expectedBlueprintRecordRevision: persisted.blueprintRecordRevision, ...intentArgs(draft), idempotencyKey: key('resume-saved-draft-intent') })
      id = String(updated._id); blueprintId = persisted.blueprintId; voidRevision = updated.revision; blueprintRecordRevision = configured.recordRevision
    } else {
      const created: any = await createVoid.mutate({ folderId: folderId as never, title: draft.outcome, idempotencyKey: key('create-void') })
      const blueprint: any = await createBlueprint.mutate({ learningVoidId: created._id, expectedVoidRevision: created.revision, idempotencyKey: key('create-blueprint') })
      const configured: any = await configureIntent.mutate({ blueprintRevisionId: blueprint._id, expectedBlueprintRecordRevision: blueprint.recordRevision, ...intentArgs(draft), idempotencyKey: key('configure-intent') })
      id = String(created._id); blueprintId = blueprint._id; voidRevision = created.revision + 1; blueprintRecordRevision = configured.recordRevision
    }
    const sourcing: any = await transitionVoid.mutate({ learningVoidId: id as never, status: 'sourcing', expectedRevision: voidRevision, idempotencyKey: key('start-sourcing') })
    const sourceReview: any = await transitionVoid.mutate({ learningVoidId: id as never, status: 'source_review', expectedRevision: sourcing.revision, idempotencyKey: key('open-source-review') })
    const sourceBlueprint: any = await transitionBlueprint.mutate({ blueprintRevisionId: blueprintId, status: 'source_review', expectedRecordRevision: blueprintRecordRevision, idempotencyKey: key('open-blueprint-source-review') })
    const configured: any = await configureIntent.mutate({ blueprintRevisionId: blueprintId, expectedBlueprintRecordRevision: sourceBlueprint.recordRevision, ...intentArgs(draft), idempotencyKey: key('configure-intent') })
    await freezeManifest.mutate({ learningVoidId: id as never, blueprintRevisionId: blueprintId, expectedVoidRevision: sourceReview.revision, expectedBlueprintRecordRevision: configured.recordRevision, folderIds: (draft.sourcePolicy === 'web_only' ? [] : [folderId]) as never, documentIds: [], idempotencyKey: key('freeze-folder-sources') })
    savedDraft.value = null
    return id
  }) }
  const generation = computed(() => mission.value?.generation ?? null)
  const generationIsActive = computed(() => ['queued', 'leased', 'running'].includes(generation.value?.status))
  async function startMapGeneration() { const row = mission.value; if (!row?.currentBlueprint) return; return await run(async () => {
    if (generationIsActive.value) throw new Error('Learning map generation is already in progress')
    if (!row.currentBlueprint.desiredOutcome || !row.currentBlueprint.mode || !row.currentBlueprint.desiredDepth || !row.currentBlueprint.sourcePolicy) throw new Error('Return to your outcome setup and save the learning intent before generating a map')
    return await startGeneration.mutate({ learningVoidId: row.learningVoid._id, blueprintRevisionId: row.currentBlueprint._id, expectedVoidRevision: row.learningVoid.revision, expectedBlueprintRecordRevision: row.currentBlueprint.recordRevision, idempotencyKey: key('generate-map') })
  }) }
  async function acceptSource(source: LearnSourceSnapshot) { return await run(async () => { const row = mission.value?.sources.items.find((item: any) => String(item._id) === source.id); if (!row) throw new Error('Source is no longer available'); if (source.lifecycle !== 'evaluated') throw new Error('Prepare and review this source before accepting it'); return await acceptSourceMutation.mutate({ sourceSnapshotId: row._id, expectedRevision: row.recordRevision ?? 1, idempotencyKey: key('accept-source') }) }) }
  async function prepareSource(source: LearnSourceSnapshot) { return await run(async () => {
    const row = mission.value?.sources.items.find((item: any) => String(item._id) === source.id)
    if (!row) throw new Error('Source is no longer available')
    const revision = row.recordRevision ?? 1
    if (source.lifecycle === 'fetched') return await prepareFetchedSource.mutate({ sourceSnapshotId: row._id, expectedRevision: revision, idempotencyKey: key('finish-source-review') })
    if (source.lifecycle !== 'candidate') throw new Error('Add a replacement for this unavailable source')
    if (source.origin === 'folder_document') return await prepareFolderSource.mutate({ sourceSnapshotId: row._id, expectedRevision: revision, idempotencyKey: key('retry-folder-source') })
    const result: any = await fetchAndPrepare.mutate({ sourceSnapshotId: row._id, expectedRevision: revision, idempotencyKey: key('retry-url-source') })
    if (result?.ok === false) throw new Error(retryableSourceMessage(result.reason))
    return result
  }) }
  async function rejectSource(source: LearnSourceSnapshot) { return await run(() => rejectSourceMutation.mutate({ sourceSnapshotId: source.id as never, expectedRevision: (mission.value?.sources.items.find((item: any) => String(item._id) === source.id)?.recordRevision ?? 1), idempotencyKey: key('reject-source') })) }
  async function addUrlSource(url: string, title?: string) { const row = mission.value; if (!row?.currentBlueprint || !url.trim()) return; return await run(async () => { const registered: any = await registerCandidate.mutate({ learningVoidId: row.learningVoid._id, blueprintRevisionId: row.currentBlueprint._id, url: url.trim(), title: title?.trim() || undefined, expectedVoidRevision: row.learningVoid.revision, expectedBlueprintRecordRevision: row.currentBlueprint.recordRevision, idempotencyKey: key('add-url-source') }); const result: any = await fetchAndPrepare.mutate({ sourceSnapshotId: registered.sourceSnapshotId, expectedRevision: registered.recordRevision, idempotencyKey: key('fetch-url-source') }); if (result?.ok === false) throw new Error(retryableSourceMessage(result.reason)); return result }) }
  async function researchPublicSources(query: string) { const row = mission.value; if (!row?.currentBlueprint || !query.trim()) return; if (!canResearch.value) throw new Error('Web research is disabled by this source policy'); researching.value = true; try { return await run(async () => { const result: any = await searchPublicWeb.mutate({ learningVoidId: row.learningVoid._id, blueprintRevisionId: row.currentBlueprint._id, expectedVoidRevision: row.learningVoid.revision, expectedBlueprintRecordRevision: row.currentBlueprint.recordRevision, query: query.trim(), idempotencyKey: key('research') }); researchResults.value = (result?.ok === true && Array.isArray(result.results) ? result.results : []).flatMap((item: any) => { try { const url = new URL(item?.url); if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return []; url.hash = ''; return [{ title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 280) : url.hostname, url: url.toString(), snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 600) : undefined }] } catch { return [] } }); return result }) } finally { researching.value = false } }
  async function acceptLearningMap() { const row = mission.value; if (!row?.currentBlueprint) return; return await run(() => acceptMap.mutate({ blueprintRevisionId: row.currentBlueprint._id, expectedRecordRevision: row.currentBlueprint.recordRevision, expectedVoidRevision: row.learningVoid.revision, idempotencyKey: key('accept-map') })) }
  async function submitCalibrationAttempt(objectiveId: string, response: string, confidence: number) { const row = mission.value; if (!row?.currentBlueprint) return; return await run(() => submitCalibration.mutate({ blueprintRevisionId: row.currentBlueprint._id, objectiveId: objectiveId as never, expectedBlueprintRecordRevision: row.currentBlueprint.recordRevision, expectedVoidRevision: row.learningVoid.revision, response, confidence, usedHint: false, usedReveal: false, idempotencyKey: key('calibration') })) }
  async function completeCalibration() { const row = mission.value; if (!row?.currentBlueprint) return; return await run(() => completeCalibrationMutation.mutate({ blueprintRevisionId: row.currentBlueprint._id, expectedBlueprintRecordRevision: row.currentBlueprint.recordRevision, expectedVoidRevision: row.learningVoid.revision, idempotencyKey: key('complete-calibration') })) }
  function defaultSchedule(): LearnScheduleInput { const now = new Date(); const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; return { version: 'learn-v2.schedule-input.v1', timezone, startLocalDate: now.toLocaleDateString('en-CA'), targetLocalDate: mission.value?.currentBlueprint?.targetLocalDate ?? null, sessionMinutes: mission.value?.currentBlueprint?.sessionMinutes ?? 25, availability: [{ weekday: 1, start: '18:00', end: '20:00' }, { weekday: 3, start: '18:00', end: '20:00' }, { weekday: 6, start: '10:00', end: '12:00' }], blackoutDates: [], reviewIntervalsDays: [1, 3], minRestMinutes: 720 } }
  function planInput(): LearnScheduleInput {
    const fallback = defaultSchedule()
    const raw = mission.value?.plan?.preview?.inputSnapshot
    if (!raw) return fallback
    try {
      const stored = JSON.parse(raw) as Partial<LearnScheduleInput>
      return {
        version: 'learn-v2.schedule-input.v1',
        timezone: stored.timezone ?? fallback.timezone,
        startLocalDate: stored.startLocalDate ?? fallback.startLocalDate,
        targetLocalDate: stored.targetLocalDate ?? null,
        sessionMinutes: stored.sessionMinutes ?? fallback.sessionMinutes,
        availability: Array.isArray(stored.availability) ? stored.availability.map(item => ({ weekday: item.weekday, start: item.start, end: item.end })) : fallback.availability,
        blackoutDates: Array.isArray(stored.blackoutDates) ? [...stored.blackoutDates] : [],
        reviewIntervalsDays: Array.isArray(stored.reviewIntervalsDays) ? [...stored.reviewIntervalsDays] : fallback.reviewIntervalsDays,
        minRestMinutes: stored.minRestMinutes ?? fallback.minRestMinutes,
      }
    } catch { return fallback }
  }
  async function createPlanPreview(schedulingInput: LearnScheduleInput) { const row = mission.value; if (!row?.currentBlueprint) return; return await run(() => createPreviewMutation.mutate({ learningVoidId: row.learningVoid._id, blueprintRevisionId: row.currentBlueprint._id, expectedVoidRevision: row.learningVoid.revision, expectedBlueprintRecordRevision: row.currentBlueprint.recordRevision, idempotencyKey: key('plan-preview'), schedulingInput })) }
  async function editPlanPreview(schedulingInput: LearnScheduleInput, changeReason: 'availability_changed' | 'deadline_changed' | 'session_length_changed') { const row = mission.value; const preview = row?.plan?.preview; if (!row?.currentBlueprint || !preview) return; return await run(() => editPreviewMutation.mutate({ studyPlanRevisionId: preview._id, expectedPlanRecordRevision: preview.recordRevision, expectedVoidRevision: row.learningVoid.revision, expectedBlueprintRecordRevision: row.currentBlueprint.recordRevision, changeReason, idempotencyKey: key('edit-plan-preview'), schedulingInput })) }
  async function editLearningMap(edit: LearnMapEdit) { const original = mission.value; if (!original?.currentBlueprint || !original.map) return; return await run(async () => {
    const fork: any = await forkBlueprint.mutate({ blueprintRevisionId: original.currentBlueprint._id, expectedRecordRevision: original.currentBlueprint.recordRevision, expectedVoidRevision: original.learningVoid.revision, idempotencyKey: key('fork-map') })
    // The fork copies sources and the authoritative map. Wait for the subscription so
    // candidate source IDs are scoped to that new revision rather than the source map.
    await new Promise<void>((resolve, reject) => {
      let settled = false; let stop = () => {}; const timer = setTimeout(() => { if (settled) return; settled = true; stop(); reject(new Error('The editable map revision did not become available. Refresh and try again.')) }, 5_000)
      const watcher = watch(mission, value => { if (!settled && String(value?.currentBlueprint?._id) === String(fork._id)) { settled = true; clearTimeout(timer); stop(); resolve() } }, { flush: 'sync', immediate: true })
      stop = watcher; if (settled) stop()
    })
    const row = mission.value
    if (!row?.map || !row.currentBlueprint || String(row.currentBlueprint._id) !== String(fork._id)) throw new Error('The editable map revision is unavailable')
    const milestoneKeys = new Map(row.map.milestones.map((item: any) => [String(item._id), item.stableKey ?? `milestone-${item.order + 1}`]))
    const objectiveKeys = new Map(row.map.objectives.map((item: any) => [String(item._id), item.stableKey ?? `objective-${item.order + 1}`]))
    const sourceIdByKey = Object.fromEntries((row.sources?.items ?? []).map((source: any) => [String(source.identity?._id ?? source.sourceIdentityId), String(source._id)]))
    const defaultDepth = ({ overview: 'foundational', working: 'working', deep: 'advanced' } as const)[row.currentBlueprint.desiredDepth as 'overview' | 'working' | 'deep'] ?? 'working'
    const candidate: LearnMapCandidate = { version: 'learn-v2.blueprint-candidate.v1', generatorVersion: 'learn-v2.learner-map-edit.v2', milestones: row.map.milestones.map((item: any) => ({ key: milestoneKeys.get(String(item._id))!, order: item.order, title: item.title, description: item.description })), objectives: row.map.objectives.map((item: any) => ({ key: objectiveKeys.get(String(item._id))!, milestoneKey: milestoneKeys.get(String(item.milestoneId))!, order: item.order, title: item.title, capability: item.capability, estimatedMinutes: item.estimatedMinutes, depth: item.depth ?? defaultDepth, coverage: item.storedCoverage ?? item.coverage, gapReason: item.gapReason, sourceSnapshotIds: item.sourceLinks.filter((link: any) => link.coverage !== 'gap').map((link: any) => String(link.sourceSnapshotId)), gapSourceSnapshotIds: item.sourceLinks.filter((link: any) => link.coverage === 'gap').map((link: any) => String(link.sourceSnapshotId)), prerequisiteObjectiveKeys: item.prerequisiteObjectiveIds.map((itemId: any) => objectiveKeys.get(String(itemId))).filter(Boolean), assessmentContract: item.assessmentContract })) }
    const edited = applyLearnMapEdit(candidate, edit, sourceIdByKey)
    return await replaceMap.mutate({ blueprintRevisionId: row.currentBlueprint._id, expectedRecordRevision: row.currentBlueprint.recordRevision, expectedVoidRevision: row.learningVoid.revision, idempotencyKey: key('replace-map'), candidate: edited as never })
  }) }
  async function acceptPlan() { const row = mission.value; const preview = row?.plan?.preview; if (!row || !preview) return; return await run(() => acceptPreviewMutation.mutate({ studyPlanRevisionId: preview._id, expectedVoidRevision: row.learningVoid.revision, expectedPlanRecordRevision: preview.recordRevision, idempotencyKey: key('accept-plan') })) }
  return { allowed, checkingAccess, hub, mission, snapshot, sources, objectives, readiness, plan, busy, error, generation, generationIsActive, canResearch, researching, researchResults, defaultSchedule, planInput, saveOutcomeDraft, createMission, startMapGeneration, editLearningMap, acceptSource, prepareSource, rejectSource, addUrlSource, researchPublicSources, acceptLearningMap, submitCalibrationAttempt, completeCalibration, createPlanPreview, editPlanPreview, acceptPlan }
}
