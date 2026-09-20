import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import activation from '../../../convex/quizSemanticActivationManifest.json'
import bundledReport from '../../../workers/laya-evaluator/calibration/report.json'
import bundledCalibrator from '../../../workers/laya-evaluator/calibration/probability-calibrator.v1.json'
import bundledThresholds from '../../../workers/laya-evaluator/calibration/thresholds.json'
import { verifyQuizSemanticActivation, type ActivationDecision } from '../../../shared/quiz-semantic-calibration.mjs'

export const QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION = activation.manifestVersion

export type QuizSemanticDeploymentIdentity = {
  applicationEnvironment: string
  pagesEnvironment: string
  pagesBranch: string
  convexUrl: string
}

function currentDeploymentIdentity(): QuizSemanticDeploymentIdentity {
  return {
    applicationEnvironment: process.env.NUXT_APPLICATION_ENVIRONMENT || '',
    pagesEnvironment: process.env.CF_PAGES_ENVIRONMENT || '',
    pagesBranch: process.env.CF_PAGES_BRANCH || '',
    convexUrl: process.env.NUXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || '',
  }
}

export function quizSemanticActivationDecision(
  mode: unknown,
  configuredManifest: unknown,
  deployment: QuizSemanticDeploymentIdentity = currentDeploymentIdentity(),
  projectRoot = process.cwd(),
): ActivationDecision {
  const evidence = readJsonArtifact(projectRoot, activation.evidence.reportPath)
  const thresholds = readJsonArtifact(projectRoot, activation.thresholds.path)
  const fit = readJsonArtifact(projectRoot, activation.corpora.fit.path)
  const heldout = readJsonArtifact(projectRoot, activation.corpora.heldout.path)
  const evaluationManifest = readJsonArtifact(projectRoot, activation.evaluationManifest.path)
  const calibrator = readJsonArtifact(projectRoot, activation.calibrator.path)
  return verifyQuizSemanticActivation({
    mode,
    configuredManifestVersion: configuredManifest,
    manifest: activation,
    report: evidence.value,
    reportSha256: evidence.sha256,
    thresholds: thresholds.value,
    thresholdsSha256: thresholds.sha256,
    artifactSha256: { fit: fit.sha256, heldout: heldout.sha256, evaluationManifest: evaluationManifest.sha256, calibrator: calibrator.sha256 },
    calibrator: calibrator.value,
    deployment,
  })
}

export function isQuizSemanticAdvisoryEnabled(
  mode: unknown,
  configuredManifest: unknown,
  deployment?: QuizSemanticDeploymentIdentity,
  projectRoot?: string,
): boolean {
  return quizSemanticActivationDecision(mode, configuredManifest, deployment, projectRoot).enabled
}

/**
 * Runtime verifier over build-bundled policy and evidence. Strict build validation
 * independently verifies the report bytes against this digest before deployment.
 */
export function bundledQuizSemanticActivationDecision(
  mode: unknown,
  configuredManifest: unknown,
  deployment: QuizSemanticDeploymentIdentity,
): ActivationDecision {
  // The calibration runner emits exactly this stable pretty-printed form. Hash the
  // bundled content instead of trusting the digest claimed by the manifest.
  const reportSha256 = createHash('sha256')
    .update(`${JSON.stringify(bundledReport, null, 2)}\n`)
    .digest('hex')
  const thresholdsSha256 = createHash('sha256')
    .update(`${JSON.stringify(bundledThresholds, null, 2)}\n`)
    .digest('hex')
  const calibratorSha256 = createHash('sha256')
    .update(`${JSON.stringify(bundledCalibrator, null, 2)}\n`)
    .digest('hex')
  return verifyQuizSemanticActivation({
    mode,
    configuredManifestVersion: configuredManifest,
    manifest: activation,
    report: bundledReport,
    reportSha256,
    thresholds: bundledThresholds,
    thresholdsSha256,
    artifactSha256: {
      fit: activation.corpora.fit.sha256,
      heldout: activation.corpora.heldout.sha256,
      evaluationManifest: activation.evaluationManifest.sha256,
      calibrator: calibratorSha256,
    },
    calibrator: bundledCalibrator,
    deployment,
  })
}

function readJsonArtifact(projectRoot: string, relativePath: unknown): { value: unknown, sha256: string } {
  if (typeof relativePath !== 'string') return { value: null, sha256: '' }
  const root = path.resolve(projectRoot)
  const artifactPath = path.resolve(root, relativePath)
  if (!artifactPath.startsWith(`${root}${path.sep}`) || !existsSync(artifactPath)) return { value: null, sha256: '' }
  const bytes = readFileSync(artifactPath)
  try {
    return { value: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  catch {
    return { value: null, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
}
