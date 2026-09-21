import type { H3Event } from 'h3'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { makeConvexClient } from '../../utils/convex-client'
import {
  evaluateTypedDecision,
  FREE_RESPONSE_ASSESSMENT_KIND,
  LEARNING_DECISION_CONTRACT_VERSION,
  LEARNING_DECISION_MAX_ATTEMPTS,
  LEARNING_DECISION_SNAPSHOT_VERSION,
  type FreeResponseAssessmentItem,
  type FreeResponseDecisionLabel,
} from '../../utils/learning-decisions'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'
import { bundledQuizSemanticActivationDecision, isQuizSemanticShadowEnabled } from '../../utils/learning-decisions/activation'

type PendingAssessment = {
  assessmentId: Id<'quizAnswerAssessments'>
  kind: typeof FREE_RESPONSE_ASSESSMENT_KIND
  contractVersion: string
  snapshotVersion: string
  languageSnapshot: string
  questionSnapshot: {
    question: string
    questionType: 'free-response' | 'fill_in_the_blank'
    expectedAnswer: string
    evidenceExcerpt: string
  }
  learnerAnswerSnapshot: string
  deterministicIsCorrect: boolean
  rubricVersion: typeof FREE_RESPONSE_ASSESSMENT_KIND
  rubricSnapshot: Array<{ label: string, description: string }>
  attemptCount: number
}
const MAX_EVALUATOR_REQUEST_BYTES = 30_000
const MAX_ASSESSMENT_DRAIN_PASSES = 26

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, 5, 'quiz.assess-attempt')
  const runtimeConfig = useRuntimeConfig(event)
  const mode = readConfiguredRuntimeValue(runtimeConfig.learningDecisionMode, 'NUXT_LEARNING_DECISION_MODE')
  const activationManifest = readConfiguredRuntimeValue(runtimeConfig.quizSemanticActivationManifest, 'NUXT_QUIZ_SEMANTIC_ACTIVATION_MANIFEST')
  const deployment = {
    applicationEnvironment: readConfiguredRuntimeValue(runtimeConfig.quizSemanticApplicationEnvironment, 'NUXT_APPLICATION_ENVIRONMENT'),
    pagesEnvironment: readConfiguredRuntimeValue(runtimeConfig.quizSemanticPagesEnvironment, 'CF_PAGES_ENVIRONMENT'),
    pagesBranch: readConfiguredRuntimeValue(runtimeConfig.quizSemanticPagesBranch, 'CF_PAGES_BRANCH'),
    convexUrl: readConfiguredRuntimeValue(runtimeConfig.public?.convex?.url, 'NUXT_PUBLIC_CONVEX_URL'),
  }
  if (mode === 'shadow') {
    if (!isQuizSemanticShadowEnabled(mode, deployment)) return { status: 'disabled' as const, reason: 'production_forbidden' }
  }
  else {
    const activation = bundledQuizSemanticActivationDecision(mode, activationManifest, deployment)
    if (!activation.enabled) return { status: 'disabled' as const, reason: activation.code }
  }
  const body = await readBody<{ attemptId?: string }>(event)
  if (!body?.attemptId?.trim()) throw createError({ statusCode: 400, message: 'attemptId is required' })
  const client = makeConvexClient(event)
  if (!client) throw createError({ statusCode: 401, message: 'Authentication required' })
  const attemptId = body.attemptId as Id<'quizAttempts'>
  const evaluatorSecret = runtimeConfig.quizAssessmentWriteSecret
  if (typeof evaluatorSecret !== 'string' || evaluatorSecret.length < 32) throw createError({ statusCode: 503, message: 'Semantic assessment is not configured' })
  if (mode === 'shadow') {
    await processShadowAssessments(event, client, attemptId, evaluatorSecret)
    return { status: 'completed' as const }
  }

  const task = processPendingAssessments(event, client, attemptId, evaluatorSecret)
  const waitUntil = event.context.waitUntil as ((promise: Promise<unknown>) => void) | undefined
  if (typeof waitUntil === 'function') {
    waitUntil(task)
    return { status: 'queued' as const }
  }
  await task
  return { status: 'completed' as const }
})

