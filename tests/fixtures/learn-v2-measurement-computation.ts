import {
  deriveLearnReportComputationKeys, fingerprintLearnReportInput, learnReportEpisodeSnapshotSchema, learnReportFirstClaimSnapshotSchema, learnReportWatermarkSnapshotSchema,
  LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, type LearnReportInputSnapshot,
} from '../../shared/learn-v2-measurement-report'
import { measurementReportSourceFixture } from './learn-v2-measurement-report'

export async function computationEpisode(index: number, options: {
  owner?: number, cold?: number | null, delayed?: number | null, acceptedCold?: boolean, acceptedDelayed?: boolean,
  order?: 'ABC' | 'ACB' | 'BAC' | 'BCA' | 'CAB' | 'CBA' | 'AB' | 'BA', horizon?: 7 | 30,
} = {}) {
  const source = await measurementReportSourceFixture()
  const order = options.order ?? 'AB'
  const horizon = options.horizon ?? 7
  const both = order.length === 3
  const keys = await deriveLearnReportComputationKeys({ reportRunId: 'run1', ownerTokenIdentifier: `https://fixture.example|owner${options.owner ?? index}`,
    blueprintRevisionId: 'blueprint1', objectiveId: `objective${index}` })
  const anchorAt = source.episode.assignment.anchorAt!
  const openAt = anchorAt + horizon * 86_400_000
  const coldScore = options.cold === undefined ? 60 : options.cold
  const delayedScore = options.delayed === undefined ? 40 : options.delayed
  const coldAcceptance = (options.acceptedCold ?? coldScore !== null) ? { submissionId: `coldSubmission${index}`, acceptedAt: anchorAt } : null
  const delayedAcceptance = (options.acceptedDelayed ?? delayedScore !== null) ? { submissionId: `delayedSubmission${index}`, acceptedAt: openAt } : null
  const coldForm = order[0]!
  const delayedForm = order[both && horizon === 30 ? 2 : 1]!
  const cold = coldScore === null ? null : { ...source.cold, ...coldAcceptance, submissionId: `coldSubmission${index}`, scorePercent: coldScore,
    attemptId: `coldAttempt${index}`, executionId: `coldExecution${index}`, caseId: `case${coldForm}${index}`, itemId: `item${coldForm}${index}`,
    formLabel: coldForm, scoreCommittedAt: anchorAt + 1000 }
  const delayed = delayedScore === null ? null : { ...source.delayed, ...delayedAcceptance, submissionId: `delayedSubmission${index}`, scorePercent: delayedScore,
    attemptId: `delayedAttempt${index}`, executionId: `delayedExecution${index}`, caseId: `case${delayedForm}${index}`, itemId: `item${delayedForm}${index}`,
    formLabel: delayedForm, acceptedAt: openAt, scoreCommittedAt: openAt + 1000 }
  const episode = learnReportEpisodeSnapshotSchema.parse({ ...source.episode, ...keys, assignmentId: `assignment${index}`, objectiveId: `objective${index}`, horizonDays: horizon,
    assignment: { ...source.episode.assignment, allocationOrder: order, assignedDay7: both || horizon === 7, assignedDay30: both || horizon === 30 },
    clock: { ...source.episode.clock!, horizonDays: horizon, dueLocalDate: new Date(openAt).toISOString().slice(0, 10), dueAt: openAt, openAt, closeAt: openAt + 86_400_000 },
    coldOpportunityId: `coldOpportunity${index}`, originalOpportunityId: `delayedOpportunity${index}`, coldAcceptance, delayedAcceptance, cold, delayed,
    disposition: 'valid_scored', reasonCodes: [] })
  const otherHorizon = horizon === 7 ? 30 : 7
  const otherOpenAt = anchorAt + otherHorizon * 86_400_000
  const other = both ? learnReportEpisodeSnapshotSchema.parse({ ...episode, horizonDays: otherHorizon,
    originalOpportunityId: `otherHorizonOpportunity${index}`, delayedAcceptance: null, delayed: null,
    clock: { ...episode.clock!, horizonDays: otherHorizon, dueLocalDate: new Date(otherOpenAt).toISOString().slice(0, 10),
      openAt: otherOpenAt, dueAt: otherOpenAt, closeAt: otherOpenAt + 86_400_000 } }) : null
  const watermark = learnReportWatermarkSnapshotSchema.parse({ ...source.watermark, learnerKey: keys.learnerKey, dueWorkThrough: Date.UTC(2026, 10, 2) })
  return { ...source, keys, episode, other, watermark }
}

export async function computationClaim(index: number, options: { score?: number | null, accepted?: boolean } = {}) {
  const source = await computationEpisode(index)
  const score = options.score === undefined ? 60 : options.score
  const acceptance = (options.accepted ?? score !== null) ? { submissionId: `claimSubmission${index}`, acceptedAt: source.episode.clock!.openAt } : null
  const result = score === null ? null : { ...source.episode.delayed!, ...acceptance, submissionId: `claimSubmission${index}`, scorePercent: score,
    attemptId: `claimAttempt${index}`, executionId: `claimExecution${index}`, masteryEligible: true,
    masteryStateBefore: 'independent', masteryStateAfter: score < 80 ? 'needs_review' : 'retained' }
  const claim = learnReportFirstClaimSnapshotSchema.parse({ ...source.claim, ...source.keys,
    claim: { ...source.claim.claim, claimKey: `claim${index}`, basisAttemptId: `ordinaryBasis${index}` },
    firstCheckOpportunityId: `firstOpportunity${index}`, acceptance, result, stateAtAcceptance: acceptance ? 'independent' : null,
    unresolvedReason: score === null ? acceptance ? 'scoring_pending' : 'missing_delayed' : null })
  return { ...source, claim }
}

export async function computationInput(rows: readonly LearnReportInputSnapshot[], cutoff = Date.UTC(2026, 10, 2), roster?: string[]) {
  const owners = roster ?? [...new Set(rows.map(row => row.learnerKey))]
  const fingerprint = await fingerprintLearnReportInput(owners, rows)
  return { reportRunId: 'run1', roster: owners, rows,
    query: { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, cohortVersion: 'cohort.v1', epoch: 'epoch.v1', protocolVersion: 'protocol.v1',
      enrollmentStartAt: Date.UTC(2026, 8, 30), enrollmentEndAt: Date.UTC(2026, 9, 1), cutoff },
    provenance: { kind: 'aggregate_snapshot' as const, sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
      queryVersion: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, adapterVersion: 'fixture.v1', codeVersion: 'fixture.v1', cutoff,
      extractionStartedAt: cutoff, extractionEndedAt: cutoff, sourceCoverage: 'complete' as const, bootstrapReplicates: 10_000 as const, ...fingerprint } }
}
