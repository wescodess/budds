import { z } from 'zod'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireOwnedResponseTarget } from './learnV2PublicAccess'
import { resolveAssessmentDisclosureContext, canReadSourceEvidence } from './learnV2AssessmentDisclosure'
import { relevantOpenLearnCheck } from './learnV2HelpAdmission'
import { normalizedInstructionalCaseFingerprints, resolveArtifactLineageForOwner } from './learnV2ArtifactLineage'
import { measurementItemAdapters } from './learnV2MeasurementItems'
import { learnCasePromptsOverlap } from '../../shared/learn-v2-case-prompt'
import { measurementReadContext } from './learnV2MeasurementReadContext'
import { privacyDigest, canonicalPrivacyJson, sourceBodyAvailable } from './learnV2ResponsePrivacy'
import { documentHasCurrentRevision } from './learnV2BackingSource'
import { postSealApplicationFields } from './learnV2PostSealStamp'
import { receiptFields, getLearnMeasurementScorer } from './learnV2MeasurementScoring'
import { LearnInputValidationError, LearnScoringInputError } from '../../shared/learn-v2-errors'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION, LEARN_V2_POST_SEAL_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import {
  LEARN_V2_POST_SEAL_TEACHING_VERSION, learnPostSealTeachingDenial, projectPostSealTeaching,
  projectPracticeAssistanceAuthorization, unavailableLearnPostSealTeaching, learnPracticeAssistanceContentSchema,
  type LearnPostSealTeachingContext, type LearnPostSealTeaching, type LearnPracticeAssistanceAuthorization,
  type learnAuthorizePracticeAssistanceSchema,
} from '../../shared/learn-v2-assessment-disclosure'
import { resolveLearnAssessmentCapabilities } from '../../shared/learn-v2-delayed-check'
import { isLearnScoringReceiptCommittable, LEARN_V2_SCORER_IDENTITY_POLICY_VERSION } from '../../shared/learn-v2-measurement'
import { learnArtifactSourceDependencySchema } from '../../shared/learn-v2-artifact-lineage'
import {
  fingerprintLearnPracticeHelpRequest, learnPostSealTeachingSourceStorageSchema, learnPostSealPracticeBindingStorageSchema,
  learnPostSealHelpReceiptStorageSchema, learnPostSealSourceLinkStorageSchema,
} from '../../shared/learn-v2-post-seal-storage'
import { learnPracticeSlotAssistanceStorageSchema, learnResponseDependencySchema, learnRevisionSchema, learnTextSchema, parseLearnContract } from '../../shared/learn-v2-responses'

type ReadCtx = QueryCtx | MutationCtx
type Dependency = z.infer<typeof learnArtifactSourceDependencySchema>
type Request = z.infer<typeof learnAuthorizePracticeAssistanceSchema>
type Reason = Parameters<typeof unavailableLearnPostSealTeaching>[0]
type SourceTarget = Doc<'learnPostSealSourceLinks'>['target']
const policy = 'learn-v2.post-seal-publication.v1'
const assistancePolicy = 'learn-v2.practice-assistance.v1'
const separationPolicy = 'learn-v2.post-seal-case-separation.v1'
export const POST_SEAL_HELP_HISTORY_LIMIT = 64
class PostSealUnavailable extends Error {
  constructor(readonly reason: Reason) { super(reason) }
}
function deny(reason: Reason = 'disclosure_unknown'): never { throw new PostSealUnavailable(reason) }
function validationReason(error: unknown): Reason {
  if (error instanceof PostSealUnavailable) return error.reason
  if (error instanceof z.ZodError || error instanceof LearnInputValidationError) return 'disclosure_unknown'
  throw error
}
const deniedHelp = (reasonCode: Reason): LearnPracticeAssistanceAuthorization => ({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'denied', reasonCode })
function base(userId: string, learningVoidId: Id<'learningVoids'>, createdAt = Date.now()) {
  return { userId, learningVoidId, createdAt, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, postSealStorageVersion: LEARN_V2_POST_SEAL_STORAGE_VERSION }
}
function normalizeDependencies(values: Dependency[]): Dependency[] {
  const unique = new Map(values.map(value => [canonicalPrivacyJson(value), value]))
  if (!unique.size || unique.size > 64) deny()
  return [...unique.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value)
}

async function liveDependency(ctx: ReadCtx, userId: string, dependency: Dependency) {
  if (dependency.kind === 'folder') return (await ctx.db.get(dependency.folderId))?.userId === userId
  if (dependency.kind === 'document') {
    const document = await ctx.db.get(dependency.documentId)
    return document?.userId === userId && document.status === 'success' && documentHasCurrentRevision(document)
      && document.sourceRevision === dependency.sourceRevision && (await ctx.db.get(document.folderId))?.userId === userId
  }
  const source = await ctx.db.get(dependency.sourceSnapshotId)
  if (!source || source.userId !== userId || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted'
    || source.rightsStatus !== 'permitted' || source.conflictStatus !== 'clear' || source.revision !== dependency.revision
    || source.recordRevision !== dependency.recordRevision || source.contentHash !== dependency.contentHash
    || !await canReadSourceEvidence(ctx, source) || !await sourceBodyAvailable(ctx, userId, source._id)) return false
  if (dependency.kind === 'snapshot') return true
  const excerpt = await ctx.db.get(dependency.sourceExcerptId)
  return excerpt?.userId === userId && excerpt.sourceSnapshotId === source._id && excerpt.rightsStatus === 'permitted'
    && excerpt.evidencePurgedAt === undefined && Boolean(excerpt.excerpt?.trim())
}

async function checkDependencies(ctx: ReadCtx, userId: string, submissionId: Id<'learnResponses'>) {
  const links = await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_submissionId', q =>
    q.eq('userId', userId).eq('submissionId', submissionId)).take(65)
  if (!links.length || links.length > 64) deny('evidence_unavailable')
  const dependencies: Dependency[] = []
  for (const link of links) {
    if (link.evidenceStatus !== 'available' || link.invalidatedAt !== undefined) deny('evidence_unavailable')
    const pin = link.dependency
    if (pin.kind === 'snapshot') {
      const source = await ctx.db.get(pin.sourceSnapshotId)
      if (!source || source.revision !== pin.sourceSnapshotRevision || source.recordRevision !== pin.sourceRecordRevision) deny('evidence_unavailable')
      dependencies.push({ kind: 'snapshot', sourceSnapshotId: source._id, revision: source.revision,
        recordRevision: source.recordRevision!, contentHash: source.contentHash! })
    } else if (pin.kind === 'document') dependencies.push({ kind: 'document', documentId: pin.documentId, sourceRevision: pin.sourceRevision })
    else dependencies.push({ kind: 'folder', folderId: pin.folderId })
  }
  for (const dependency of dependencies) if (!await liveDependency(ctx, userId, dependency)) deny('evidence_unavailable')
  return normalizeDependencies(dependencies)
}