async function processShadowAssessments(
  event: H3Event,
  client: NonNullable<ReturnType<typeof makeConvexClient>>,
  attemptId: Id<'quizAttempts'>,
  evaluatorSecret: string,
) {
  for (let pass = 0; pass < MAX_ASSESSMENT_DRAIN_PASSES; pass++) {
    const pending = await client.query(api.quizAnswerAssessments.listPendingForShadowAttempt, { attemptId }) as PendingAssessment[]
    if (pending.length === 0) break
    const semanticPending = pending.filter(row => !row.deterministicIsCorrect)
    if (semanticPending.length === 0) break
    for (const batch of boundedBatches(semanticPending)) {
      const items = batch.map(toCanonicalItem)
      const inputDigest = await digest(items)
      const claimId = crypto.randomUUID()
      const claimed = await client.mutation(api.quizAnswerAssessments.claimShadowBatch, {
        attemptId,
        assessmentIds: batch.map(row => row.assessmentId),
        inputDigest,
        claimId,
      }) as Array<Id<'quizAnswerAssessments'>>
      const claimedSet = new Set(claimed.map(String))
      const claimedItems = items.filter(item => claimedSet.has(item.id))
      if (claimedItems.length === 0) continue
      try {
        const result = await evaluateAssessmentBatch(event, batch[0]!, claimedItems, inputDigest)
        if (result.status === 'unavailable') {
          await client.mutation(api.quizAnswerAssessments.recordShadowUnavailable, {
            attemptId, evaluatorSecret, assessmentIds: claimed, inputDigest, claimId, reason: result.reason,
          })
          continue
        }
        await client.mutation(api.quizAnswerAssessments.recordShadowAvailable, {
          attemptId,
          evaluatorSecret,
          provider: result.provider,
          modelRevision: result.modelRevision,
          results: result.decisions.map(decision => ({
            assessmentId: decision.id as Id<'quizAnswerAssessments'>,
            inputDigest,
            claimId,
            label: decision.label as FreeResponseDecisionLabel,
            confidence: decision.confidence,
            reviewRequired: decision.reviewRequired ?? true,
            probabilities: toStoredProbabilities(decision.probabilities),
          })),
        })
      }
      catch {
        await client.mutation(api.quizAnswerAssessments.recordShadowUnavailable, {
          attemptId, evaluatorSecret, assessmentIds: claimed, inputDigest, claimId, reason: 'unavailable',
        }).catch(() => undefined)
      }
    }
  }
}

async function processPendingAssessments(
  event: H3Event,
  client: NonNullable<ReturnType<typeof makeConvexClient>>,
  attemptId: Id<'quizAttempts'>,
  evaluatorSecret: string,
) {
  const seenAssessmentIds = new Set<string>()
  for (let pass = 0; pass < MAX_ASSESSMENT_DRAIN_PASSES; pass++) {
    const pending = (await client.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId }) as PendingAssessment[])
      .filter(row => !seenAssessmentIds.has(String(row.assessmentId)))
    if (pending.length === 0) break
    for (const row of pending) seenAssessmentIds.add(String(row.assessmentId))
    const exhausted = pending.filter(row => row.attemptCount >= LEARNING_DECISION_MAX_ATTEMPTS)
    for (const batch of boundedBatches(exhausted)) {
      await client.mutation(api.quizAnswerAssessments.claimBatch, {
        attemptId,
        assessmentIds: batch.map(row => row.assessmentId),
        inputDigest: await digest(batch.map(toCanonicalItem)),
        claimId: crypto.randomUUID(),
      })
    }
    for (const batch of boundedBatches(pending.filter(row => row.attemptCount < LEARNING_DECISION_MAX_ATTEMPTS))) {
      const items = batch.map(toCanonicalItem)
      const inputDigest = await digest(items)
      const claimId = crypto.randomUUID()
      const claimed = await client.mutation(api.quizAnswerAssessments.claimBatch, {
        attemptId,
        assessmentIds: batch.map(row => row.assessmentId),
        inputDigest,
        claimId,
      }) as Array<Id<'quizAnswerAssessments'>>
      const claimedSet = new Set(claimed.map(String))
      const claimedItems = items.filter(item => claimedSet.has(item.id))
      if (claimedItems.length === 0) continue
      try {
        const result = await evaluateAssessmentBatch(event, batch[0]!, claimedItems, inputDigest)
        if (result.status === 'unavailable') {
          await client.mutation(api.quizAnswerAssessments.recordUnavailable, {
            attemptId,
            evaluatorSecret,
            assessmentIds: claimed,
            inputDigest,
            claimId,
            reason: result.reason,
            retryable: result.retryable,
            retryAfterMs: result.retryAfterMs,
          })
          continue
        }
        await client.mutation(api.quizAnswerAssessments.recordAvailable, {
          attemptId,
          evaluatorSecret,
          provider: result.provider,
          modelRevision: result.modelRevision,
          results: result.decisions.map(decision => ({
            assessmentId: decision.id as Id<'quizAnswerAssessments'>,
            inputDigest,
            claimId,
            label: decision.label as FreeResponseDecisionLabel,
            confidence: decision.confidence,
            probabilities: toStoredProbabilities(decision.probabilities),
          })),
        })
      }
      catch {
        await client.mutation(api.quizAnswerAssessments.recordUnavailable, {
          attemptId,
          evaluatorSecret,
          assessmentIds: claimed,
          inputDigest,
          claimId,
          reason: 'unavailable',
          retryable: true,
        }).catch(() => undefined)
      }
    }
  }
}

