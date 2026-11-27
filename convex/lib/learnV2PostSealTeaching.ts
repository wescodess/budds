import { z } from 'zod'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireOwnedResponseTarget } from './learnV2PublicAccess'
import { resolveAssessmentDisclosureContext, canReadSourceEvidence } from './learnV2AssessmentDisclosure'
import { relevantOpenLearnCheck } from './learnV2HelpAdmission'
import { learnCheckUsesCanvasSurface } from './learnV2DelayedDelivery'
import { normalizedInstructionalCaseFingerprints, resolveArtifactLineageForOwner } from './learnV2ArtifactLineage'
import { measurementItemAdapters } from './learnV2MeasurementItems'
import { learnCasePromptsMatch } from '../../shared/learn-v2-case-prompt'
import { measurementReadContext } from './learnV2MeasurementReadContext'
import { privacyDigest, canonicalPrivacyJson, sourceBodyAvailable } from './learnV2ResponsePrivacy'
import { sanitizePublicSourceLocator } from './learnV2SourceSanitization'
import { unavailablePostSealCitation, type PostSealCitationSource } from './learnV2PostSealCitationContract'
import { documentHasCurrentRevision } from './learnV2BackingSource'
import { postSealApplicationFields } from './learnV2PostSealStamp'
import { receiptFields, getLearnMeasurementScorer } from './learnV2MeasurementScoring'
import { LearnInputValidationError, LearnScoringInputError } from '../../shared/learn-v2-errors'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION, LEARN_V2_POST_SEAL_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import {
  LEARN_V2_POST_SEAL_TEACHING_VERSION, LEARN_V2_PRACTICE_HELP_LIMIT, learnPostSealTeachingDenial, projectPostSealTeaching,
  projectPracticeAssistanceAuthorization, unavailableLearnPostSealTeaching, learnPracticeAssistanceContentSchema,
  learnPostSealTeachingSchema,
  canReadPostSealLesson,
  type LearnPostSealTeachingContext, type LearnPostSealTeaching, type LearnPracticeAssistanceAuthorization,
  type learnAuthorizePracticeAssistanceSchema,
} from '../../shared/learn-v2-assessment-disclosure'
import { resolveLearnAssessmentCapabilities } from '../../shared/learn-v2-delayed-check'
import { isLearnScoringReceiptCommittable, LEARN_V2_SCORER_IDENTITY_POLICY_VERSION, learnAssessmentBoundSurface } from '../../shared/learn-v2-measurement'
import { learnArtifactSourceDependencySchema } from '../../shared/learn-v2-artifact-lineage'
import {
  fingerprintLearnPracticeHelpRequest, learnPostSealTeachingSourceStorageSchema, learnPostSealPracticeBindingStorageSchema,
  learnPostSealHelpReceiptStorageSchema, learnPostSealSourceLinkStorageSchema,
} from '../../shared/learn-v2-post-seal-storage'
import { learnSerializedBytes, LEARN_V2_RESPONSE_LIMITS, learnPracticeSlotAssistanceStorageSchema, learnResponseDependencySchema, learnRevisionSchema, learnTextSchema, parseLearnContract } from '../../shared/learn-v2-responses'

type ReadCtx = QueryCtx | MutationCtx
type Dependency = z.infer<typeof learnArtifactSourceDependencySchema>
type Request = z.infer<typeof learnAuthorizePracticeAssistanceSchema>
type Reason = Parameters<typeof unavailableLearnPostSealTeaching>[0]
type SourceTarget = Doc<'learnPostSealSourceLinks'>['target']
type HelpReason = Extract<LearnPracticeAssistanceAuthorization, { status: 'denied' }>['reasonCode']
type HelpAvailability = NonNullable<Extract<LearnPostSealTeaching, { status: 'available' }>['availability']['help']>
const policy = 'learn-v2.post-seal-publication.v1'
export const postSealFeedbackCopy = { version: 'learn-v2.post-seal-feedback-copy.v1', text: (claim: string) => claim,
  citationLabel: (index: number) => `Accepted source ${index + 1}` }
