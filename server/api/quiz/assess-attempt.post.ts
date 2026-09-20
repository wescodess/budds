import type { H3Event } from 'h3'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { makeConvexClient } from '../../utils/convex-client'
import {
  evaluateTypedDecision,
  FREE_RESPONSE_ASSESSMENT_KIND,
  type FreeResponseAssessmentItem,
  type FreeResponseDecisionLabel,
} from '../../utils/learning-decisions'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'

type PendingAssessment = {
  assessmentId: Id<'quizAnswerAssessments'>
  kind: typeof FREE_RESPONSE_ASSESSMENT_KIND
  questionSnapshot: {
    question: string
    questionType: 'free-response' | 'fill_in_the_blank'
    expectedAnswer: string
    evidenceExcerpt: string
  }
  learnerAnswerSnapshot: string
  rubricVersion: typeof FREE_RESPONSE_ASSESSMENT_KIND
  rubricSnapshot: Array<{ label: string, description: string }>
}
const MAX_EVALUATOR_REQUEST_BYTES = 30_000

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, 5, 'quiz.assess-attempt')
  const mode = readConfiguredRuntimeValue(useRuntimeConfig(event).learningDecisionMode, 'NUXT_LEARNING_DECISION_MODE')
  if (mode !== 'advisory') return { status: 'disabled' as const }
  const body = await readBody<{ attemptId?: string }>(event)
  if (!body?.attemptId?.trim()) throw createError({ statusCode: 400, message: 'attemptId is required' })
  const client = makeConvexClient(event)
  if (!client) throw createError({ statusCode: 401, message: 'Authentication required' })
  const evaluatorSecret = useRuntimeConfig(event).quizAssessmentWriteSecret
  if (typeof evaluatorSecret !== 'string' || evaluatorSecret.length < 32) throw createError({ statusCode: 503, message: 'Advisory assessment is not configured' })
  const attemptId = body.attemptId as Id<'quizAttempts'>

  const task = processPendingAssessments(event, client, attemptId, evaluatorSecret)
  const waitUntil = event.context.waitUntil as ((promise: Promise<unknown>) => void) | undefined
  if (typeof waitUntil === 'function') {
    waitUntil(task)
    return { status: 'queued' as const }
  }
  await task
  return { status: 'completed' as const }
})

async function processPendingAssessments(
  event: H3Event,
  client: NonNullable<ReturnType<typeof makeConvexClient>>,
  attemptId: Id<'quizAttempts'>,
  evaluatorSecret: string,
) {
  const pending = await client.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId }) as PendingAssessment[]
  for (const batch of boundedBatches(pending)) {
    const items = batch.map(toCanonicalItem)
    const inputDigest = await digest(items)
    const claimed = await client.mutation(api.quizAnswerAssessments.claimBatch, {
      attemptId,
      assessmentIds: batch.map(row => row.assessmentId),
      inputDigest,
    }) as Array<Id<'quizAnswerAssessments'>>
    const claimedSet = new Set(claimed.map(String))
    const claimedItems = items.filter(item => claimedSet.has(item.id))
    if (claimedItems.length === 0) continue
    try {
      const requestId = crypto.randomUUID()
      const started = Date.now()
      const result = await evaluateTypedDecision(event, {
        kind: FREE_RESPONSE_ASSESSMENT_KIND,
        requestId,
        inputDigest,
        items: claimedItems,
      })
      logAssessmentResult(requestId, inputDigest, result, claimedItems.length, Date.now() - started)
      if (result.status === 'unavailable') {
        await client.mutation(api.quizAnswerAssessments.recordUnavailable, {
          attemptId,
          evaluatorSecret,
          assessmentIds: claimed,
          inputDigest,
          reason: result.reason,
          retryable: result.retryable,
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
        reason: 'unavailable',
        retryable: true,
      }).catch(() => undefined)
    }
  }
}

function toCanonicalItem(row: PendingAssessment): FreeResponseAssessmentItem {
  return {
    id: String(row.assessmentId),
    question: bounded(row.questionSnapshot.question, 1_200),
    questionType: row.questionSnapshot.questionType,
    expectedAnswer: bounded(row.questionSnapshot.expectedAnswer, 400),
    learnerAnswer: bounded(row.learnerAnswerSnapshot, 800),
    evidenceExcerpt: bounded(row.questionSnapshot.evidenceExcerpt, 1_200),
    rubricVersion: row.rubricVersion,
    rubric: row.rubricSnapshot as FreeResponseAssessmentItem['rubric'],
  }
}

function bounded(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength)
}

function boundedBatches(rows: PendingAssessment[]) {
  const batches: PendingAssessment[][] = []
  let current: PendingAssessment[] = []
  for (const row of rows) {
    const candidate = [...current, row]
    if (current.length > 0 && (candidate.length > 8 || encodedRequestBytes(candidate.map(toCanonicalItem)) > MAX_EVALUATOR_REQUEST_BYTES)) {
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
