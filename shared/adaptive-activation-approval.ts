import shippedApproval from '../docs/operations/adaptive-learn-activation-approval.v1.json'

// Server deployment configuration, never a client-provided approval claim.
export const ADAPTIVE_ACTIVATION_CONFIGURATION: { approval: unknown } = { approval: shippedApproval }

const ROLES = ['accessibility', 'security', 'operations', 'rollback'] as const

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function named(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256
}

/** Shape validation consumes a recorded review; it does not perform that review. */
export function hasReviewedAdaptiveActivationApproval(value: unknown, allowLocalSynthetic = false): boolean {
  if (!record(value) || !exactKeys(value, ['version', 'scope', 'decision', 'testedSha', 'owners'])
    || value.version !== 'adaptive-activation-approval.v1' || value.scope !== 'adaptive_cohort_entitlement'
    || value.decision !== 'approved' || typeof value.testedSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.testedSha)
    || !record(value.owners) || !exactKeys(value.owners, ROLES)) return false
  const sha = value.testedSha
  const owners = value.owners
  return ROLES.every((role) => {
    const owner = owners[role]
    if (!record(owner) || !exactKeys(owner, ['principal', 'reviewDecision', 'testedSha', 'evidence'])
      || !named(owner.principal) || owner.reviewDecision !== 'approved' || owner.testedSha !== sha
      || !Array.isArray(owner.evidence) || owner.evidence.length < 1 || owner.evidence.length > 16) return false
    return owner.evidence.every((evidence: unknown) => {
      if (!record(evidence) || !exactKeys(evidence, ['reference', 'testedSha', 'reviewDecision', 'provenance'])
        || !named(evidence.reference) || evidence.testedSha !== sha || evidence.reviewDecision !== 'approved'
        || !(evidence.provenance === 'independent_review' || (allowLocalSynthetic && evidence.provenance === 'local_synthetic'))) return false
      try {
        const url = new URL(evidence.reference)
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
          && new TextEncoder().encode(evidence.reference).length <= 256
      }
      catch { return false }
    })
  })
}
