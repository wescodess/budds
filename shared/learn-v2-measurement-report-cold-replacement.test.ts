import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { Doc } from '../convex/_generated/dataModel'
import { learnReportEpisodeSnapshotSchema, reconcileLearnReportSourceRows, type LearnReportInputSnapshot } from './learn-v2-measurement-report'
import { learnIdSchema } from './learn-v2-responses'
import { measurementReportColdReplacementFixture, measurementReportNonAdmittedFixture } from '../tests/fixtures/learn-v2-measurement-report'

type Episode = z.infer<typeof learnReportEpisodeSnapshotSchema>

describe('assignment-scoped cold replacements', () => {
  it('retains original A and reserve D separately on both horizons', async () => {
    const { episode, day30, watermark } = await measurementReportColdReplacementFixture()
    expect(episode.cold?.formLabel).toBe('A')
    expect(episode.coldReplacement?.result?.formLabel).toBe('D')
    expect(day30.coldReplacement).toEqual(episode.coldReplacement)
    expect(reconcileLearnReportSourceRows([episode.learnerKey], [watermark, episode, day30])).toEqual({ status: 'complete', reasonCodes: [] })
    expectTypeOf<Episode>().toMatchTypeOf<Extract<Doc<'learnMeasurementReportRows'>['snapshot'], { kind: 'episode' }>>()
    expectTypeOf<Extract<Doc<'learnMeasurementReportRows'>['snapshot'], { kind: 'episode' }>>().toMatchTypeOf<Episode>()
  })

  it.each(['unanswered', 'unscored', 'scored'] as const)('retains an %s cold replacement', async state => {
    const { episode, day30, watermark } = await measurementReportColdReplacementFixture()
    for (const row of [episode, day30]) {
      if (state !== 'scored') row.coldReplacement!.result = null
      if (state === 'unanswered') Object.assign(row.coldReplacement!, { acceptance: null, validitySnapshot: null })
      expect(learnReportEpisodeSnapshotSchema.parse(row)).toEqual(row)
    }
    expect(reconcileLearnReportSourceRows([episode.learnerKey], [watermark, episode, day30]).status).toBe('complete')
    expect(episode.cold?.formLabel).toBe('A')
  })

  const invalid: Array<[string, (row: Episode) => void]> = [
    ['missing original cold', row => { row.coldOpportunityId = null; row.coldAcceptance = null; row.cold = null }],
    ['wrong original link', row => { row.coldReplacement!.replacesOpportunityId = learnIdSchema<'learnAssessmentOpportunities'>().parse('anotherCold') }],
    ['same original opportunity', row => { row.coldReplacement!.assessmentOpportunityId = row.coldOpportunityId! }],
    ['delayed opportunity reuse', row => { row.coldReplacement!.assessmentOpportunityId = row.originalOpportunityId! }],
    ['missing reason', row => { row.coldReplacement!.replacementReason = '' }],
    ['empty window', row => { row.coldReplacement!.closeAt = row.coldReplacement!.openAt }],
    ['left of window', row => { row.coldReplacement!.openAt = row.coldReplacement!.acceptance!.acceptedAt + 1 }],
    ['exact close edge', row => { row.coldReplacement!.closeAt = row.coldReplacement!.acceptance!.acceptedAt }],
    ['wrong endpoint kind', row => { row.coldReplacement!.result!.kind = 'measurement_delayed' }],
    ['missing acceptance', row => { row.coldReplacement!.acceptance = null }],
    ['missing validity', row => { row.coldReplacement!.validitySnapshot = null }],
    ['wrong submission', row => { row.coldReplacement!.result!.submissionId = learnIdSchema<'learnResponses'>().parse('otherSubmission') }],
    ['wrong performance time', row => { row.coldReplacement!.result!.acceptedAt++ }],
    ['ineligible acceptance credited', row => { row.coldReplacement!.validitySnapshot = { policyVersion: 'validity.v1', status: 'excluded', measurementEligible: false, masteryEligible: false, exclusionReasons: ['cold_after_teaching'] } }],
    ['reused original submission', row => { row.coldReplacement!.acceptance!.submissionId = row.coldAcceptance!.submissionId; row.coldReplacement!.result!.submissionId = row.coldAcceptance!.submissionId }],
    ['reused original attempt', row => { row.coldReplacement!.result!.attemptId = row.cold!.attemptId }],
  ]
  it.each(invalid)('rejects %s', async (_name, mutate) => {
    const { episode } = await measurementReportColdReplacementFixture()
    mutate(episode)
    expect(learnReportEpisodeSnapshotSchema.safeParse(episode).success).toBe(false)
  })

  it('retains later integrity exclusion without rewriting eligibility at acceptance', async () => {
    const { episode } = await measurementReportColdReplacementFixture()
    Object.assign(episode.coldReplacement!.result!, { measurementEligible: false, validityStatus: 'excluded', evidenceAvailable: false, exclusionReasons: ['evidence_unavailable'] })
    expect(learnReportEpisodeSnapshotSchema.parse(episode).coldReplacement?.validitySnapshot?.measurementEligible).toBe(true)
  })

  it('rejects cold replacement data on non-admitted inventory', async () => {
    const { episode } = await measurementReportNonAdmittedFixture('considered', 'blocked')
    const { episode: withReplacement } = await measurementReportColdReplacementFixture()
    expect(learnReportEpisodeSnapshotSchema.safeParse({ ...episode, coldReplacement: withReplacement.coldReplacement }).success).toBe(false)
  })

  it('rejects cross-horizon cold replacement changes', async () => {
    const { episode, day30, watermark } = await measurementReportColdReplacementFixture()
    day30.coldReplacement!.replacementReason = 'another_reason'
    expect(reconcileLearnReportSourceRows([episode.learnerKey], [watermark, episode, day30]).reasonCodes).toContain('conflicting_assignment_snapshot')
  })

  it.each(['opportunity', 'submission', 'attempt', 'execution'] as const)('binds the %s identity to its assignment', async namespace => {
    const { episode, day30, otherAssignment, watermark } = await measurementReportColdReplacementFixture()
    const copy = structuredClone(episode.coldReplacement!)
    copy.replacesOpportunityId = otherAssignment.coldOpportunityId!
    if (namespace !== 'opportunity') copy.assessmentOpportunityId = learnIdSchema<'learnAssessmentOpportunities'>().parse('otherColdReplacement')
    if (namespace !== 'submission') copy.acceptance!.submissionId = copy.result!.submissionId = learnIdSchema<'learnResponses'>().parse('otherColdReplacementSubmission')
    if (namespace !== 'attempt') copy.result!.attemptId = learnIdSchema<'masteryAttempts'>().parse('otherColdReplacementAttempt')
    if (namespace !== 'execution') copy.result!.executionId = learnIdSchema<'learnScoringExecutions'>().parse('otherColdReplacementExecution')
    otherAssignment.coldReplacement = copy
    expect(reconcileLearnReportSourceRows([episode.learnerKey], [watermark, episode, day30, otherAssignment]).reasonCodes).toContain('reused_outcome_identity')
  })

  it.each(['unanswered', 'unscored', 'scored'] as const)('forbids a claim sharing an %s cold replacement', async state => {
    const { episode, day30, claim, watermark } = await measurementReportColdReplacementFixture()
    if (state !== 'scored') for (const row of [episode, day30]) row.coldReplacement!.result = null
    if (state === 'unanswered') for (const row of [episode, day30]) Object.assign(row.coldReplacement!, { acceptance: null, validitySnapshot: null })
    claim.firstCheckOpportunityId = episode.coldReplacement!.assessmentOpportunityId
    claim.acceptance = episode.coldReplacement!.acceptance
    claim.stateAtAcceptance = claim.acceptance ? 'independent' : null
    const rows: LearnReportInputSnapshot[] = [watermark, episode, day30, claim]
    expect(reconcileLearnReportSourceRows([episode.learnerKey], rows).reasonCodes).toContain('claim_shared_cold_slot')
  })
})