async function validScore(ctx: ReadCtx, row: Doc<'learnAssessmentOpportunities'>, response: Doc<'learnResponses'> | null) {
  if (!response || !row.authoritativeAttemptId || !['scored_pass', 'scored_fail'].includes(row.phase)
    || response.currentEligibility !== 'eligible' || response.validitySnapshot.status !== 'valid') return false
  const attempt = await ctx.db.get(row.authoritativeAttemptId)
  const execution = attempt?.scoringExecutionId ? await ctx.db.get(attempt.scoringExecutionId) : null
  if (!attempt || !execution || attempt.userId !== row.userId || execution.userId !== row.userId
    || attempt.submissionId !== response._id || attempt.assessmentOpportunityId !== row._id
    || execution.submissionId !== response._id || execution.assessmentOpportunityId !== row._id
    || execution.authoritativeAttemptId !== attempt._id || execution.evidenceStatus !== 'available' || execution.invalidatedAt !== undefined
    || attempt.acceptedAt !== response.acceptedAt || execution.responseDigest !== response.payloadDigest
    || execution.jobId !== row.scoringJobId || canonicalPrivacyJson(attempt.validitySnapshot) !== canonicalPrivacyJson(response.validitySnapshot)
    || canonicalPrivacyJson(attempt.assistanceSnapshot) !== canonicalPrivacyJson(response.assistanceSnapshot)
    || execution.committedAt !== attempt.scoreCommittedAt || execution.committedAt === undefined
    || execution.committedAt < response.acceptedAt || execution.verdict?.scorePercent !== attempt.serverScorePercent
    || canonicalPrivacyJson(attempt.assessmentPins) !== canonicalPrivacyJson(row.assessmentPins)
    || canonicalPrivacyJson(execution.assessmentPins) !== canonicalPrivacyJson(row.assessmentPins)
    || canonicalPrivacyJson(attempt.scoringBinding) !== canonicalPrivacyJson(row.scoringBinding)
    || canonicalPrivacyJson(execution.scoringBinding) !== canonicalPrivacyJson(row.scoringBinding)
    || (attempt.serverScorePercent! >= 80) !== (row.phase === 'scored_pass')) return false
  try {
    const identityPolicy = row.scoringBinding.kind === 'model' ? (await getLearnMeasurementScorer(row.scoringBinding)).registry.identityPolicy
      : { version: LEARN_V2_SCORER_IDENTITY_POLICY_VERSION, verifiedModelAliases: [] }
    const { authoritativeAttemptId: _attempt, committedAt: _committed, ...verifiedReceipt } = receiptFields(execution)
    return isLearnScoringReceiptCommittable(verifiedReceipt, identityPolicy)
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof LearnInputValidationError || error instanceof LearnScoringInputError) return false
    throw error
  }
}

async function checkAuthority(ctx: ReadCtx, userId: string, id: Id<'learnAssessmentOpportunities'>) {
  const row = await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: id })
  if (!('assessmentPins' in row)) deny('unavailable')
  const disclosure = await resolveAssessmentDisclosureContext(ctx, id, true)
  if (!disclosure) deny()
  const response = row.submissionId ? await ctx.db.get(row.submissionId) : null
  const objective = await ctx.db.get(row.objectiveId)
  const learningVoid = await ctx.db.get(row.learningVoidId)
  const blueprint = await ctx.db.get(row.blueprintRevisionId)
  const promptDigest = row.assessmentPins.kind === 'measurement' ? row.assessmentPins.itemPins.promptDigest : row.assessmentPins.promptDigest
  disclosure.pinsMatch &&= Boolean(objective?.assessmentContract && typeof objective.assessmentContract === 'object'
    && await privacyDigest(objective.assessmentContract) === row.assessmentContractDigest
    && learningVoid?.activeBlueprintRevisionId === row.blueprintRevisionId && blueprint?.status === 'accepted'
    && (!disclosure.grant || disclosure.grant.projectionDigest === promptDigest)
    && (!response || response.scopeKind === 'v2' && 'assessmentOpportunityId' in response
      && response.learningVoidId === row.learningVoidId && response.blueprintRevisionId === row.blueprintRevisionId
      && response.objectiveId === row.objectiveId && response.assessmentContractDigest === row.assessmentContractDigest
      && response.blueprintRecordRevision === row.blueprintRecordRevision
      && canonicalPrivacyJson(response.assessmentPins) === canonicalPrivacyJson(row.assessmentPins)
      && canonicalPrivacyJson(response.scoringBinding) === canonicalPrivacyJson(row.scoringBinding)
      && response.acceptedAt <= Date.now() && disclosure.grant && response.acceptedAt >= disclosure.grant.grantedAt))
  disclosure.evidenceAvailable &&= !response || response.evidenceStatus === 'available' && response.invalidatedAt === undefined
  const scoreValid = await validScore(ctx, row, response)
  const context: LearnPostSealTeachingContext = { disclosure, validScore: scoreValid, publicationAllowed: true,
    relevantOpenCheck: await relevantOpenLearnCheck(ctx, userId, row), practiceBinding: null,
    capabilities: resolveLearnAssessmentCapabilities({ lifecycle: disclosure.lifecycle, enabled: true, authorized: true,
      evidenceAvailable: disclosure.evidenceAvailable, pinsMatch: disclosure.pinsMatch, validScore: scoreValid }) }
  const reason = learnPostSealTeachingDenial(context)
  if (reason) deny(reason)
  if (!response || response.userId !== userId || response.scopeKind !== 'v2' || !row.submissionId) deny('not_sealed')
  return { row, response, context, dependencies: await checkDependencies(ctx, userId, response._id) }
}
type Authority = Awaited<ReturnType<typeof checkAuthority>>

