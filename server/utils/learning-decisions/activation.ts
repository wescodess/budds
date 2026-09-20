import activation from '../../../convex/quizSemanticActivationManifest.json'

export const QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION = activation.manifestVersion

export function isQuizSemanticAdvisoryEnabled(mode: unknown, configuredManifest: unknown): boolean {
  const calibrationEvidence: unknown = activation.approvedCalibrationEvidence
  return mode === 'advisory'
    && activation.status === 'approved'
    && activation.allowedModes.includes('advisory')
    && typeof calibrationEvidence === 'string'
    && calibrationEvidence.length > 0
    && configuredManifest === activation.manifestVersion
}
