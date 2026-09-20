import {
  isBoundedDecisionRequest,
  isCompletedTypedDecision,
  LEARNING_DECISION_CLIENT_DEADLINE_MS,
  LEARNING_DECISION_MODEL_REVISION,
  LEARNING_DECISION_RETRY_AFTER_MAX_MS,
  LEARNING_DECISION_RETRY_AFTER_MIN_MS,
  type TypedDecisionRequest,
  type TypedDecisionResult,
  unavailableDecision,
} from './contracts'

export type LayaEvaluatorBinding = { fetch(request: Request): Promise<Response> }

export type LayaAdapterConfig = {
  enabled: boolean
  token: string
  url: string
  binding?: LayaEvaluatorBinding
  timeoutMs?: number
  expectedProvenance?: {
    packageVersion: string
    modelRevision: string
    modelSha256: string
    evaluationManifestSha256: string
    calibratorSha256: string
  }
}

function hasExpectedProvenance(response: Response, expected: NonNullable<LayaAdapterConfig['expectedProvenance']>): boolean {
  return response.headers.get('X-Laya-Evidence-Backend') === 'real'
    && response.headers.get('X-Laya-Calibrator-Status') === 'valid'
    && response.headers.get('X-Laya-Calibration-Mode') === null
    && response.headers.get('X-Laya-Package-Version') === expected.packageVersion
    && response.headers.get('X-Laya-Model-Revision') === expected.modelRevision
    && response.headers.get('X-Laya-Model-SHA256') === expected.modelSha256
    && response.headers.get('X-Laya-Evaluation-Manifest-SHA256') === expected.evaluationManifestSha256
    && response.headers.get('X-Laya-Calibrator-SHA256') === expected.calibratorSha256
}

function clampedRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After')
  if (!value) return undefined
  const seconds = Number(value)
  const parsedDelay = Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1_000)
    : Date.parse(value) - Date.now()
  if (!Number.isFinite(parsedDelay)) return undefined
  return Math.min(Math.max(parsedDelay, LEARNING_DECISION_RETRY_AFTER_MIN_MS), LEARNING_DECISION_RETRY_AFTER_MAX_MS)
}

function unavailableForResponse(response: Response): TypedDecisionResult {
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500
  const reason = response.status === 429 ? 'over_budget' : retryable ? 'unavailable' : 'malformed'
  return unavailableDecision(reason, retryable, retryable ? clampedRetryAfter(response) : undefined)
}

/** The only code that knows the Laya Worker protocol. Never expose this DTO to features. */
export async function evaluateWithLaya(
  request: TypedDecisionRequest,
  config: LayaAdapterConfig,
): Promise<TypedDecisionResult> {
  if (!config.enabled) return unavailableDecision('disabled')
  if (!config.token || (!config.binding && !config.url) || !config.expectedProvenance) return unavailableDecision('unconfigured')
  if (!isBoundedDecisionRequest(request)) return unavailableDecision('malformed')
  const controller = new AbortController()
  const deadlineMs = Math.min(Math.max(config.timeoutMs ?? LEARNING_DECISION_CLIENT_DEADLINE_MS, 50), 15_000)
  const abortTimer = setTimeout(() => controller.abort(), deadlineMs)
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const outbound = new Request(config.url || 'https://laya-evaluator.internal/v1/evaluate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    const response = await Promise.race([
      config.binding ? config.binding.fetch(outbound) : fetch(outbound),
      new Promise<never>((_, reject) => { deadlineTimer = setTimeout(() => reject(new DOMException('Timed out', 'AbortError')), deadlineMs) }),
    ])
    if (!response.ok) return unavailableForResponse(response)
    if (!hasExpectedProvenance(response, config.expectedProvenance)) return unavailableDecision('malformed')
    const payload: unknown = await response.json().catch(() => null)
    if (!isCompletedTypedDecision(payload, request.kind) || payload.modelRevision !== LEARNING_DECISION_MODEL_REVISION) return unavailableDecision('malformed')
    const requestedIds = request.items.map(item => item.id).sort()
    const responseIds = payload.decisions.map(item => item.id).sort()
    return requestedIds.length === responseIds.length && requestedIds.every((id, index) => id === responseIds[index])
      ? payload
      : unavailableDecision('malformed')
  }
  catch (error) {
    return unavailableDecision(error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'unavailable', true)
  }
  finally {
    clearTimeout(abortTimer)
    if (deadlineTimer) clearTimeout(deadlineTimer)
  }
}
