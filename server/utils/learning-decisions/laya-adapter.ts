import {
  isBoundedDecisionRequest,
  isCompletedTypedDecision,
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
}

const DEFAULT_TIMEOUT_MS = 800
const PINNED_REVISION = 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2'

function unavailableForStatus(status: number): TypedDecisionResult {
  if (status === 429) return unavailableDecision('over_budget', true)
  return unavailableDecision(status === 408 || status >= 500 ? 'unavailable' : 'malformed', status === 408 || status === 429 || status >= 500)
}

/** The only code that knows the Laya Worker protocol. Never expose this DTO to features. */
export async function evaluateWithLaya(
  request: TypedDecisionRequest,
  config: LayaAdapterConfig,
): Promise<TypedDecisionResult> {
  if (!config.enabled) return unavailableDecision('disabled')
  if (!config.token || (!config.binding && !config.url)) return unavailableDecision('unconfigured')
  if (!isBoundedDecisionRequest(request)) return unavailableDecision('malformed')
  const controller = new AbortController()
  const deadlineMs = Math.min(Math.max(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 50), 2_000)
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
    if (!response.ok) return unavailableForStatus(response.status)
    const payload: unknown = await response.json().catch(() => null)
    if (!isCompletedTypedDecision(payload) || payload.modelRevision !== PINNED_REVISION) return unavailableDecision('malformed')
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
