import { api } from './_generated/api'
import type { FunctionArgs } from 'convex/server'

export type LearnV2MasterySubmissionArgs = FunctionArgs<typeof api.learnV2Mastery.acceptMasterySubmission>

export function masterySubmissionArgs(submission: LearnV2MasterySubmissionArgs['submission']): LearnV2MasterySubmissionArgs {
  return { submission }
}

const canonical = {
  readiness: api.learnV2Assessments.getFeatureReadiness,
  acceptResponse: api.learnV2Responses.acceptResponse,
  getResponseState: api.learnV2Responses.getResponseState,
  terminalizeResponse: api.learnV2Responses.terminalizeResponse,
  grantAssessmentDelivery: api.learnV2Assessments.grantAssessmentDelivery,
  getAssessment: api.learnV2Assessments.getAssessment,
  getAssessmentState: api.learnV2Assessments.getAssessmentState,
  acceptMasterySubmission: api.learnV2Mastery.acceptMasterySubmission,
  masterySubmissionArgs,
  scoreMasterySubmission: api.learnV2Mastery.scoreMasterySubmission,
  authorizeAssistance: api.learnV2Assistance.authorizeAssistance,
} as const

export const learnV2TodayMeasurementApi = {
  ...canonical,
  compatibility: { submitMasteryAttempt: api.learnV2Mastery.submitMasteryAttempt },
} as const

export const learnV2CanvasMeasurementApi = {
  ...canonical,
  getPostSealTeaching: api.learnV2Assessments.getPostSealTeaching,
  authorizePracticeAssistance: api.learnV2Assistance.authorizePracticeAssistance,
  compatibility: { stageResponse: api.learnAdaptiveCanvas.submitCanvasResponse, submitResponse: api.learnAdaptive.submitResponse },
} as const
