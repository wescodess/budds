export const SOURCE_COMPARISON_RESPONSE_VERSION = 'learn-adaptive.source-comparison-response.v1' as const

export const MAX_SOURCE_COMPARISON_RESPONSE_BYTES = 12_000
const MAX_SOURCE_REF_LENGTH = 200

export function sourceComparisonResponseFitsLimit(value: string) {
  return new TextEncoder().encode(value).byteLength <= MAX_SOURCE_COMPARISON_RESPONSE_BYTES
}

export function encodeSourceComparisonResponse(sourceRef: string, rationale: string) {
  return JSON.stringify({ version: SOURCE_COMPARISON_RESPONSE_VERSION, sourceRef, rationale: rationale.trim() })
}

export function decodeSourceComparisonResponse(value: string, allowedSourceRefs?: readonly string[], allowIncomplete = false) {
  if (typeof value !== 'string' || !sourceComparisonResponseFitsLimit(value)
    || allowedSourceRefs && (allowedSourceRefs.length !== 2 || new Set(allowedSourceRefs).size !== 2)) return null
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const candidate = parsed as Record<string, unknown>
  if (Object.keys(candidate).length !== 3 || candidate.version !== SOURCE_COMPARISON_RESPONSE_VERSION
    || typeof candidate.sourceRef !== 'string' || (!allowIncomplete && !candidate.sourceRef) || candidate.sourceRef.length > MAX_SOURCE_REF_LENGTH
    || /[\r\n]/u.test(candidate.sourceRef) || allowedSourceRefs && !allowedSourceRefs.includes(candidate.sourceRef)
    || typeof candidate.rationale !== 'string' || (!allowIncomplete && !candidate.rationale.trim())) return null
  if (encodeSourceComparisonResponse(candidate.sourceRef, candidate.rationale) !== value) return null
  return { sourceRef: candidate.sourceRef, rationale: candidate.rationale }
}