const assistancePolicy = 'learn-v2.practice-assistance.v1'
const separationPolicy = 'learn-v2.post-seal-case-separation.v2'
export const POST_SEAL_HELP_HISTORY_LIMIT = 64
export const POST_SEAL_HELP_DELIVERY_LIMIT = LEARN_V2_PRACTICE_HELP_LIMIT
export const postSealHelpPolicy = { distinctContentLimit: (): number => POST_SEAL_HELP_DELIVERY_LIMIT }
class PostSealUnavailable extends Error {
  constructor(readonly reason: Reason) { super(reason) }
}
function deny(reason: Reason = 'disclosure_unknown'): never { throw new PostSealUnavailable(reason) }
function validationReason(error: unknown): Reason {
  if (error instanceof PostSealUnavailable) return error.reason
  if (error instanceof z.ZodError || error instanceof LearnInputValidationError) return 'disclosure_unknown'
  throw error
}
const deniedHelp = (reasonCode: HelpReason): LearnPracticeAssistanceAuthorization => ({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'denied', reasonCode })
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
  if (row.assessmentPins.kind === 'measurement' && row.assignmentId) {
    const assignment = await ctx.db.get(row.assignmentId)
    if (!assignment || assignment.status !== 'admitted') deny()
    const canvasSurface = learnCheckUsesCanvasSurface(assignment)
    if (canvasSurface !== Boolean(row.contextPins.kind === 'session' && row.contextPins.canvas)
      || assignment.checkSurface && learnAssessmentBoundSurface(assignment, row.contextPins) !== (canvasSurface ? 'canvas' : 'today')) deny()
  }
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
    || authority.row.purpose.kind !== 'retained_transfer' && bound.validation.comparedCatalogRevision < checkValidation.comparedCatalogRevision
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
  return { block, content, bound, claims: claims.filter(claim => claimOrders.includes(claim.order)), checkCaseId, caseId: candidate.caseId, dependencies: complete, instructionalDependencies: dependencies.length ? normalizeDependencies(dependencies) : [],
    validationDigest: await privacyDigest({ policy, checkCaseId, validation: bound.validation, cases: bound.cases }) }
}
async function separateCaseProof(ctx: ReadCtx, userId: string, authority: Authority, proof: Awaited<ReturnType<typeof blockAuthority>>,
  validate: boolean, delivery: { kind: 'practice' | 'hint' | 'worked_example' | 'feedback' | 'lesson' | 'independent_application', content: unknown, texts: string[] }) {
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
  const candidatePrompt = proof.block.content!
  const texts = [...new Set([candidatePrompt, ...delivery.texts])]
  for (const text of texts) {
    parseLearnContract(learnTextSchema(12000), text)
    if (learnCasePromptsMatch(prompt, text) || stimulus && learnCasePromptsMatch(`${stimulus}\n${prompt}`, text)) deny()
  }
  const checkCase = await ctx.db.get(proof.checkCaseId)
  const checkIdentity = await normalizedInstructionalCaseFingerprints(prompt, prompt)
  const candidateIdentity = await normalizedInstructionalCaseFingerprints(candidatePrompt, candidatePrompt)
  const deliveredIdentities = await Promise.all(texts.map(text => normalizedInstructionalCaseFingerprints(text, text)))
  if (!checkCase || checkCase.userId !== userId || checkCase.scenarioFingerprint !== checkIdentity.scenarioFingerprint
    || deliveredIdentities.some(identity => [checkCase.scenarioFingerprint, checkCase.solutionFingerprint].includes(identity.scenarioFingerprint))) deny()
  const cases = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint', q =>
    q.eq('userId', userId).eq('scenarioFingerprint', candidateIdentity.scenarioFingerprint)).take(2)
  if (cases.length !== 1) deny()
  const candidate = cases[0]!
  const validation = candidate.identityValidationId ? await ctx.db.get(candidate.identityValidationId) : null
  if (candidate._id === checkCase._id || candidate.usageClass !== 'instructional' || candidate.reservedAt !== undefined
    || candidate.solutionFingerprint !== candidateIdentity.solutionFingerprint || candidate.identityPolicyVersion !== checkCase.identityPolicyVersion
    || !validation || validation.userId !== userId || validation.subject.kind !== 'case' || validation.subject.caseId !== candidate._id
    || validation.check !== 'same_case_novelty' || validation.decision !== 'pass' || validation.evidenceStatus !== 'available'
    || validation.invalidatedAt !== undefined || validation.comparedCatalogRevision > proof.bound.catalogRevision) deny()
  for (const id of proof.bound.originLineageIds) {
    const origin = await ctx.db.get(id)
    if (!origin || origin.userId !== userId || origin.artifact.kind === artifact.kind && origin.artifact.id === artifact.id) deny()
  }
  const comparison = { policy: separationPolicy, check: { caseId: checkCase._id, ...checkIdentity, prompt, stimulus, pins },
    candidate: { caseId: candidate._id, ...candidateIdentity, prompt: candidatePrompt, lineageId: proof.bound.lineageId },
    delivery: { ...delivery, identities: deliveredIdentities },
    artifactValidationDigest: proof.validationDigest, promptValidation: validation, validatorVersion: measurementItemAdapters.version }
  const corpusDigest = await privacyDigest(comparison)
  if (validate) {
    const decision = await measurementItemAdapters.compare({ purpose: 'instructional', content: comparison, corpus: [checkCase], sources: [], corpusDigest })
    if (decision.decision !== 'pass' || decision.coverage !== 'complete') deny()
  }
  return { ...proof, caseId: candidate._id,
    validationDigest: await privacyDigest({ policy: separationPolicy, corpusDigest, decision: 'pass', coverage: 'complete' }) }
}

