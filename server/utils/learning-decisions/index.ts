import type { H3Event } from 'h3'
import { readConfiguredRuntimeValue } from '../runtime-config'
import {
  LEARNING_DECISION_CONTRACT_VERSION,
  LEARNING_DECISION_MAX_ITEMS,
  LEARNING_DECISION_SNAPSHOT_VERSION,
  preflightUnavailable,
  type QuizDecisionItem,
  type TypedDecisionRequest,
  type TypedDecisionResult,
  unavailableDecision,
} from './contracts'
import { evaluateWithLaya, type LayaEvaluatorBinding } from './laya-adapter'

export * from './contracts'
export type LearningDecisionMode = 'off' | 'shadow' | 'advisory'
export type LearningDecisionProvider = 'laya'

/** Provider-neutral dispatch. Feature callers do not import a provider adapter. */
export async function evaluateTypedDecision(event: H3Event, request: TypedDecisionRequest): Promise<TypedDecisionResult> {
  const preflight = preflightUnavailable(request)
  if (preflight) return preflight
  const config = useRuntimeConfig(event)
  const mode = readConfiguredRuntimeValue(config.learningDecisionMode, 'NUXT_LEARNING_DECISION_MODE') as LearningDecisionMode
  const provider = readConfiguredRuntimeValue(config.learningDecisionProvider, 'NUXT_LEARNING_DECISION_PROVIDER') as LearningDecisionProvider
  if (mode !== 'shadow' && mode !== 'advisory') return unavailableDecision('disabled')
  const token = readConfiguredRuntimeValue(config.layaEvaluatorToken, 'NUXT_LAYA_EVALUATOR_TOKEN')
  const url = readConfiguredRuntimeValue(config.layaEvaluatorUrl, 'NUXT_LAYA_EVALUATOR_URL')
  const cloudflareEnv = event.context.cloudflare?.env as Record<string, unknown> | undefined
  const binding = cloudflareEnv?.LAYA_EVALUATOR as LayaEvaluatorBinding | undefined
  if (provider === 'laya') return await evaluateWithLaya(request, { enabled: true, token, url, binding })
  return unavailableDecision('unconfigured')
}

/**
 * Advisory quiz entry point. Its result is intentionally discarded by the
 * route: this pilot must never influence publication or score.
 */
export async function shadowEvaluateQuiz(event: H3Event, items: QuizDecisionItem[]): Promise<TypedDecisionResult> {
  if (items.length > LEARNING_DECISION_MAX_ITEMS) return unavailableDecision('over_budget')
  const serialized = JSON.stringify(items)
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized)))).map(byte => byte.toString(16).padStart(2, '0')).join('')
  const request = {
    kind: 'quiz_quality' as const,
    requestId: crypto.randomUUID(),
    inputDigest: digest,
    contractVersion: LEARNING_DECISION_CONTRACT_VERSION,
    snapshotVersion: LEARNING_DECISION_SNAPSHOT_VERSION,
    items,
  }
  const started = Date.now()
  const result = await evaluateTypedDecision(event, request)
  const confidences = result.status === 'completed' ? result.decisions.map(d => d.confidence) : []
  console.info('[learning-decision]', { requestId: request.requestId, inputDigest: digest, provider: result.status === 'completed' ? result.provider : undefined, modelRevision: result.status === 'completed' ? result.modelRevision : undefined, status: result.status, reason: result.status === 'unavailable' ? result.reason : undefined, timingMs: Date.now() - started, itemCount: items.length, omittedItemCount: 0, supportedCount: result.status === 'completed' ? result.decisions.filter(d => d.label === 'supported').length : undefined, needsReviewCount: result.status === 'completed' ? result.decisions.filter(d => d.label === 'needs_review').length : undefined, meanConfidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : undefined })
  return result
}