async function blockAuthority(ctx: ReadCtx, userId: string, authority: Authority, blockId: Id<'sessionContentBlocks'>, kind: string) {
  const block = await ctx.db.get(blockId)
  const content = block ? await ctx.db.get(block.sessionContentId) : null
  if (!block || block.userId !== userId || block.kind !== kind || !block.content || !content || content.userId !== userId
    || content.status !== 'published'
    || content.blueprintRevisionId !== authority.row.blueprintRevisionId || content.objectiveId !== authority.row.objectiveId
    || content.assessmentPurpose && content.assessmentPurpose !== 'independent_application') deny()
  parseLearnContract(learnTextSchema(), block.content)
  const lineages = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q =>
    q.eq('artifact.kind', 'session_block').eq('artifact.id', blockId).eq('nextId', undefined)).take(2)
  if (lineages.length !== 1) deny()
  const lineage = lineages[0]!
  const bound = await resolveArtifactLineageForOwner(ctx, userId, { reference: {
    artifact: { kind: 'session_block', id: blockId }, key: lineage.key, revision: lineage.revision, payloadDigest: lineage.payloadDigest } })
  if (bound.status !== 'bound' || bound.classification !== 'teaching' || !bound.instructionalRegistered
    || bound.cases.length !== 1 || bound.cases.some(value => value.usageClass !== 'instructional')) deny()
  const checkCaseId = authority.row.assessmentPins.kind === 'measurement' ? authority.row.assessmentPins.itemPins.caseId : authority.row.assessmentPins.caseId
  const checkCase = await ctx.db.get(checkCaseId)
  const candidate = bound.cases[0]!
  const checkValidation = checkCase?.identityValidationId ? await ctx.db.get(checkCase.identityValidationId) : null
  const preparation = bound.validation.preparation
  if (!checkCase || checkCase.userId !== userId || !checkValidation || checkValidation.userId !== userId
    || checkValidation.subject.kind !== 'case' || checkValidation.subject.caseId !== checkCaseId
    || checkValidation.check !== 'same_case_novelty' || checkValidation.decision !== 'pass'
    || checkValidation.evidenceStatus !== 'available' || checkValidation.invalidatedAt !== undefined
    || bound.validation.comparedCatalogRevision < checkValidation.comparedCatalogRevision
    || candidate.caseId === checkCaseId || candidate.identityPolicyVersion !== checkCase.identityPolicyVersion
    || [checkCase.scenarioFingerprint, checkCase.solutionFingerprint].some(value => value === candidate.scenarioFingerprint || value === candidate.solutionFingerprint)
    || !preparation || preparation.kind !== 'instructional_reservation' || preparation.deterministicDecision !== 'pass'
    || (checkCase.usageClass === 'measurement_reserved' || checkCase.reservedAt !== undefined)
      && (preparation.reservedCaseCount < 1 || preparation.semanticDecision !== 'pass')) deny()
  let storedClaimOrders: unknown
  try { storedClaimOrders = JSON.parse(block.claimOrdersJson ?? 'null') }
  catch (error) { if (error instanceof SyntaxError) deny(); throw error }
  const claimOrders = z.array(z.number().int().nonnegative()).min(1).max(32).parse(storedClaimOrders)
  const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q =>
    q.eq('userId', userId).eq('sessionContentId', content._id)).take(33)
  if (claims.length > 32 || new Set(claimOrders).size !== claimOrders.length) deny()
  for (const order of claimOrders) {
    const matching = claims.filter(claim => claim.order === order)
    if (matching.length !== 1) deny()
    const supports = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q =>
      q.eq('userId', userId).eq('sessionContentClaimId', matching[0]!._id)).take(9)
    if (!supports.length || supports.length > 8 || supports.some(support => support.entailment !== 'entailed'
      || support.conflictStatus !== 'clear' || support.evidenceStatus !== 'evidence_available' || !support.verifierVersion || (support.confidence ?? 0) < 0.8)) deny('evidence_unavailable')
  }
  const dependencies: Dependency[] = []
  for (const lineageId of [bound.lineageId, ...bound.originLineageIds]) {
    const links = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q =>
      q.eq('userId', userId).eq('lineageId', lineageId)).take(65)
    if (links.length > 64) deny()
    for (const link of links) dependencies.push(parseLearnContract(learnArtifactSourceDependencySchema, link.dependency))
  }
  const complete = normalizeDependencies([...authority.dependencies, ...dependencies])
  for (const dependency of complete) if (!await liveDependency(ctx, userId, dependency)) deny('evidence_unavailable')
  return { block, content, bound, checkCaseId, caseId: candidate.caseId, dependencies: complete,
    validationDigest: await privacyDigest({ policy, checkCaseId, validation: bound.validation, cases: bound.cases }) }
}
async function practiceCaseProof(ctx: ReadCtx, userId: string, authority: Authority, proof: Awaited<ReturnType<typeof blockAuthority>>, validate: boolean) {
  const pins = authority.row.assessmentPins
  let prompt: string
  let stimulus: string | null = null
  let artifact: { kind: 'measurement_item' | 'session_block', id: string }
  if (pins.kind === 'measurement') {
    const item = await ctx.db.get(pins.itemPins.itemId)
    if (!item || item.userId !== userId || !item.prompt || item.promptDigest !== pins.itemPins.promptDigest || item.caseId !== proof.checkCaseId) deny()
    prompt = item.prompt
    stimulus = item.declaredStimulus ?? null
    artifact = { kind: 'measurement_item', id: item._id }
  } else {
    if (pins.kind !== 'session_application' || authority.row.contextPins.kind !== 'session') deny()
    const contentId = authority.row.contextPins.sessionContentId
    const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q =>
      q.eq('userId', userId).eq('sessionContentId', contentId)).take(17)
    const matches = blocks.filter(block => block.kind === 'independent_application' || block.kind === 'transfer_challenge')
    if (blocks.length > 16 || matches.length !== 1 || !matches[0]!.content || await privacyDigest(matches[0]!.content) !== pins.promptDigest) deny()
    prompt = matches[0]!.content!
    artifact = { kind: 'session_block', id: matches[0]!._id }
  }
  parseLearnContract(learnTextSchema(), prompt)
  const practicePrompt = proof.block.content!
  if (learnCasePromptsOverlap(prompt, practicePrompt) || stimulus && learnCasePromptsOverlap(`${stimulus}\n${prompt}`, practicePrompt)) deny()
  const checkCase = await ctx.db.get(proof.checkCaseId)
  const checkIdentity = await normalizedInstructionalCaseFingerprints(prompt, prompt)
  const practiceIdentity = await normalizedInstructionalCaseFingerprints(practicePrompt, practicePrompt)
  if (!checkCase || checkCase.userId !== userId || checkCase.scenarioFingerprint !== checkIdentity.scenarioFingerprint
    || [checkCase.scenarioFingerprint, checkCase.solutionFingerprint].includes(practiceIdentity.scenarioFingerprint)) deny()
  const cases = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint', q =>
    q.eq('userId', userId).eq('scenarioFingerprint', practiceIdentity.scenarioFingerprint)).take(2)
  if (cases.length !== 1) deny()
  const candidate = cases[0]!
  const validation = candidate.identityValidationId ? await ctx.db.get(candidate.identityValidationId) : null
  if (candidate._id === checkCase._id || candidate.usageClass !== 'instructional' || candidate.reservedAt !== undefined
    || candidate.solutionFingerprint !== practiceIdentity.solutionFingerprint || candidate.identityPolicyVersion !== checkCase.identityPolicyVersion
    || !validation || validation.userId !== userId || validation.subject.kind !== 'case' || validation.subject.caseId !== candidate._id
    || validation.check !== 'same_case_novelty' || validation.decision !== 'pass' || validation.evidenceStatus !== 'available'
    || validation.invalidatedAt !== undefined || validation.comparedCatalogRevision > proof.bound.catalogRevision) deny()
  for (const id of proof.bound.originLineageIds) {
    const origin = await ctx.db.get(id)
    if (!origin || origin.userId !== userId || origin.artifact.kind === artifact.kind && origin.artifact.id === artifact.id) deny()
  }
  const comparison = { policy: separationPolicy, check: { caseId: checkCase._id, ...checkIdentity, prompt, stimulus, pins },
    practice: { caseId: candidate._id, ...practiceIdentity, prompt: practicePrompt, lineageId: proof.bound.lineageId },
    artifactValidationDigest: proof.validationDigest, promptValidation: validation, validatorVersion: measurementItemAdapters.version }
  const corpusDigest = await privacyDigest(comparison)
  if (validate) {
    const decision = await measurementItemAdapters.compare({ purpose: 'instructional', content: comparison, corpus: [checkCase], sources: [], corpusDigest })
    if (decision.decision !== 'pass' || decision.coverage !== 'complete') deny()
  }
  return { ...proof, caseId: candidate._id,
    validationDigest: await privacyDigest({ policy: separationPolicy, corpusDigest, decision: 'pass', coverage: 'complete' }) }
}
async function publication(payload: unknown, dependencies: Dependency[], validationDigest: string, publishedAt = Date.now()) {
  return { policyVersion: policy, payloadDigest: await privacyDigest(payload), sourceManifestDigest: await privacyDigest(dependencies), validationDigest, publishedAt }
}
async function sourceLinks(ctx: ReadCtx, userId: string, target: SourceTarget) {
  if ('teachingSourceId' in target) return await ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_teachingSourceId', q => q.eq('userId', userId).eq('target.teachingSourceId', target.teachingSourceId)).take(65)
  if ('practiceBindingId' in target) return await ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_practiceBindingId', q => q.eq('userId', userId).eq('target.practiceBindingId', target.practiceBindingId)).take(65)
  return await ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_helpReceiptId', q => q.eq('userId', userId).eq('target.helpReceiptId', target.helpReceiptId)).take(65)
}
async function verifyPublication(ctx: ReadCtx, userId: string, row: { learningVoidId: Id<'learningVoids'>, sourceDependencyCount: number,
  content: { status: 'available', payload: unknown, publication: Awaited<ReturnType<typeof publication>> } }, target: SourceTarget, dependencies: Dependency[], validationDigest: string) {
  const links = await sourceLinks(ctx, userId, target)
  if (links.length !== row.sourceDependencyCount || links.length !== dependencies.length) deny()
  const actual: Dependency[] = []
  for (const link of links) {
    const value = parseLearnContract(learnPostSealSourceLinkStorageSchema, postSealApplicationFields(link))
    if (value.learningVoidId !== row.learningVoidId || value.evidenceStatus !== 'available' || !value.dependency) deny('evidence_unavailable')
    if (!await liveDependency(ctx, userId, value.dependency)) deny('evidence_unavailable')
    actual.push(value.dependency)
  }
  if (canonicalPrivacyJson(normalizeDependencies(actual)) !== canonicalPrivacyJson(dependencies)) deny()
  const expected = await publication(row.content.payload, dependencies, validationDigest, row.content.publication.publishedAt)
  if (canonicalPrivacyJson(expected) !== canonicalPrivacyJson(row.content.publication) || expected.publishedAt > Date.now()) deny()
}
async function writeLinks(ctx: MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>, target: SourceTarget, dependencies: Dependency[], now: number) {
  for (const dependency of dependencies) {
    const row = { ...base(userId, learningVoidId, now), evidenceStatus: 'available' as const, target, dependency }
    parseLearnContract(learnPostSealSourceLinkStorageSchema, row)
    await ctx.db.insert('learnPostSealSourceLinks', row)
  }
}