async function evaluateAssessmentBatch(
  event: H3Event,
  batchHead: PendingAssessment,
  items: FreeResponseAssessmentItem[],
  inputDigest: string,
) {
  const requestId = crypto.randomUUID()
  const started = Date.now()
  const result = await evaluateTypedDecision(event, {
    kind: FREE_RESPONSE_ASSESSMENT_KIND,
    requestId,
    inputDigest,
    contractVersion: batchHead.contractVersion as typeof LEARNING_DECISION_CONTRACT_VERSION,
    snapshotVersion: batchHead.snapshotVersion as typeof LEARNING_DECISION_SNAPSHOT_VERSION,
    items,
  })
  logAssessmentResult(requestId, inputDigest, result, items.length, Date.now() - started)
  return result
}

function toCanonicalItem(row: PendingAssessment): FreeResponseAssessmentItem {
  return {
    id: String(row.assessmentId),
    question: row.questionSnapshot.question.trim(),
    questionType: row.questionSnapshot.questionType,
    expectedAnswer: row.questionSnapshot.expectedAnswer.trim(),
    learnerAnswer: row.learnerAnswerSnapshot.trim(),
    evidenceExcerpt: row.questionSnapshot.evidenceExcerpt.trim(),
    language: row.languageSnapshot,
    rubricVersion: row.rubricVersion,
    rubric: row.rubricSnapshot as FreeResponseAssessmentItem['rubric'],
  }
}

function boundedBatches(rows: PendingAssessment[]) {
  const batches: PendingAssessment[][] = []
  let current: PendingAssessment[] = []
  for (const row of rows) {
    const candidate = [...current, row]
    const changesContract = current.length > 0 && (row.contractVersion !== current[0]!.contractVersion || row.snapshotVersion !== current[0]!.snapshotVersion)
    if (current.length > 0 && (changesContract || candidate.length > 8 || encodedRequestBytes(candidate.map(toCanonicalItem)) > MAX_EVALUATOR_REQUEST_BYTES)) {
      batches.push(current)
      current = [row]
    }
    else current = candidate
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function encodedRequestBytes(items: FreeResponseAssessmentItem[]) {
  return new TextEncoder().encode(JSON.stringify({
    kind: FREE_RESPONSE_ASSESSMENT_KIND,
    requestId: '0'.repeat(36),
    inputDigest: '0'.repeat(64),
    contractVersion: LEARNING_DECISION_CONTRACT_VERSION,
    snapshotVersion: LEARNING_DECISION_SNAPSHOT_VERSION,
    items,
  })).byteLength
}

function logAssessmentResult(requestId: string, inputDigest: string, result: Awaited<ReturnType<typeof evaluateTypedDecision>>, itemCount: number, timingMs: number) {
  const labels = result.status === 'completed' ? result.decisions.map(decision => decision.label) : []
  console.info('[quiz-semantic-assessment]', {
    requestId,
    inputDigest,
    status: result.status,
    reason: result.status === 'unavailable' ? result.reason : undefined,
    provider: result.status === 'completed' ? result.provider : undefined,
    modelRevision: result.status === 'completed' ? result.modelRevision : undefined,
    itemCount,
    labelCounts: Object.fromEntries([...new Set(labels)].map(label => [label, labels.filter(value => value === label).length])),
    timingMs,
  })
}

async function digest(items: FreeResponseAssessmentItem[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(items))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function toStoredProbabilities(probabilities?: Record<string, number>) {
  if (!probabilities) return undefined
  if (typeof probabilities.fully_correct !== 'number' || typeof probabilities.partially_correct !== 'number'
    || typeof probabilities.incorrect !== 'number' || typeof probabilities.uncertain !== 'number') return undefined
  return {
    fullyCorrect: probabilities.fully_correct,
    partiallyCorrect: probabilities.partially_correct,
    incorrect: probabilities.incorrect,
    uncertain: probabilities.uncertain,
  }
}
