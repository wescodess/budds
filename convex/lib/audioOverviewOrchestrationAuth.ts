const MINIMUM_TOKEN_LENGTH = 32

function constantTimeishEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const comparedLength = Math.max(leftBytes.length, rightBytes.length, 1)
  let difference = leftBytes.length ^ rightBytes.length

  for (let index = 0; index < comparedLength; index++) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return difference === 0
}

/**
 * Public Convex lifecycle mutations require both the owning user identity and
 * this server-held credential. The same secret must be configured on Nuxt,
 * the Audio Overview Worker, and the active Convex deployment.
 */
export function requireAudioOverviewOrchestrationCredential(received: string): void {
  const configured = process.env.AUDIO_OVERVIEW_WORKER_TOKEN?.trim() ?? ''
  const candidate = received.trim()
  if (configured.length < MINIMUM_TOKEN_LENGTH
    || candidate.length < MINIMUM_TOKEN_LENGTH
    || !constantTimeishEqual(configured, candidate)) {
    throw new Error('Invalid Audio Overview orchestration credential')
  }
}