async function practiceAuthority(ctx: ReadCtx, userId: string, authority: Authority) {
  const bindings = await ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId_and_submissionId', q =>
    q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
  if (bindings.length !== 1) deny()
  const binding = bindings[0]!
  parseLearnContract(learnPostSealPracticeBindingStorageSchema, postSealApplicationFields(binding))
  const slot = await ctx.db.get(binding.responseSlotId)
  if (binding.evidenceStatus !== 'available' || binding.content.status !== 'available') deny('evidence_unavailable')
  if (binding.assessmentOpportunityId !== authority.row._id || binding.learningVoidId !== authority.row.learningVoidId
    || !slot || slot.userId !== userId || slot.scopeKind !== 'v2' || slot.stage !== 'practice'
    || slot.learningVoidId !== binding.learningVoidId || slot.blueprintRevisionId !== authority.row.blueprintRevisionId
    || slot.objectiveId !== authority.row.objectiveId || slot.blueprintRecordRevision !== authority.row.blueprintRecordRevision
    || slot.assessmentContractDigest !== authority.row.assessmentContractDigest || slot.assessmentContractVersion !== authority.row.assessmentContractVersion
    || slot.depth !== authority.row.depth || canonicalPrivacyJson(slot.contextPins) !== canonicalPrivacyJson(authority.response.contextPins)
      && canonicalPrivacyJson(slot.contextPins) !== canonicalPrivacyJson(authority.row.contextPins)
    || slot.evidenceStatus !== 'available' || slot.invalidatedAt !== undefined) deny()
  parseLearnContract(learnRevisionSchema, slot.revision)
  const blockId = ctx.db.normalizeId('sessionContentBlocks', slot.blockId)
  if (!blockId) deny()
  const proof = await practiceCaseProof(ctx, userId, authority, await blockAuthority(ctx, userId, authority, blockId, 'faded_example'), false)
  if (binding.practiceCaseId !== proof.caseId || binding.checkCaseId !== proof.checkCaseId
    || binding.identityPolicyVersion !== proof.bound.cases[0]!.identityPolicyVersion || binding.caseValidationDigest !== proof.validationDigest
    || binding.catalogRevision > proof.bound.catalogRevision || binding.content.payload.tier !== 'T0'
    || binding.content.payload.prompt !== proof.block.content || slot.promptRevision !== proof.content.revision
    || slot.promptDigest !== await privacyDigest(binding.content.payload.prompt) || slot.slotKey !== `post-seal:${authority.response._id}`) deny()
  const siblings = await ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId_and_responseSlotId', q =>
    q.eq('userId', userId).eq('responseSlotId', slot._id)).take(2)
  const delivery = await ctx.db.get(slot.deliveryExposureId)
  if (siblings.length !== 1 || siblings[0]!._id !== binding._id || !delivery || delivery.userId !== userId
    || delivery.assessmentOpportunityId !== undefined || delivery.practiceHelp !== undefined || delivery.purpose !== 'practice'
    || !['granted', 'acknowledged'].includes(delivery.status) || delivery.caseId !== binding.practiceCaseId
    || delivery.learningVoidId !== slot.learningVoidId || delivery.blueprintRevisionId !== slot.blueprintRevisionId
    || delivery.objectiveId !== slot.objectiveId || delivery.projectionDigest !== slot.promptDigest
    || delivery.serverTime < authority.response.acceptedAt || delivery.serverTime > Date.now()) deny()
  await verifyPublication(ctx, userId, { ...binding, content: binding.content }, { practiceBindingId: binding._id }, proof.dependencies, proof.validationDigest)
  authority.context.practiceBinding = { assessmentOpportunityId: authority.row._id, submissionId: authority.response._id,
    target: { responseSlotId: slot._id }, revision: slot.revision, stage: 'practice', owned: true, evidenceAvailable: true,
    caseRelation: 'separate_case', reservedCase: 'no' }
  return { binding, slot, proof }
}
type PracticeAuthority = Awaited<ReturnType<typeof practiceAuthority>>

