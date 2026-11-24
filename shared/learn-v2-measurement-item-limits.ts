import { ADAPTIVE_V2_PILOT_MANIFEST } from './adaptive-v2-pilot-policy'
import { LEARN_MEASUREMENT_STORAGE_LIMITS as storage } from './learn-v2-measurement-storage-manifest'

export const LEARN_MEASUREMENT_ITEM_LIMITS = Object.freeze({
  forms: storage.maxFamilyMembers, claims: storage.maxClaims, supportsPerClaim: storage.maxSupportsPerClaim, evidenceRows: 64, sources: storage.maxSourceDependencies,
  publicationBytes: storage.maxEnvelopeBytes, generationBytes: 512 * 1024,
  scoringRequestBytes: ADAPTIVE_V2_PILOT_MANIFEST.limits.maxRequestBytes, responseWireBytes: 16_000,
})

type MeasurementItemBoundsCode = 'item_evidence_limit' | 'item_payload_limit' | 'item_scoring_request_limit' | 'response_payload_limit' | 'provider_payload_unavailable'

export class MeasurementItemBoundsError extends Error {
  readonly code: MeasurementItemBoundsCode
  constructor(code: MeasurementItemBoundsCode) {
    super(code)
    this.code = code
  }
}

export function assertMeasurementEvidenceRows(claims: readonly { supports: readonly unknown[] }[]) {
  if (claims.length > LEARN_MEASUREMENT_ITEM_LIMITS.claims
    || claims.some(claim => claim.supports.length > LEARN_MEASUREMENT_ITEM_LIMITS.supportsPerClaim)
    || claims.reduce((count, claim) => count + claim.supports.length, 0) > LEARN_MEASUREMENT_ITEM_LIMITS.evidenceRows) {
    throw new MeasurementItemBoundsError('item_evidence_limit')
  }
}