export async function postSealApplicationAdmissionForOwner(ctx: ReadCtx, userId: string, id: Id<'learnAssessmentOpportunities'>,
  contentId: Id<'sessionContent'>): Promise<Reason | null> {
  ctx = measurementReadContext(ctx, userId)
  await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: id })
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return 'disabled'
  try {
    const authority = await checkAuthority(ctx, userId, id)
    const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q =>
      q.eq('userId', userId).eq('sessionContentId', contentId)).take(17)
    const applications = blocks.filter(block => block.kind === 'independent_application')
    if (blocks.length > 16 || applications.length !== 1) deny()
    const proof = await blockAuthority(ctx, userId, authority, applications[0]!._id, 'independent_application')
    await separateCaseProof(ctx, userId, authority, proof, true, { kind: 'independent_application', content: proof.block.content, texts: [proof.block.content!] })
    return null
  } catch (error) { return validationReason(error) }
}

async function publication(payload: unknown, dependencies: Dependency[], validationDigest: string, publishedAt = Date.now(), policyVersion = policy) {
  return { policyVersion, payloadDigest: await privacyDigest(payload), sourceManifestDigest: await privacyDigest(dependencies), validationDigest, publishedAt }
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
  const policyVersion = row.content.publication.policyVersion
  if (policyVersion !== policy && !('teachingSourceId' in target && policyVersion === 'learn-v2.post-seal-feedback-copy.v1')) deny()
  const expected = await publication(row.content.payload, dependencies, validationDigest, row.content.publication.publishedAt, policyVersion)
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
  const block = await blockAuthority(ctx, userId, authority, blockId, 'faded_example')
  const proof = await separateCaseProof(ctx, userId, authority, block, false,
    { kind: 'practice', content: binding.content.payload, texts: [binding.content.payload.prompt] })
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

async function helpLedger(ctx: ReadCtx, userId: string, slot: Doc<'learnResponseSlots'>) {
  const receipts = await ctx.db.query('learnPostSealHelpReceipts').withIndex('by_userId_and_responseSlotId_and_assistanceSequence', q =>
    q.eq('userId', userId).eq('responseSlotId', slot._id)).order('desc').take(POST_SEAL_HELP_DELIVERY_LIMIT + 1)
  const previous = slot.stage === 'practice' ? slot.practiceAssistance : undefined
  if (previous) parseLearnContract(learnPracticeSlotAssistanceStorageSchema, previous)
  if (receipts.length > POST_SEAL_HELP_DELIVERY_LIMIT || (previous ? receipts[0]?.assistanceSequence !== previous.deliveryCount
    || receipts[0].authorizationId !== previous.lastAuthorizationId || receipts[0].deliveredAt !== previous.lastDeliveredAt
    || receipts.length > 1 && receipts[0].assistanceSequence === receipts[1]!.assistanceSequence : receipts.length > 0)) deny()
  for (const receipt of receipts) parseLearnContract(learnPostSealHelpReceiptStorageSchema, postSealApplicationFields(receipt))
  const contents = new Set(receipts.map(receipt => receipt.content.status === 'available'
    ? canonicalPrivacyJson([receipt.kind, receipt.content.payload]) : receipt._id))
  return { receipts, previous, distinctContents: contents.size }
}

async function helpAvailability(ctx: ReadCtx, userId: string, authority: Authority, practice: PracticeAuthority): Promise<HelpAvailability> {
  const limit = postSealHelpPolicy.distinctContentLimit()
  const { slot } = practice
  try {
    const ledger = await helpLedger(ctx, userId, slot)
    const open = slot.status === 'open' && slot.submissionId === undefined && authority.context.capabilities.canTeachSeparateCase
    const state = (kind: 'hint' | 'worked_example'): HelpAvailability['hint'] => {
      if (!open || kind === 'hint' && !canReadPostSealLesson(authority.context)) return { status: 'unavailable', reasonCode: 'unavailable' }
      if (ledger.receipts.some(receipt => receipt.kind === kind && receipt.expectedRevision === slot.revision
        && receipt.content.status === 'available')) return { status: 'delivered' }
      return ledger.distinctContents >= limit ? { status: 'unavailable', reasonCode: 'help_limit_reached' } : { status: 'available' }
    }
    return { remaining: Math.max(0, limit - ledger.distinctContents), hint: state('hint'), worked_example: state('worked_example') }
  } catch (error) {
    const reasonCode = validationReason(error)
    return { remaining: 0, hint: { status: 'unavailable', reasonCode }, worked_example: { status: 'unavailable', reasonCode } }
  }
}

async function relatedBlock(ctx: ReadCtx, userId: string, authority: Authority, practice: PracticeAuthority, kind: 'explanation' | 'worked_example') {
  return await instructionalBlock(ctx, userId, authority, practice.proof.content._id, kind)
}

async function instructionalContent(ctx: ReadCtx, userId: string, authority: Authority) {
  const row = authority.row
  if (row.purpose.kind === 'retained_transfer') {
    const basis = await ctx.db.get(row.purpose.basisAttemptId)
    const opportunity = basis?.assessmentOpportunityId ? await ctx.db.get(basis.assessmentOpportunityId) : null
    if (!basis || basis.userId !== userId || basis.kind !== 'independent_application'
      || basis.blueprintRevisionId !== row.blueprintRevisionId || basis.objectiveId !== row.objectiveId
      || !opportunity || opportunity.userId !== userId || opportunity.authoritativeAttemptId !== basis._id
      || opportunity.submissionId !== basis.submissionId || opportunity.learningVoidId !== row.learningVoidId
      || opportunity.blueprintRevisionId !== row.blueprintRevisionId || opportunity.objectiveId !== row.objectiveId
      || opportunity.purpose.kind !== 'independent_application' || opportunity.contextPins.kind !== 'session') deny('unavailable')
    return opportunity.contextPins.sessionContentId
  }
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
type TeachingPayload = Extract<Doc<'learnPostSealTeachingSources'>['content'], { status: 'available' }>['payload']
async function instructionalSourceRefs(dependencies: Dependency[]) {
  const ids = [...new Set(dependencies.flatMap(dependency => dependency.kind === 'snapshot' || dependency.kind === 'excerpt' ? [dependency.sourceSnapshotId] : []))]
  if (ids.length > 16) deny()
  const refs: string[] = []
  for (const id of ids) refs.push(`source_${(await privacyDigest([policy, id])).slice(7)}`)
  return refs
}
async function instructionalTeaching(payload: TeachingPayload, dependencies: Dependency[]): Promise<TeachingPayload> {
  const refs = new Set(await instructionalSourceRefs(dependencies))
  const feedback = payload.feedback ? { ...payload.feedback, citations: payload.feedback.citations.filter(citation => refs.has(citation.sourceRef)) } : null
  const lesson = payload.lesson ? { ...payload.lesson, citations: payload.lesson.citations.filter(citation => refs.has(citation.sourceRef)) } : null
  return { feedback: feedback?.citations.length ? feedback : null, lesson: lesson?.citations.length ? lesson : null }
}
async function teachingPayload(ctx: ReadCtx, userId: string, authority: Authority, validate: boolean, stored?: TeachingPayload) {
  const attempt = authority.row.authoritativeAttemptId ? await ctx.db.get(authority.row.authoritativeAttemptId) : null
  if (!attempt || attempt.userId !== userId || attempt.submissionId !== authority.response._id
    || attempt.assessmentOpportunityId !== authority.row._id || attempt.serverScorePercent === undefined
    || !Number.isFinite(attempt.serverScorePercent) || attempt.serverScorePercent < 0 || attempt.serverScorePercent > 100) deny()
  const passed = attempt.serverScorePercent >= 80
  const explanation = await instructionalBlock(ctx, userId, authority, await instructionalContent(ctx, userId, authority), 'explanation')
  const dependencies = explanation.dependencies
  let actual = stored
  if (!actual) {
    const refs = await instructionalSourceRefs(explanation.instructionalDependencies)
    if (!refs.length) deny()
    const citations = refs.map((sourceRef, index) => ({ sourceRef, label: postSealFeedbackCopy.citationLabel(index) }))
    actual = { feedback: { tier: 'T0', text: postSealFeedbackCopy.text(explanation.claims[0]!.claim), citations },
      lesson: !passed ? { tier: 'T0', paragraphs: [explanation.block.content!], citations } : null }
  }
  if (!actual.feedback) deny()
  const feedback = await separateCaseProof(ctx, userId, authority, explanation, validate,
    { kind: 'feedback', content: actual.feedback, texts: [actual.feedback.text] })
  if (actual.feedback.tier === 'T0' && !explanation.claims.some(claim => claim.claim === actual.feedback!.text)) deny('evidence_unavailable')
  const lesson = actual.lesson ? await separateCaseProof(ctx, userId, authority, explanation, validate,
    { kind: 'lesson', content: actual.lesson, texts: actual.lesson.paragraphs }) : null
  return { payload: actual, dependencies, instructionalDependencies: explanation.instructionalDependencies, validationDigest: await privacyDigest([policy, authority.row.authoritativeAttemptId, feedback.validationDigest, lesson?.validationDigest ?? null]) }
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
    const block = await instructionalBlock(ctx, userId, authority, await instructionalContent(ctx, userId, authority), 'faded_example')
    const payload = { tier: 'T0' as const, prompt: block.block.content! }
    const proof = await separateCaseProof(ctx, userId, authority, block, true, { kind: 'practice', content: payload, texts: [payload.prompt] })
    const blockId = proof.block._id
    const now = Date.now()
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
    const rows = await ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
    if (rows.length !== 1) deny()
    const source = rows[0]!
    parseLearnContract(learnPostSealTeachingSourceStorageSchema, postSealApplicationFields(source))
    if (source.assessmentOpportunityId !== id || source.learningVoidId !== authority.row.learningVoidId
      || source.attemptId !== authority.row.authoritativeAttemptId) deny()
    if (source.content.status === 'purged') deny('evidence_unavailable')
    const teaching = await teachingPayload(ctx, userId, authority, source.content.status === 'pending',
      source.content.status === 'available' ? source.content.payload : undefined)
    if (source.content.status === 'available') {
      await verifyPublication(ctx, userId, { ...source, content: source.content }, { teachingSourceId: source._id }, teaching.dependencies, teaching.validationDigest)
      return { status: 'published' as const }
    }
    if ((await sourceLinks(ctx, userId, { teachingSourceId: source._id })).length) deny()
    const now = Date.now()
    const content = { status: 'available' as const, payload: teaching.payload,
      publication: await publication(teaching.payload, teaching.dependencies, teaching.validationDigest, now, postSealFeedbackCopy.version) }
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

export async function readPostSealTeachingForOwner(ctx: ReadCtx, userId: string, id: Id<'learnAssessmentOpportunities'>, preparationFailure: Reason | null = null): Promise<LearnPostSealTeaching> {
  ctx = measurementReadContext(ctx, userId)
  await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: id })
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return unavailableLearnPostSealTeaching('disabled')
  try {
    const authority = await checkAuthority(ctx, userId, id)
    const rows = await ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
    if (rows.length > 1 || !rows.length && authority.row.authoritativeAttemptId) deny()
    const source = rows[0]
    let disclosed: TeachingPayload | null = null
    if (source) {
      parseLearnContract(learnPostSealTeachingSourceStorageSchema, postSealApplicationFields(source))
      if (source.content.status === 'purged') deny('evidence_unavailable')
      if (source.learningVoidId !== authority.row.learningVoidId || source.assessmentOpportunityId !== id
        || source.attemptId !== (authority.row.authoritativeAttemptId ?? null)) deny()
      if (source.content.status === 'pending') {
        if ((await sourceLinks(ctx, userId, { teachingSourceId: source._id })).length) deny()
      } else {
        const teaching = await teachingPayload(ctx, userId, authority, false, source.content.payload)
        await verifyPublication(ctx, userId, { ...source, content: source.content }, { teachingSourceId: source._id }, teaching.dependencies, teaching.validationDigest)
        disclosed = await instructionalTeaching(source.content.payload, teaching.instructionalDependencies)
      }
    }
    const bindings = await ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', userId).eq('submissionId', authority.response._id)).take(2)
    let practice: PracticeAuthority | null = null
    let practiceFailure = preparationFailure
    if (bindings.length) {
      try { practice = await practiceAuthority(ctx, userId, authority) }
      catch (error) { practiceFailure = validationReason(error) }
    }
    const result = projectPostSealTeaching({ assessmentOpportunityId: id, submissionId: authority.response._id,
      attemptId: authority.row.authoritativeAttemptId ?? null,
      feedback: disclosed?.feedback ?? null,
      lesson: disclosed?.lesson ?? null,
      practice: practice ? { responseSlotId: practice.slot._id, revision: practice.slot.revision, tier: 'T0', prompt: practice.binding.content.status === 'available' ? practice.binding.content.payload.prompt : null } : null }, authority.context)
    if (result.status === 'available' && source?.content.status === 'available' && !disclosed?.feedback) result.availability.feedback = 'unavailable'
    if (result.status === 'available' && practiceFailure) result.availability.practice = { status: 'unavailable', reasonCode: practiceFailure }
    else if (result.status === 'available' && practice && result.practice) result.availability.help = await helpAvailability(ctx, userId, authority, practice)
    return parseLearnContract(learnPostSealTeachingSchema, result)
  } catch (error) { return unavailableLearnPostSealTeaching(validationReason(error)) }
}

export async function readPostSealCitationForOwner(ctx: QueryCtx, userId: string, id: Id<'learnAssessmentOpportunities'>, sourceRef: string): Promise<PostSealCitationSource> {
  ctx = measurementReadContext(ctx, userId)
  const teaching = await readPostSealTeachingForOwner(ctx, userId, id)
  if (teaching.status !== 'available' || !sourceRef.length || sourceRef.length > 200) return unavailablePostSealCitation()
  const cited = [teaching.feedback, teaching.lesson].find(content => content?.citations.some(citation => citation.sourceRef === sourceRef))
  if (!cited) return unavailablePostSealCitation()
  const authority = await checkAuthority(ctx, userId, id)
  const explanation = await instructionalBlock(ctx, userId, authority, await instructionalContent(ctx, userId, authority), 'explanation')
  const dependencies = explanation.instructionalDependencies
  for (const dependency of dependencies) {
    if (dependency.kind !== 'snapshot' && dependency.kind !== 'excerpt') continue
    if (`source_${(await privacyDigest([policy, dependency.sourceSnapshotId])).slice(7)}` !== sourceRef) continue
    if (!await liveDependency(ctx, userId, dependency)) return unavailablePostSealCitation()
    const source = await ctx.db.get(dependency.sourceSnapshotId)
    const identity = source ? await ctx.db.get(source.sourceIdentityId) : null
    if (!source || !identity || identity.userId !== userId || identity.tombstonedAt !== undefined) return unavailablePostSealCitation()
    const excerptDependency = dependencies.find(value => value.kind === 'excerpt' && value.sourceSnapshotId === source._id)
    const excerpt = excerptDependency?.kind === 'excerpt' ? await ctx.db.get(excerptDependency.sourceExcerptId) : null
    const result: PostSealCitationSource = { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', evidence: {
      kind: 'factual', activityId: id, eligibility: 'historical', readOnly: true, integrityState: 'accepted',
      claims: [{ claimId: sourceRef, claimText: 'text' in cited ? cited.text : cited.paragraphs.join('\n\n'), claimStatus: 'unknown', integrityState: 'accepted',
        source: { origin: identity.origin, locator: sanitizePublicSourceLocator(excerpt?.locator) ?? null,
          sourceSnapshotId: source._id, sourceSnapshotRevision: source.revision, sourceRecordRevision: source.recordRevision! } }],
    } }
    return learnSerializedBytes(result) <= LEARN_V2_RESPONSE_LIMITS.maxEnvelopeBytes ? result : unavailablePostSealCitation()
  }
  return unavailablePostSealCitation()
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
    const prior = existing[0]
    if (prior) parseLearnContract(learnPostSealHelpReceiptStorageSchema, postSealApplicationFields(prior))
    const ledger = await helpLedger(ctx, userId, slot)
    const previous = ledger.previous
    const block = await relatedBlock(ctx, userId, authority, practice, request.kind === 'hint' ? 'explanation' : 'worked_example')
    if (request.kind === 'hint' && !canReadPostSealLesson(authority.context)) deny('unavailable')
    const payload = parseLearnContract(learnPracticeAssistanceContentSchema, { kind: request.kind, tier: 'T0', text: block.block.content })
    const replay = prior ?? ledger.receipts.find(receipt => receipt.kind === request.kind && receipt.expectedRevision === request.expectedRevision
      && receipt.content.status === 'available' && canonicalPrivacyJson(receipt.content.payload) === canonicalPrivacyJson(payload))
    const actual = replay?.content.status === 'available' ? replay.content.payload : payload
    const help = await separateCaseProof(ctx, userId, authority, block, !replay, { kind: request.kind, content: actual, texts: [actual.text] })
    const dependencies = normalizeDependencies([...practice.proof.dependencies, ...help.dependencies])
    const validationDigest = await privacyDigest([policy, binding._id, practice.proof.validationDigest, help.validationDigest, request.kind])
    if (replay) {
      if (replay.content.status !== 'available' || replay.evidenceStatus !== 'available') deny('evidence_unavailable')
      if (replay.learningVoidId !== authority.row.learningVoidId || replay.assessmentOpportunityId !== authority.row._id
        || replay.submissionId !== authority.response._id || replay.practiceBindingId !== binding._id || replay.responseSlotId !== slot._id
        || replay.expectedRevision !== request.expectedRevision || replay.kind !== request.kind || replay.commandVersion !== request.version
        || !previous || replay.assistanceSequence > previous.deliveryCount
        || replay === prior && (replay.fingerprintVersion !== fingerprint.fingerprintVersion || replay.requestDigest !== fingerprint.requestDigest)
        || replay.deliveredAt < authority.response.acceptedAt || canonicalPrivacyJson(replay.content.payload) !== canonicalPrivacyJson(payload)) deny()
      const exposure = await ctx.db.get(replay.authorizationId)
      if (!exposure || exposure.userId !== userId || exposure.assessmentOpportunityId !== undefined || exposure.purpose !== 'practice'
        || exposure.learningVoidId !== authority.row.learningVoidId || exposure.blueprintRevisionId !== authority.row.blueprintRevisionId
        || exposure.objectiveId !== authority.row.objectiveId || exposure.policyVersion !== assistancePolicy || exposure.provenanceVersion !== policy
        || exposure.deliveryReceiptHash !== replay.requestDigest
        || exposure.status !== 'granted' || exposure.caseId !== binding.practiceCaseId || exposure.serverTime !== replay.deliveredAt
        || exposure.projectionDigest !== await privacyDigest(payload) || exposure.practiceHelp?.responseSlotId !== slot._id
        || exposure.practiceHelp.practiceBindingId !== binding._id || exposure.practiceHelp.kind !== request.kind
        || exposure.practiceHelp.assistanceSequence !== replay.assistanceSequence) deny()
      const authorizations = await ctx.db.query('learnPostSealHelpReceipts').withIndex('by_userId_and_authorizationId', q =>
        q.eq('userId', userId).eq('authorizationId', replay.authorizationId)).take(2)
      if (authorizations.length !== 1 || authorizations[0]!._id !== replay._id) deny()
      await verifyPublication(ctx, userId, { ...replay, content: replay.content }, { helpReceiptId: replay._id }, dependencies, validationDigest)
      return projectPracticeAssistanceAuthorization({ request, result: { version: request.version, status: 'authorized',
        assessmentOpportunityId: authority.row._id, target: request.target, revision: replay.expectedRevision,
        authorizationId: replay.authorizationId, deliveredAt: replay.deliveredAt, content: replay.content.payload } }, request, authority.context)
    }
    const reason = learnPostSealTeachingDenial(authority.context)
    if (reason) deny(reason)
    if (ledger.distinctContents >= postSealHelpPolicy.distinctContentLimit()) return deniedHelp('help_limit_reached')
    const sequence = (previous?.deliveryCount ?? 0) + 1
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