async function relatedBlock(ctx: ReadCtx, userId: string, authority: Authority, practice: PracticeAuthority, kind: 'explanation' | 'worked_example') {
  return await instructionalBlock(ctx, userId, authority, practice.proof.content._id, kind)
}

async function instructionalContent(ctx: ReadCtx, userId: string, authority: Authority) {
  const row = authority.row
  const content = row.contextPins.kind === 'session' ? await ctx.db.get(row.contextPins.sessionContentId) : null
  if (content && (!content.assessmentPurpose || content.assessmentPurpose === 'independent_application')) return content._id
  if (row.assessmentPins.kind !== 'measurement') deny()
  const item = await ctx.db.get(row.assessmentPins.itemPins.itemId)
  const job = item ? await ctx.db.get(item.generationJobId) : null
  if (!job || job.userId !== userId || job.type !== 'measurement_family_generation' || job.status !== 'succeeded'
    || job.learningVoidId !== row.learningVoidId || job.blueprintRevisionId !== row.blueprintRevisionId || !job.studySessionId) deny()
  const publications = await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q =>
    q.eq('userId', userId).eq('studySessionId', job.studySessionId!)).take(2)
  if (publications.length !== 1) deny()
  return publications[0]!._id
}

async function instructionalBlock(ctx: ReadCtx, userId: string, authority: Authority, contentId: Id<'sessionContent'>, kind: 'explanation' | 'worked_example' | 'faded_example') {
  const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q =>
    q.eq('userId', userId).eq('sessionContentId', contentId)).take(17)
  const matches = blocks.filter(block => block.kind === kind)
  if (blocks.length > 16 || matches.length !== 1) deny()
  return await blockAuthority(ctx, userId, authority, matches[0]!._id, kind)
}
async function teachingPayload(ctx: ReadCtx, userId: string, authority: Authority) {
  const attempt = authority.row.authoritativeAttemptId ? await ctx.db.get(authority.row.authoritativeAttemptId) : null
  if (!attempt || attempt.userId !== userId || attempt.submissionId !== authority.response._id
    || attempt.assessmentOpportunityId !== authority.row._id || attempt.serverScorePercent === undefined
    || !Number.isFinite(attempt.serverScorePercent) || attempt.serverScorePercent < 0 || attempt.serverScorePercent > 100) deny()
  const passed = attempt.serverScorePercent >= 80
  const explanation = await instructionalBlock(ctx, userId, authority, await instructionalContent(ctx, userId, authority), 'explanation')
  const dependencies = explanation.dependencies
  const citations = []
  const sources = [...new Set(explanation.dependencies.flatMap(dependency => dependency.kind === 'snapshot' || dependency.kind === 'excerpt' ? [dependency.sourceSnapshotId] : []))]
  if (!sources.length || sources.length > 16) deny()
  for (const [index, id] of sources.entries()) citations.push({ sourceRef: `source_${(await privacyDigest([policy, id])).slice(7)}`, label: `Accepted source ${index + 1}` })
  const payload = { feedback: { tier: 'T0' as const, text: passed
    ? 'Your response met the check requirements. Use the cited explanation to connect the idea to a separate practice case.'
    : 'Your response needs more practice. Review the cited explanation before trying the separate practice case.', citations },
  lesson: !passed ? { tier: 'T0' as const, paragraphs: [explanation.block.content!], citations } : null }
  return { payload, dependencies, validationDigest: await privacyDigest([policy, authority.row.authoritativeAttemptId, explanation.validationDigest]) }
}

