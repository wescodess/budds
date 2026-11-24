import { LEARN_MEASUREMENT_ITEM_LIMITS as limits, MeasurementItemBoundsError } from '../../shared/learn-v2-measurement-item-limits'
import { ADAPTIVE_V2_PILOT_MANIFEST, validateAdaptiveProviderPayload } from '../../shared/adaptive-v2-pilot-policy'
import { serializeCompletionRequest, type GenerateParams } from './ai-gateway'
import { buildBaselineMasteryScoringPayload, buildBaselineMasteryScoringRequest, type BaselineMasteryScoringInput } from './learn-v2-mastery-scorer'
import { learnMeasurementRubricScoringProtocol } from './learn-v2-measurement-rubric-scorer'

type RequestBinding = { kind: 'model', requestedModel: string, routingMode: 'legacy_auto' | 'strict', endpoint?: string | null } | { kind: 'deterministic' }
type RequestBuilder = (model: string, input: BaselineMasteryScoringInput, signal: AbortSignal) => GenerateParams

function requestBytes(input: BaselineMasteryScoringInput, binding: RequestBinding, requestBuilder?: RequestBuilder) {
  const model = binding.kind === 'model' ? binding.requestedModel : 'measurement-deterministic'
  const request = requestBuilder ? requestBuilder(model, input, new AbortController().signal) : input.declaredStimulus !== undefined
    ? learnMeasurementRubricScoringProtocol.request(model, input, new AbortController().signal)
    : buildBaselineMasteryScoringRequest(model, buildBaselineMasteryScoringPayload(input), new AbortController().signal)
  request.captureScoringProvenance = true
  if (binding.kind === 'model' && binding.routingMode === 'strict') request.providerOrder = [binding.endpoint!]
  return new TextEncoder().encode(serializeCompletionRequest(request)).byteLength
}

export function assertMeasurementScoringTransportContract(input: BaselineMasteryScoringInput, binding: RequestBinding, requestBuilder?: RequestBuilder) {
  if (requestBytes(input, binding, requestBuilder) > Math.min(limits.scoringRequestBytes, ADAPTIVE_V2_PILOT_MANIFEST.limits.maxRequestBytes)) throw new MeasurementItemBoundsError('response_payload_limit')
}

export function assertMeasurementScoringContract(input: BaselineMasteryScoringInput, binding: RequestBinding, acceptance = false, requestBuilder?: RequestBuilder) {
  if (input.evidence.length > limits.evidenceRows) throw new MeasurementItemBoundsError('item_evidence_limit')
  const base = { ...input, learnerResponse: 'x' }
  const privacy = (value: BaselineMasteryScoringInput) => validateAdaptiveProviderPayload({ learnerResponse: value.learnerResponse,
    challenge: `${value.challenge}${value.declaredStimulus !== undefined ? `\n${value.declaredStimulus ?? ''}` : ''}`,
    evidence: value.evidence.map(row => `${row.alias}: ${row.claim}\n${row.excerpt ?? ''}`),
    rubric: value.rubric.criteria.map(row => `${row.key}: ${row.description ?? ''}`) })
  if (binding.kind === 'model' && !privacy(base).allowed) throw new MeasurementItemBoundsError('provider_payload_unavailable')
  const maximum = Math.min(limits.scoringRequestBytes, ADAPTIVE_V2_PILOT_MANIFEST.limits.maxRequestBytes)
  const baseBytes = requestBytes(base, binding, requestBuilder)
  if (baseBytes + limits.responseWireBytes > maximum) throw new MeasurementItemBoundsError('item_scoring_request_limit')
  if (!acceptance) return
  if (binding.kind === 'model' && !privacy(input).allowed) throw new MeasurementItemBoundsError('provider_payload_unavailable')
  const actualBytes = requestBytes(input, binding, requestBuilder)
  if (actualBytes - baseBytes > limits.responseWireBytes || actualBytes > maximum) throw new MeasurementItemBoundsError('response_payload_limit')
}
