const KEY_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/
const MAX_PAYLOAD_BYTES = 12_000
export const MAX_ADAPTIVE_COMMAND_REFERENCE_CHARS = 4_096
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'score', 'scorePercent', 'serverScorePercent', 'verdict', 'mastery', 'masteryState',
  'masteryTransition', 'masteryTransitionReason', 'masteryClock', 'nowUtcMs',
  'evidenceAcceptance', 'provider', 'providerModel', 'providerVerdict',
])

export type AdaptiveCommandInput = {
  userId: string
  commandName: string
  targetId: string
  expectedRevision: number
  idempotencyKey: string
  payload: Record<string, unknown>
}

export function boundedAdaptiveCommandReference(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded.length > MAX_ADAPTIVE_COMMAND_REFERENCE_CHARS) throw new Error('Adaptive command result exceeds receipt bounds')
  return encoded
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function assertNoClientAuthority(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNoClientAuthority)
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(key)) throw new Error(`Client authoritative field is not permitted: ${key}`)
    assertNoClientAuthority(item)
  }
}

export async function prepareAdaptiveCommand(input: AdaptiveCommandInput) {
  if (!input.userId || input.userId.length > 512 || !input.commandName || input.commandName.length > 64 || !input.targetId || input.targetId.length > 256) throw new Error('Adaptive command identity is invalid')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error('Expected revision is invalid')
  if (!KEY_PATTERN.test(input.idempotencyKey)) throw new Error('Idempotency key must be 16-128 URL-safe characters')
  assertNoClientAuthority(input.payload)
  const payloadSnapshot = canonicalJson(input.payload)
  if (new TextEncoder().encode(payloadSnapshot).byteLength > MAX_PAYLOAD_BYTES) throw new Error('Adaptive command payload exceeds 12000 bytes')
  return {
    idempotencyKeyHash: await sha256(canonicalJson(['adaptive-command-key.v1', input.userId, input.idempotencyKey])),
    requestFingerprint: await sha256(canonicalJson(['adaptive-command-request.v1', input.commandName, input.targetId, input.expectedRevision, input.payload])),
  }
}