export async function preparePostSealPracticeForOwner(ctx: MutationCtx, userId: string, id: Id<'learnAssessmentOpportunities'>) {
  ctx = measurementReadContext(ctx, userId)
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return unavailableLearnPostSealTeaching('disabled')
  let writing = false
  try {
    const authority = await checkAuthority(ctx, userId, id)
    const previous = await ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
    if (previous.length) {
      const existing = await practiceAuthority(ctx, userId, authority)
      return { status: 'prepared' as const, responseSlotId: existing.slot._id }
    }
    if (!authority.context.capabilities.canTeachSeparateCase) deny('unavailable')
    const proof = await practiceCaseProof(ctx, userId, authority,
      await instructionalBlock(ctx, userId, authority, await instructionalContent(ctx, userId, authority), 'faded_example'), true)
    const blockId = proof.block._id
    const now = Date.now()
    const payload = { tier: 'T0' as const, prompt: proof.block.content! }
    const promptDigest = await privacyDigest(payload.prompt)
    const publicationPins = await publication(payload, proof.dependencies, proof.validationDigest, now)
    const sources = await ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
    if (sources.length > 1) deny()
    if (sources[0]) {
      parseLearnContract(learnPostSealTeachingSourceStorageSchema, postSealApplicationFields(sources[0]))
      if (sources[0].assessmentOpportunityId !== id || sources[0].learningVoidId !== authority.row.learningVoidId
        || sources[0].attemptId !== (authority.row.authoritativeAttemptId ?? null)) deny()
    }
    const row = authority.row
    writing = true
    const exposureId = await ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
      createdAt: now, serverTime: now, learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId,
      caseId: proof.caseId, purpose: 'practice', status: 'granted', projectionDigest: promptDigest,
      deliveryReceiptHash: await privacyDigest([policy, authority.response._id, 'prompt']), policyVersion: policy, provenanceVersion: policy })
    const responseSlotId = await ctx.db.insert('learnResponseSlots', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now,
      scopeKind: 'v2', learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId,
      blueprintRecordRevision: row.blueprintRecordRevision, assessmentContractVersion: row.assessmentContractVersion, assessmentContractDigest: row.assessmentContractDigest,
      depth: row.depth, contextPins: authority.response.contextPins, stage: 'practice', slotKey: `post-seal:${authority.response._id}`, blockId,
      promptDigest, promptRevision: proof.content.revision, responseFormatVersion: 'learn-v2.text-response.v1', confidenceRequested: false,
      deliveryExposureId: exposureId, revision: 1, status: 'open', evidenceStatus: 'available' })
    const fields = { ...base(userId, row.learningVoidId, now), assessmentOpportunityId: id, submissionId: authority.response._id, responseSlotId,
      checkCaseId: proof.checkCaseId, practiceCaseId: proof.caseId, caseRelation: 'separate_case' as const, reservedCase: 'no' as const,
      identityPolicyVersion: proof.bound.cases[0]!.identityPolicyVersion, caseValidationDigest: proof.validationDigest, catalogRevision: proof.bound.catalogRevision,
      sourceDependencyCount: proof.dependencies.length, evidenceStatus: 'available' as const,
      content: { status: 'available' as const, payload, publication: publicationPins } }
    parseLearnContract(learnPostSealPracticeBindingStorageSchema, fields)
    const practiceBindingId = await ctx.db.insert('learnPostSealPracticeBindings', fields)
    await writeLinks(ctx, userId, row.learningVoidId, { practiceBindingId }, proof.dependencies, now)
    if (!sources.length) {
      const pending = { ...base(userId, row.learningVoidId, now), assessmentOpportunityId: id, submissionId: authority.response._id,
        attemptId: row.authoritativeAttemptId ?? null, sourceDependencyCount: 0 as const, evidenceStatus: 'available' as const, content: { status: 'pending' as const } }
      parseLearnContract(learnPostSealTeachingSourceStorageSchema, pending)
      await ctx.db.insert('learnPostSealTeachingSources', pending)
    }
    return { status: 'prepared' as const, responseSlotId }
  } catch (error) {
    if (writing) throw error
    return unavailableLearnPostSealTeaching(validationReason(error))
  }
}

export async function publishPostSealTeachingForOwner(ctx: MutationCtx, userId: string, id: Id<'learnAssessmentOpportunities'>) {
  ctx = measurementReadContext(ctx, userId)
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return unavailableLearnPostSealTeaching('disabled')
  let writing = false
  try {
    const authority = await checkAuthority(ctx, userId, id)
    if (!authority.context.validScore || !authority.context.capabilities.canReadFeedback) deny('unavailable')
    const teaching = await teachingPayload(ctx, userId, authority)
    const rows = await ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
    if (rows.length !== 1) deny()
    const source = rows[0]!
    parseLearnContract(learnPostSealTeachingSourceStorageSchema, postSealApplicationFields(source))
    if (source.assessmentOpportunityId !== id || source.learningVoidId !== authority.row.learningVoidId
      || source.attemptId !== authority.row.authoritativeAttemptId) deny()
    if (source.content.status === 'purged') deny('evidence_unavailable')
    if (source.content.status === 'available') {
      if (canonicalPrivacyJson(source.content.payload) !== canonicalPrivacyJson(teaching.payload)) deny()
      await verifyPublication(ctx, userId, { ...source, content: source.content }, { teachingSourceId: source._id }, teaching.dependencies, teaching.validationDigest)
      return { status: 'published' as const }
    }
    if ((await sourceLinks(ctx, userId, { teachingSourceId: source._id })).length) deny()
    const now = Date.now()
    const content = { status: 'available' as const, payload: teaching.payload,
      publication: await publication(teaching.payload, teaching.dependencies, teaching.validationDigest, now) }
    parseLearnContract(learnPostSealTeachingSourceStorageSchema, { ...postSealApplicationFields(source), sourceDependencyCount: teaching.dependencies.length, content })
    writing = true
    await writeLinks(ctx, userId, source.learningVoidId, { teachingSourceId: source._id }, teaching.dependencies, now)
    await ctx.db.patch(source._id, { sourceDependencyCount: teaching.dependencies.length, content })
    return { status: 'published' as const }
  } catch (error) {
    if (writing) throw error
    return unavailableLearnPostSealTeaching(validationReason(error))
  }
}

export async function readPostSealTeachingForOwner(ctx: ReadCtx, userId: string, id: Id<'learnAssessmentOpportunities'>): Promise<LearnPostSealTeaching> {
  ctx = measurementReadContext(ctx, userId)
  await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: id })
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return unavailableLearnPostSealTeaching('disabled')
  try {
    const authority = await checkAuthority(ctx, userId, id)
    const rows = await ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
    if (rows.length !== 1) deny()
    const source = rows[0]!
    parseLearnContract(learnPostSealTeachingSourceStorageSchema, postSealApplicationFields(source))
    if (source.content.status === 'purged') deny('evidence_unavailable')
    if (source.learningVoidId !== authority.row.learningVoidId || source.assessmentOpportunityId !== id
      || source.attemptId !== (authority.row.authoritativeAttemptId ?? null)) deny()
    const bindings = await ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
    const practice = bindings.length ? await practiceAuthority(ctx, userId, authority) : null
    if (source.content.status === 'pending') {
      if ((await sourceLinks(ctx, userId, { teachingSourceId: source._id })).length) deny()
    } else {
      const teaching = await teachingPayload(ctx, userId, authority)
      if (canonicalPrivacyJson(source.content.payload) !== canonicalPrivacyJson(teaching.payload)) deny()
      await verifyPublication(ctx, userId, { ...source, content: source.content }, { teachingSourceId: source._id }, teaching.dependencies, teaching.validationDigest)
    }
    return projectPostSealTeaching({ assessmentOpportunityId: id, submissionId: source.submissionId, attemptId: source.attemptId,
      feedback: source.content.status === 'available' ? source.content.payload.feedback : null,
      lesson: source.content.status === 'available' ? source.content.payload.lesson : null,
      practice: practice ? { responseSlotId: practice.slot._id, revision: practice.slot.revision, tier: 'T0', prompt: practice.proof.block.content } : null }, authority.context)
  } catch (error) { return unavailableLearnPostSealTeaching(validationReason(error)) }
}

export async function postSealPracticeAcceptanceAuthority(ctx: ReadCtx, userId: string, slot: Doc<'learnResponseSlots'>): Promise<boolean> {
  if (slot.scopeKind !== 'v2' || slot.stage !== 'practice' || !slot.slotKey.startsWith('post-seal:')) return false
  try {
    const rows = await ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId_and_responseSlotId', q =>
    q.eq('userId', userId).eq('responseSlotId', slot._id)).take(2)
  if (rows.length !== 1) deny()
  const authority = await checkAuthority(ctx, userId, rows[0]!.assessmentOpportunityId)
  const practice = await practiceAuthority(ctx, userId, authority)
    return practice.slot._id === slot._id
  } catch (error) { validationReason(error); return false }
}

export async function postSealPracticeResponseDependencies(ctx: ReadCtx, userId: string, slot: Doc<'learnResponseSlots'>): Promise<z.infer<typeof learnResponseDependencySchema>[]> {
  const rows = await ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId_and_responseSlotId', q =>
    q.eq('userId', userId).eq('responseSlotId', slot._id)).take(2)
  if (rows.length !== 1) deny()
  const authority = await checkAuthority(ctx, userId, rows[0]!.assessmentOpportunityId)
  const practice = await practiceAuthority(ctx, userId, authority)
  const latest = await ctx.db.query('learnPostSealHelpReceipts').withIndex('by_userId_and_responseSlotId_and_assistanceSequence', q =>
    q.eq('userId', userId).eq('responseSlotId', slot._id)).order('desc').take(2)
  const assistance = slot.stage === 'practice' ? slot.practiceAssistance : undefined
  if (assistance) parseLearnContract(learnPracticeSlotAssistanceStorageSchema, assistance)
  if (assistance ? latest[0]?.assistanceSequence !== assistance.deliveryCount || latest[0].authorizationId !== assistance.lastAuthorizationId
    || latest.length > 1 && latest[0].assistanceSequence === latest[1]!.assistanceSequence : latest.length > 0) deny()
  const dependencies = [...practice.proof.dependencies]
  if (assistance?.hintCount) dependencies.push(...(await relatedBlock(ctx, userId, authority, practice, 'explanation')).dependencies)
  if (assistance?.workedExampleCount) dependencies.push(...(await relatedBlock(ctx, userId, authority, practice, 'worked_example')).dependencies)
  const result = normalizeDependencies(dependencies).map(dependency => dependency.kind === 'snapshot' || dependency.kind === 'excerpt'
    ? { kind: 'snapshot' as const, sourceSnapshotId: dependency.sourceSnapshotId, sourceSnapshotRevision: dependency.revision,
        sourceRecordRevision: dependency.recordRevision, supportManifestDigest: practice.binding.content.status === 'available' ? practice.binding.content.publication.sourceManifestDigest : '' }
    : dependency.kind === 'document' ? { kind: 'document' as const, documentId: dependency.documentId, sourceRevision: dependency.sourceRevision }
      : { kind: 'folder' as const, folderId: dependency.folderId, scopeRevision: policy })
  return [...new Map(result.map(value => [canonicalPrivacyJson(value), parseLearnContract(learnResponseDependencySchema, value)])).values()]
}

export async function authorizePostSealPracticeForOwner(ctx: MutationCtx, userId: string, request: Request): Promise<LearnPracticeAssistanceAuthorization> {
  ctx = measurementReadContext(ctx, userId)
  await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId })
  await requireOwnedResponseTarget(ctx, userId, request.target)
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return deniedHelp('disabled')
  let writing = false
  try {
    const authority = await checkAuthority(ctx, userId, request.assessmentOpportunityId)
    const practice = await practiceAuthority(ctx, userId, authority)
    const { binding, slot } = practice
    if (!authority.context.capabilities.canTeachSeparateCase || slot._id !== request.target.responseSlotId
      || slot.revision !== request.expectedRevision || slot.status !== 'open' || slot.submissionId !== undefined) deny()
    const fingerprint = await fingerprintLearnPracticeHelpRequest(request)
    const existing = await ctx.db.query('learnPostSealHelpReceipts').withIndex('by_userId_and_idempotencyKeyHash', q =>
      q.eq('userId', userId).eq('idempotencyKeyHash', fingerprint.idempotencyKeyHash)).take(2)
    if (existing.length > 1) deny()
    const last = await ctx.db.query('learnPostSealHelpReceipts').withIndex('by_userId_and_responseSlotId_and_assistanceSequence', q =>
      q.eq('userId', userId).eq('responseSlotId', slot._id)).order('desc').take(2)
    const previous = slot.practiceAssistance
    if (previous) parseLearnContract(learnPracticeSlotAssistanceStorageSchema, previous)
    if (previous ? last[0]?.assistanceSequence !== previous.deliveryCount || last[0].authorizationId !== previous.lastAuthorizationId
      || last[0].deliveredAt !== previous.lastDeliveredAt || last.length > 1 && last[0].assistanceSequence === last[1]!.assistanceSequence : last.length > 0) deny()
    const help = await relatedBlock(ctx, userId, authority, practice, request.kind === 'hint' ? 'explanation' : 'worked_example')
    const payload = parseLearnContract(learnPracticeAssistanceContentSchema, { kind: request.kind, tier: 'T0', text: help.block.content })
    const dependencies = normalizeDependencies([...practice.proof.dependencies, ...help.dependencies])
    const validationDigest = await privacyDigest([policy, binding._id, practice.proof.validationDigest, help.validationDigest, request.kind])
    const prior = existing[0]
    if (prior) {
      parseLearnContract(learnPostSealHelpReceiptStorageSchema, postSealApplicationFields(prior))
      if (prior.content.status !== 'available' || prior.evidenceStatus !== 'available') deny('evidence_unavailable')
      if (prior.learningVoidId !== authority.row.learningVoidId || prior.assessmentOpportunityId !== authority.row._id
        || prior.submissionId !== authority.response._id || prior.practiceBindingId !== binding._id || prior.responseSlotId !== slot._id
        || prior.expectedRevision !== request.expectedRevision || prior.kind !== request.kind || prior.commandVersion !== request.version
        || !previous || prior.assistanceSequence > previous.deliveryCount
        || prior.fingerprintVersion !== fingerprint.fingerprintVersion || prior.requestDigest !== fingerprint.requestDigest
        || prior.deliveredAt < authority.response.acceptedAt || canonicalPrivacyJson(prior.content.payload) !== canonicalPrivacyJson(payload)) deny()
      const exposure = await ctx.db.get(prior.authorizationId)
      if (!exposure || exposure.userId !== userId || exposure.assessmentOpportunityId !== undefined || exposure.purpose !== 'practice'
        || exposure.learningVoidId !== authority.row.learningVoidId || exposure.blueprintRevisionId !== authority.row.blueprintRevisionId
        || exposure.objectiveId !== authority.row.objectiveId || exposure.policyVersion !== assistancePolicy || exposure.provenanceVersion !== policy
        || exposure.deliveryReceiptHash !== fingerprint.requestDigest
        || exposure.status !== 'granted' || exposure.caseId !== binding.practiceCaseId || exposure.serverTime !== prior.deliveredAt
        || exposure.projectionDigest !== await privacyDigest(payload) || exposure.practiceHelp?.responseSlotId !== slot._id
        || exposure.practiceHelp.practiceBindingId !== binding._id || exposure.practiceHelp.kind !== request.kind
        || exposure.practiceHelp.assistanceSequence !== prior.assistanceSequence) deny()
      const authorizations = await ctx.db.query('learnPostSealHelpReceipts').withIndex('by_userId_and_authorizationId', q =>
        q.eq('userId', userId).eq('authorizationId', prior.authorizationId)).take(2)
      if (authorizations.length !== 1 || authorizations[0]!._id !== prior._id) deny()
      await verifyPublication(ctx, userId, { ...prior, content: prior.content }, { helpReceiptId: prior._id }, dependencies, validationDigest)
      return projectPracticeAssistanceAuthorization({ request, result: { version: request.version, status: 'authorized',
        assessmentOpportunityId: authority.row._id, target: request.target, revision: prior.expectedRevision,
        authorizationId: prior.authorizationId, deliveredAt: prior.deliveredAt, content: prior.content.payload } }, request, authority.context)
    }
    const reason = learnPostSealTeachingDenial(authority.context)
    if (reason) deny(reason)
    const sequence = (previous?.deliveryCount ?? 0) + 1
    if (sequence > POST_SEAL_HELP_HISTORY_LIMIT) deny('unavailable')
    parseLearnContract(learnRevisionSchema, sequence)
    const now = Date.now()
    const publicationPins = await publication(payload, dependencies, validationDigest, now)
    writing = true
    const authorizationId = await ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
      createdAt: now, serverTime: now, learningVoidId: authority.row.learningVoidId, blueprintRevisionId: authority.row.blueprintRevisionId,
      objectiveId: authority.row.objectiveId, caseId: binding.practiceCaseId, purpose: 'practice', status: 'granted',
      projectionDigest: await privacyDigest(payload), deliveryReceiptHash: fingerprint.requestDigest, policyVersion: assistancePolicy, provenanceVersion: policy,
      practiceHelp: { responseSlotId: slot._id, practiceBindingId: binding._id, kind: request.kind, assistanceSequence: sequence } })
    const fields = { ...base(userId, authority.row.learningVoidId, now), assessmentOpportunityId: authority.row._id, submissionId: authority.response._id,
      practiceBindingId: binding._id, responseSlotId: slot._id, expectedRevision: request.expectedRevision, kind: request.kind,
      commandVersion: request.version, ...fingerprint, authorizationId, deliveredAt: now, assistanceSequence: sequence,
      sourceDependencyCount: dependencies.length, evidenceStatus: 'available' as const,
      content: { status: 'available' as const, payload, publication: publicationPins } }
    parseLearnContract(learnPostSealHelpReceiptStorageSchema, fields)
    const helpReceiptId = await ctx.db.insert('learnPostSealHelpReceipts', fields)
    await writeLinks(ctx, userId, authority.row.learningVoidId, { helpReceiptId }, dependencies, now)
    const assistance = { policyVersion: assistancePolicy, revision: sequence, deliveryCount: sequence,
      hintCount: (previous?.hintCount ?? 0) + Number(request.kind === 'hint'), workedExampleCount: (previous?.workedExampleCount ?? 0) + Number(request.kind === 'worked_example'),
      lastDeliveredAt: now, lastAuthorizationId: authorizationId }
    parseLearnContract(learnPracticeSlotAssistanceStorageSchema, assistance)
    const result = projectPracticeAssistanceAuthorization({ request, result: { version: request.version, status: 'authorized', assessmentOpportunityId: authority.row._id,
      target: request.target, revision: slot.revision, authorizationId, deliveredAt: now, content: payload } }, request, authority.context)
    if (result.status !== 'authorized') throw new Error('Practice authorization changed during delivery')
    await ctx.db.patch(slot._id, { practiceAssistance: assistance })
    return result
  } catch (error) {
    if (writing) throw error
    return deniedHelp(validationReason(error))
  }
}
