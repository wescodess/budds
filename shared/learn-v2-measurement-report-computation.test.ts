import { describe, expect, it } from 'vitest'
import {
  buildLearningMeasurementReport, reconcileLearnReportSourceRows, rollUpLearnReportLegacyAudit,
  learnReportEpisodeSnapshotSchema, learnReportFirstClaimSnapshotSchema, validateLearnMeasurementReportCells, type LearnReportMetric,
} from './learn-v2-measurement-report'
import { computationClaim, computationEpisode, computationInput } from '../tests/fixtures/learn-v2-measurement-computation'
import { emptyMeasurementReportCell, measurementReportColdReplacementFixture, measurementReportIdentityFixture, measurementReportNonAdmittedFixture } from '../tests/fixtures/learn-v2-measurement-report'

function cell(result: Awaited<ReturnType<typeof buildLearningMeasurementReport>>, metric: LearnReportMetric['metric'] = 'verified_learning_gain.v1', horizon = 7) {
  expect(result.report).toMatchObject({ status: 'sealed' })
  const found = result.pages.flatMap(page => page.cells).find(value => value.metric === metric && value.horizonDays === horizon
    && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')
  expect(found).toBeDefined()
  return found!
}

describe('versioned report computation', () => {
  it('reproduces the independent −20 and missing-cold-40 oracle', async () => {
    const paired = await computationEpisode(1)
    const missing = await computationEpisode(2, { cold: 40, delayed: null })
    const result = await buildLearningMeasurementReport(await computationInput([paired.watermark, paired.episode, missing.watermark, missing.episode]))
    const report = cell(result)
    // (40−60) = −20; missing delayed with cold 40 contributes [−40,60].
    // Bounds: [(−20−40)/2,(−20+60)/2] = [−30,20]; no all-eligible point.
    expect(report.observedValue).toBe(-20)
    expect(report.allEligibleValue).toBeNull()
    expect(report.missingOutcomeBounds).toEqual({ lower: -30, upper: 20 })
    expect(report.counts).toMatchObject({ considered: 2, maturedEpisodes: 2, operationallyEligible: 2, acceptedSubmissions: 1,
      validDelayedScores: 1, validColdScores: 2, comparablePairs: 1, acceptedColdSubmissions: 2 })
    expect(report.counts.distinctLearners).toMatchObject({ maturedEpisodes: 2, validColdScores: 2, comparablePairs: 1 })
    expect(report.counts.dispositions).toMatchObject({ valid_scored: 1, missing_delayed: 1 })
  })

  it('requires every assigned horizon before computing any cell', async () => {
    const { episode, day30, watermark } = await measurementReportIdentityFixture(true)
    expect(reconcileLearnReportSourceRows([episode.learnerKey], [watermark, episode])).toEqual({ status: 'incomplete', reasonCodes: ['incomplete_assignment_horizons'] })
    expect(reconcileLearnReportSourceRows([episode.learnerKey], [watermark, day30])).toEqual({ status: 'incomplete', reasonCodes: ['incomplete_assignment_horizons'] })
    expect(reconcileLearnReportSourceRows([episode.learnerKey], [day30, watermark, episode]).status).toBe('complete')
    const result = await buildLearningMeasurementReport(await computationInput([watermark, episode]))
    expect(result).toMatchObject({ report: { status: 'failed', reasonCodes: ['incomplete_assignment_horizons'] }, pages: [] })
  })

  it('rejects a differing third cell on a page', () => {
    const first = emptyMeasurementReportCell()
    const third = emptyMeasurementReportCell()
    third.legacyIndependentAudit.unknownCount = 1
    expect(() => validateLearnMeasurementReportCells({ version: 'learn-v2.measurement-report.v3', reportRunId: 'run1',
      cells: [first, first, third], cursor: null, isDone: true })).toThrow()
  })

  it('sums only roster audits and makes missing, unknown or overflowing audits unknown', async () => {
    const a = await computationEpisode(1)
    const b = await computationEpisode(2)
    const outside = await computationEpisode(3)
    a.watermark.legacyIndependentAudit.unknownCount = 3
    b.watermark.legacyIndependentAudit.unknownCount = 4
    outside.watermark.legacyIndependentAudit.unknownCount = 9999
    const roster = [a.keys.learnerKey, b.keys.learnerKey]
    expect(rollUpLearnReportLegacyAudit(roster, [a.watermark, b.watermark, outside.watermark])).toEqual({ unknownCount: 7, sourceCoverage: 'complete' })
    expect(rollUpLearnReportLegacyAudit(roster, [a.watermark])).toEqual({ unknownCount: null, sourceCoverage: 'unknown' })
    b.watermark.legacyIndependentAudit = { unknownCount: null, sourceCoverage: 'unknown' }
    expect(rollUpLearnReportLegacyAudit(roster, [a.watermark, b.watermark])).toEqual({ unknownCount: null, sourceCoverage: 'unknown' })
    b.watermark.historyCoverage = 'unknown'
    expect(rollUpLearnReportLegacyAudit(roster, [a.watermark, b.watermark]).unknownCount).toBeNull()
    b.watermark.historyCoverage = 'complete'
    b.watermark.legacyIndependentAudit = { unknownCount: 9998, sourceCoverage: 'complete' }
    expect(rollUpLearnReportLegacyAudit(roster, [a.watermark, b.watermark]).unknownCount).toBeNull()
  })

  it('computes first-check failure, checked coverage and all-claim bounds from fixed slots', async () => {
    const failure = await computationClaim(1, { score: 60 })
    const missed = await computationClaim(2, { score: null })
    const result = await buildLearningMeasurementReport(await computationInput([failure.watermark, failure.claim, missed.watermark, missed.claim]))
    const report = cell(result, 'false_mastery_next_delayed.v1')
    // N=2, M=1, F=1: observed F/M=1; M/N=1/2; F/N=1/2; bounds [1/2,1].
    expect(report.counts).toMatchObject({ maturedClaims: 2, checkedClaims: 1, failedClaims: 1, acceptedClaims: 1 })
    expect(report.observedValue).toBe(1)
    expect(report.allEligibleValue).toBeNull()
    expect(report.missingOutcomeBounds).toEqual({ lower: 0.5, upper: 1 })
    expect(report.counts.checkedClaims / report.counts.maturedClaims).toBe(0.5)
    expect(report.counts.failedClaims / report.counts.maturedClaims).toBe(0.5)
  })

  it('repeats distinct assignment admission inventory and ignores non-admitted placeholder dispositions', async () => {
    const admitted = await computationEpisode(1)
    const { episode: candidate } = await measurementReportNonAdmittedFixture('considered', 'protocol_not_frozen')
    const inventory = learnReportEpisodeSnapshotSchema.parse({ ...candidate, ...admitted.keys, assignmentId: 'candidateAssignment', disposition: 'valid_scored' })
    const report = cell(await buildLearningMeasurementReport(await computationInput([admitted.watermark, admitted.episode, inventory])))
    expect(report.counts).toMatchObject({ considered: 2, notAdmitted: 1, maturedEpisodes: 1, dispositions: { valid_scored: 1 } })
    expect(report.sourceAccounting.population).toBe(2)
  })

  it('retains missing cold and non-returners in E with separate S/A/C/P counts', async () => {
    const a = await computationEpisode(1)
    const b = await computationEpisode(2, { cold: null, delayed: 80 })
    const c = await computationEpisode(3, { cold: 40, delayed: null })
    const report = cell(await buildLearningMeasurementReport(await computationInput([a.watermark, a.episode, b.watermark, b.episode, c.watermark, c.episode])))
    // One −20 pair, one [−100,100], one [−40,60]: bounds [−160/3,140/3].
    expect(report.counts).toMatchObject({ maturedEpisodes: 3, acceptedSubmissions: 2, validDelayedScores: 2, validColdScores: 2, comparablePairs: 1 })
    expect(report.observedValue).toBe(-20)
    expect(report.allEligibleValue).toBeNull()
    expect(report.missingOutcomeBounds).toEqual({ lower: -160 / 3, upper: 140 / 3 })
  })

  it('keeps a complete negative gain and day-30 performance below Independent', async () => {
    const negative = await computationEpisode(1)
    const negativeReport = cell(await buildLearningMeasurementReport(await computationInput([negative.watermark, negative.episode])))
    expect(negativeReport).toMatchObject({ observedValue: -20, allEligibleValue: -20, missingOutcomeBounds: { lower: -20, upper: -20 } })
    const day30 = await computationEpisode(2, { horizon: 30, cold: 40, delayed: 60 })
    expect(day30.episode.delayed).toMatchObject({ masteryEligible: false, masteryStateBefore: 'unseen', masteryStateAfter: 'unseen' })
    const result = await buildLearningMeasurementReport(await computationInput([day30.watermark, day30.episode]))
    expect(cell(result, 'verified_learning_gain.v1', 30)).toMatchObject({ observedValue: 20, allEligibleValue: 20, counts: { maturedEpisodes: 1, comparablePairs: 1 } })
    expect(result.pages.flatMap(page => page.cells).some(value => value.metric === 'false_mastery_next_delayed.v1')).toBe(false)
  })

  it('retains unscored cold, delayed and first-slot acceptance without score credit', async () => {
    const cold = await computationEpisode(1, { cold: null, acceptedCold: true, delayed: 80 })
    const delayed = await computationEpisode(2, { delayed: null, acceptedDelayed: true })
    const report = cell(await buildLearningMeasurementReport(await computationInput([cold.watermark, cold.episode, delayed.watermark, delayed.episode])))
    expect(report.counts).toMatchObject({ maturedEpisodes: 2, acceptedColdSubmissions: 2, acceptedSubmissions: 2, validColdScores: 1, validDelayedScores: 1, comparablePairs: 0 })
    expect(report.counts.dispositions.scoring_pending).toBe(2)
    expect(report.observedValue).toBeNull()
    expect(report.missingOutcomeBounds).toEqual({ lower: -80, upper: 70 }) // ([−100,100]+[−60,40])/2.
    const claim = await computationClaim(3, { score: null, accepted: true })
    const audit = cell(await buildLearningMeasurementReport(await computationInput([claim.watermark, claim.claim])), 'false_mastery_next_delayed.v1')
    expect(audit.counts).toMatchObject({ maturedClaims: 1, acceptedClaims: 1, checkedClaims: 0, failedClaims: 0 })
    expect(audit.observedValue).toBeNull()
    expect(audit.missingOutcomeBounds).toEqual({ lower: 0, upper: 1 })
  })

  it('uses acceptedAt at a 23-hour DST window, with late scoring and half-open edges', async () => {
    const source = await computationEpisode(1)
    const anchorAt = Date.parse('2026-03-01T05:00:00Z')
    const openAt = Date.parse('2026-03-08T05:00:00Z')
    const closeAt = Date.parse('2026-03-09T04:00:00Z')
    expect(closeAt - openAt).toBe(23 * 3_600_000)
    const episode = learnReportEpisodeSnapshotSchema.parse({ ...source.episode,
      assignment: { ...source.episode.assignment, anchorAt, enrollmentAt: anchorAt - 1, timezone: 'America/Toronto' },
      clock: { ...source.episode.clock!, anchorAt, timezone: 'America/Toronto', dueLocalDate: '2026-03-08', dueAt: openAt, openAt, closeAt },
      coldAcceptance: { ...source.episode.coldAcceptance!, acceptedAt: anchorAt }, cold: { ...source.episode.cold!, acceptedAt: anchorAt, scoreCommittedAt: anchorAt + 1000 },
      delayedAcceptance: { ...source.episode.delayedAcceptance!, acceptedAt: closeAt - 1 },
      delayed: { ...source.episode.delayed!, acceptedAt: closeAt - 1, scoreCommittedAt: closeAt + 1000 } })
    const cutoff = closeAt + 2000
    const run = async () => {
      const input = await computationInput([{ ...source.watermark, dueWorkThrough: cutoff }, episode], cutoff)
      input.query.enrollmentStartAt = anchorAt - 86_400_000
      input.query.enrollmentEndAt = anchorAt
      return buildLearningMeasurementReport(input)
    }
    expect(cell(await run()).allEligibleValue).toBe(-20)
    Object.assign(episode.delayedAcceptance!, { acceptedAt: openAt })
    Object.assign(episode.delayed!, { acceptedAt: openAt })
    expect(cell(await run()).allEligibleValue).toBe(-20)
    Object.assign(episode.delayedAcceptance!, { acceptedAt: closeAt })
    Object.assign(episode.delayed!, { acceptedAt: closeAt })
    expect(cell(await run())).toMatchObject({ observedValue: null, allEligibleValue: null, counts: { acceptedSubmissions: 1, validDelayedScores: 0, comparablePairs: 0 },
      missingOutcomeBounds: { lower: -60, upper: 40 } })
    episode.assignment.enrollmentAt = anchorAt
    expect((await run()).report).toMatchObject({ status: 'failed', reasonCodes: ['enrollment_outside_window'] })
  })

  it('retains all six persisted orders and assigned versus observed form counts', async () => {
    const orders = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'] as const
    const sources = await Promise.all(orders.map((order, index) => computationEpisode(index + 1, { order })))
    const result = await buildLearningMeasurementReport(await computationInput(sources.flatMap(source => [source.watermark, source.episode, source.other!])))
    const day7 = cell(result)
    expect(day7.allEligibleValue).toBe(-20)
    expect(day7.counts).toMatchObject({ considered: 6, maturedEpisodes: 6, comparablePairs: 6 })
    for (const order of orders) {
      expect(day7.allocations.assignedOrders[order]).toBe(1)
      expect(day7.allocations.observedOrders[order]).toBe(1)
    }
    expect(day7.allocations.assignedColdForms).toMatchObject({ A: 2, B: 2, C: 2 })
    expect(day7.allocations.observedDelayedForms).toMatchObject({ A: 2, B: 2, C: 2 })
    const day30 = cell(result, 'verified_learning_gain.v1', 30)
    expect(day30.counts).toMatchObject({ considered: 6, maturedEpisodes: 6, acceptedSubmissions: 0, validColdScores: 6 })
    expect(day30.observedValue).toBeNull()
  })

  it.each(['scorer', 'treatment', 'family'] as const)('keeps an incompatible %s episode enrolled without a pair', async mismatch => {
    const source = await computationEpisode(1)
    if (mismatch === 'scorer') source.episode.delayed!.configurationDigest = `sha256:${'b'.repeat(64)}`
    if (mismatch === 'treatment') source.episode.treatmentEpochChanged = true
    if (mismatch === 'family') source.episode.delayed!.familyRevision = 2
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode])))
    expect(report.counts.maturedEpisodes).toBe(1)
    expect(report.counts.comparablePairs).toBe(0)
    expect(report.observedValue).toBeNull()
    expect(report.allEligibleValue).toBeNull()
  })

  it('rejects mixed epochs instead of pooling them', async () => {
    const source = await computationEpisode(1)
    source.episode.assignment.epoch = 'other.epoch'
    expect((await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode]))).report).toMatchObject({ status: 'failed', reasonCodes: ['incompatible_epoch'] })
  })

  it.each(['cold', 'delayed'] as const)('retains %s evidence purge as attrition rather than a zero', async endpoint => {
    const source = await computationEpisode(1)
    Object.assign(source.episode[endpoint]!, { evidenceAvailable: false, validityStatus: 'excluded', measurementEligible: false, exclusionReasons: ['evidence_unavailable'] })
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode])))
    expect(report.counts).toMatchObject({ maturedEpisodes: 1, acceptedColdSubmissions: 1, acceptedSubmissions: 1, comparablePairs: 0 })
    expect(report.counts.dispositions.evidence_unavailable).toBe(1)
    expect(report.sourceAccounting.purgedEvidence.affected).toBe(1)
    expect(report.observedValue).toBeNull()
    expect(report.missingOutcomeBounds).toEqual(endpoint === 'cold' ? { lower: -100, upper: 100 } : { lower: -60, upper: 40 })
  })

  it('retains a permitted immutable outcome after body loss', async () => {
    const source = await computationEpisode(1)
    source.episode.reasonCodes = ['body_purged']
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode])))
    expect(report.allEligibleValue).toBe(-20)
    expect(report.counts.comparablePairs).toBe(1)
  })

  it('preserves primary results with paste/focus flags and reports the separate exclusion sensitivity', async () => {
    const flagged = await computationEpisode(1, { cold: 60, delayed: 40 })
    const unflagged = await computationEpisode(2, { cold: 40, delayed: 60 })
    Object.assign(flagged.episode.delayed!, { pasteObserved: true, focusLossObserved: true })
    const report = cell(await buildLearningMeasurementReport(await computationInput([flagged.watermark, flagged.episode, unflagged.watermark, unflagged.episode])))
    expect(report).toMatchObject({ observedValue: 0, allEligibleValue: 0, counts: { comparablePairs: 2 },
      instrumentation: { pasteFlagged: 1, focusFlagged: 1, eitherFlagged: 1, unknownUnflagged: 1 },
      sensitivity: { excludingFlagged: { population: 1, observed: 1, observedValue: 20, allEligibleValue: 20 } } })
  })

  it('weights learners separately while keeping each learner’s full missing-outcome inventory', async () => {
    const a = await computationEpisode(1, { owner: 1, cold: 40, delayed: 40 })
    const b = await computationEpisode(2, { owner: 1, cold: 40, delayed: 60 })
    const missing = await computationEpisode(3, { owner: 1, cold: 40, delayed: null })
    const c = await computationEpisode(4, { owner: 2, cold: 40, delayed: 20 })
    const result = await buildLearningMeasurementReport(await computationInput([a.watermark, a.episode, b.episode, missing.episode, c.watermark, c.episode]))
    const primary = cell(result)
    const learner = result.pages.flatMap(page => page.cells).find(value => value.metric === 'verified_learning_gain.v1' && value.horizonDays === 7
      && value.stratum.startingBand === 'all' && value.weighting === 'learner_sensitivity')!
    // Episodes: (0+20−20)/3=0. Learners: ((0+20)/2−20)/2=−5.
    // Learner bounds: [((0+20−40)/3−20)/2,((0+20+60)/3−20)/2].
    expect(primary.observedValue).toBe(0)
    expect(primary.missingOutcomeBounds).toEqual({ lower: -10, upper: 15 })
    expect(learner.observedValue).toBe(-5)
    expect(learner.missingOutcomeBounds?.lower).toBeCloseTo(-40 / 3)
    expect(learner.missingOutcomeBounds?.upper).toBeCloseTo(10 / 3)
    expect(learner.counts.distinctLearners.comparablePairs).toBe(2)
    expect(learner.allEligibleValue).toBeNull()
  })

  it('replays the seeded 10,000-replicate learner-cluster bootstrap deterministically', async () => {
    const sources = await Promise.all(Array.from({ length: 20 }, (_, index) => computationEpisode(index + 1, { cold: 50, delayed: index % 2 ? 70 : 30 })))
    const rows = sources.flatMap(source => [source.watermark, source.episode])
    const first = await buildLearningMeasurementReport(await computationInput(rows))
    const second = await buildLearningMeasurementReport(await computationInput([...rows].reverse()))
    expect(second).toEqual(first)
    const report = cell(first)
    expect(report.precision).toBe('available')
    expect(report.observedValue).toBe(0)
    // 20 equally weighted learners at ±20: central Binomial(20,1/2) counts 6..14 give −8..8.
    expect(report.confidenceInterval).toEqual({ lower: -8, upper: 8 })
  })

  it.each([19, 20])('returns null precision for %s sparse or degenerate learners', async size => {
    const sources = await Promise.all(Array.from({ length: size }, (_, index) => computationEpisode(index + 1)))
    const report = cell(await buildLearningMeasurementReport(await computationInput(sources.flatMap(source => [source.watermark, source.episode]))))
    expect(report.observedValue).toBe(-20)
    expect(report.precision).toBe(size === 19 ? 'insufficient_clusters' : 'insufficient_variation')
    expect(report.confidenceInterval).toBeNull()
  })

  it.each([60, 100])('gives all-fail/all-pass first-check samples null precision at score %s', async score => {
    const sources = await Promise.all(Array.from({ length: 20 }, (_, index) => computationClaim(index + 1, { score })))
    const report = cell(await buildLearningMeasurementReport(await computationInput(sources.flatMap(source => [source.watermark, source.claim]))), 'false_mastery_next_delayed.v1')
    expect(report).toMatchObject({ observedValue: score < 80 ? 1 : 0, allEligibleValue: score < 80 ? 1 : 0, precision: 'insufficient_variation', confidenceInterval: null })
  })

  it('repeats one run-level audit across at least three cell pages', async () => {
    const sources = await Promise.all([1, 2, 3].map(index => computationEpisode(index)))
    sources.forEach((source, index) => {
      source.episode.assignment.entryPoint = `entry${index}`
      source.watermark.legacyIndependentAudit.unknownCount = index + 1
    })
    const result = await buildLearningMeasurementReport(await computationInput(sources.flatMap(source => [source.watermark, source.episode])))
    expect(result.pages.length).toBeGreaterThanOrEqual(3)
    for (const page of result.pages) for (const value of page.cells) expect(value.legacyIndependentAudit).toEqual({ unknownCount: 6, sourceCoverage: 'complete' })
    sources[1]!.watermark.legacyIndependentAudit = { unknownCount: null, sourceCoverage: 'unknown' }
    const unknown = await buildLearningMeasurementReport(await computationInput(sources.flatMap(source => [source.watermark, source.episode])))
    for (const page of unknown.pages) for (const value of page.cells) expect(value.legacyIndependentAudit).toEqual({ unknownCount: null, sourceCoverage: 'unknown' })
  })

  it.each(['anchor', 'future', 'open', 'unknown', 'quarantined'] as const)('keeps explicit %s states', async state => {
    const source = await computationEpisode(1)
    if (state === 'anchor') { source.episode.assignment.anchorAt = null; source.episode.clock = null }
    if (state === 'unknown') source.watermark.dueWorkThrough = null
    if (state === 'quarantined') source.episode.assignment.familyValidationStatus = 'quarantined'
    const cutoff = state === 'future' ? source.episode.clock!.openAt - 1 : state === 'open' ? source.episode.clock!.openAt : undefined
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode], cutoff)))
    const expected = { anchor: 'anchor_not_started', future: 'not_yet_due', open: 'not_yet_due', unknown: 'unknown_source_coverage', quarantined: 'quarantined' }
    expect(report.status).toBe(expected[state])
    expect(report.allEligibleValue).toBeNull()
    if (state === 'unknown') expect(report.missingOutcomeBounds).toBeNull()
  })

  it('reports non-admission and unfrozen protocol without inventing a response/scorer stratum', async () => {
    const { episode, watermark } = await measurementReportNonAdmittedFixture('considered', 'protocol_not_frozen')
    expect(await buildLearningMeasurementReport(await computationInput([watermark, episode]))).toMatchObject({
      report: { status: 'unavailable', reasonCodes: ['not_admitted', 'protocol_not_frozen'] }, pages: [],
    })
  })

  it.each(['secondary_only', 'predeclared'] as const)('retains cold A→D under the %s policy', async policy => {
    const source = await measurementReportColdReplacementFixture()
    source.watermark.dueWorkThrough = Date.UTC(2026, 10, 2)
    if (policy === 'predeclared') for (const row of [source.episode, source.day30]) row.replacementPolicy = {
      kind: 'predeclared', protocolVersion: 'protocol.v1', ruleVersion: 'replacement.v1', ruleDigest: `sha256:${'c'.repeat(64)}`,
    }
    // Remove the independent delayed replacement; this case isolates original cold A → reserve D.
    for (const row of [source.episode, source.day30]) Object.assign(row, { replacementOpportunityId: null, replacementClock: null, replacementAcceptance: null, replacement: null, disposition: 'valid_scored', reasonCodes: [] })
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode, source.day30])))
    // A=60 is excluded; reserve D=20 and delayed B=40 give a separately identified +20 pair.
    expect(source.episode.cold).toMatchObject({ scorePercent: 60, formLabel: 'A', measurementEligible: false })
    expect(report.replacements).toMatchObject({ withLinkedReplacement: 1, withAcceptedReplacement: 1, withValidReplacement: 1,
      withComparableReplacement: 1, primaryIncludedPairs: policy === 'predeclared' ? 1 : 0, secondary: { observedValue: 20, allEligibleValue: 20 } })
    expect(report.observedValue).toBe(policy === 'predeclared' ? 20 : null)
    expect(report.allEligibleValue).toBe(policy === 'predeclared' ? 20 : null)
  })

  it('does not replace a failed first slot with a retry or day-30 pass', async () => {
    const source = await measurementReportIdentityFixture(true)
    source.watermark.dueWorkThrough = Date.UTC(2026, 10, 2)
    Object.assign(source.episode.delayed!, { masteryEligible: true, masteryStateBefore: 'independent', masteryStateAfter: 'needs_review' })
    Object.assign(source.episode.replacement!, { scorePercent: 100, masteryEligible: true })
    Object.assign(source.day30.delayed!, { scorePercent: 100 })
    const claim = learnReportFirstClaimSnapshotSchema.parse({ ...source.claim, result: source.episode.delayed, unresolvedReason: null })
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode, source.day30, claim])), 'false_mastery_next_delayed.v1')
    expect(report).toMatchObject({ observedValue: 1, allEligibleValue: 1, counts: { maturedClaims: 1, checkedClaims: 1, failedClaims: 1 } })
    expect(report.replacements.primaryIncludedPairs).toBe(0)
  })

  it.each(['missed', 'contaminated', 'unscored'] as const)('keeps a %s first slot unresolved despite a later pass', async state => {
    const source = await measurementReportIdentityFixture(true)
    source.watermark.dueWorkThrough = Date.UTC(2026, 10, 2)
    Object.assign(source.episode.replacement!, { scorePercent: 100 })
    Object.assign(source.day30.delayed!, { scorePercent: 100 })
    source.episode.delayed = state === 'contaminated' ? { ...source.episode.delayed!, assistanceState: 'assisted', masteryEligible: false, measurementEligible: false,
      validityStatus: 'excluded', exclusionReasons: ['assisted'] } : null
    if (state === 'missed') source.episode.delayedAcceptance = null
    const claim = learnReportFirstClaimSnapshotSchema.parse({ ...source.claim, acceptance: source.episode.delayedAcceptance,
      stateAtAcceptance: state === 'missed' ? null : 'independent', result: source.episode.delayed,
      unresolvedReason: state === 'contaminated' ? 'assisted_contaminated' : state === 'unscored' ? 'scoring_pending' : 'missing_delayed' })
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode, source.day30, claim])), 'false_mastery_next_delayed.v1')
    expect(report).toMatchObject({ observedValue: null, allEligibleValue: null, counts: { maturedClaims: 1, checkedClaims: 0, failedClaims: 0 }, missingOutcomeBounds: { lower: 0, upper: 1 } })
  })

  it('keeps entry/flow, response kind, depth, family validation and scorer strata separate', async () => {
    const deterministic = await computationEpisode(1)
    const model = await computationEpisode(2, { cold: 40, delayed: 60 })
    Object.assign(model.episode.assignment, { flow: 'v2_canvas', entryPoint: 'canvas.v1', depth: 'advanced', responseKind: 'bounded_rubric',
      familyValidationStatus: 'empirically_supported', scorerConfiguration: { scoringKind: 'model', configurationDigest: `sha256:${'b'.repeat(64)}`, scorerVersion: 'model.v1' } })
    for (const result of [model.episode.cold!, model.episode.delayed!]) Object.assign(result, { ...model.episode.assignment.scorerConfiguration,
      identityStatus: 'verified', observedModel: 'pinned-model', observedUpstream: 'pinned-upstream' })
    const result = await buildLearningMeasurementReport(await computationInput([deterministic.watermark, deterministic.episode, model.watermark, model.episode]))
    const strata = result.pages.flatMap(page => page.cells).filter(value => value.metric === 'verified_learning_gain.v1' && value.horizonDays === 7
      && value.weighting === 'capability_episode' && value.stratum.startingBand === 'all')
    expect(strata).toHaveLength(2)
    expect(strata.find(value => value.stratum.flow === 'v2_today')).toMatchObject({ observedValue: -20, counts: { maturedEpisodes: 1 }, stratum: { responseKind: 'keyed', scoringKind: 'deterministic' } })
    expect(strata.find(value => value.stratum.flow === 'v2_canvas')).toMatchObject({ observedValue: 20, counts: { maturedEpisodes: 1 },
      stratum: { responseKind: 'bounded_rubric', scoringKind: 'model', depth: 'advanced', observedModel: 'pinned-model', familyValidationStatus: 'empirically_supported' }, validity: 'provisional' })
  })

  it('resamples whole learners, retaining all their episodes', async () => {
    const sources = await Promise.all(Array.from({ length: 40 }, (_, index) => computationEpisode(index + 1,
      { owner: Math.floor(index / 2), cold: 50, delayed: index % 2 ? 70 : 30 })))
    const watermarks = [...new Map(sources.map(source => [source.watermark.learnerKey, source.watermark])).values()]
    const report = cell(await buildLearningMeasurementReport(await computationInput([...watermarks, ...sources.map(source => source.episode)])))
    // Every one of 20 learners contributes (−20,+20). Each cluster mean and every cluster resample is zero.
    expect(report).toMatchObject({ observedValue: 0, precision: 'insufficient_variation', confidenceInterval: null,
      counts: { comparablePairs: 40, distinctLearners: { comparablePairs: 20 } } })
  })

  it.each([60, 100])('keeps a %s delayed reserve secondary and matures it at its own close', async score => {
    const source = await measurementReportIdentityFixture()
    source.watermark.dueWorkThrough = Date.UTC(2026, 10, 2)
    source.episode.disposition = 'valid_scored'
    source.episode.reasonCodes = []
    source.episode.replacement!.scorePercent = score
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode])))
    // Original 60→40 remains −20; the reserve is respectively 60→60=0 or 60→100=40.
    expect(report.observedValue).toBe(-20)
    expect(report.replacements).toMatchObject({ primaryIncludedPairs: 0, withLinkedReplacement: 1, withComparableReplacement: 1, secondary: { observedValue: score - 60 } })
    const cutoff = source.episode.clock!.closeAt + 2000
    const early = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode], cutoff)))
    expect(early.observedValue).toBe(-20)
    expect(early.replacements).toMatchObject({ withAcceptedReplacement: 1, withComparableReplacement: 0, secondary: { observedValue: null } })
  })

  it('keeps frozen original exclusions and operational admission separate', async () => {
    const source = await computationEpisode(1)
    source.episode.operationalEligibility = 'blocked'
    source.episode.disposition = 'access_provider_blocked'
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode])))
    expect(report.counts).toMatchObject({ maturedEpisodes: 1, operationallyEligible: 0, acceptedSubmissions: 1, comparablePairs: 0,
      dispositions: { access_provider_blocked: 1 } })
    expect(report.allEligibleValue).toBeNull()
  })

  it('rejects changed sealed inputs and duplicate rows without publishing cells', async () => {
    const source = await computationEpisode(1)
    const input = await computationInput([source.watermark, source.episode])
    source.episode.delayed!.scorePercent = 100
    expect(await buildLearningMeasurementReport(input)).toMatchObject({ report: { status: 'failed', reasonCodes: ['input_manifest_mismatch'] }, pages: [] })
    expect(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode, source.episode]))).toMatchObject({
      report: { status: 'failed', reasonCodes: ['duplicate_source_row'] }, pages: [],
    })
  })

  it('publishes aggregates without computation keys or individual outcome identities', async () => {
    const source = await computationEpisode(1)
    const result = await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode]))
    const output = JSON.stringify(result)
    for (const secret of [source.keys.learnerKey, source.keys.capabilityKey, source.episode.assignmentId, source.episode.cold!.submissionId,
      source.episode.delayed!.attemptId, source.episode.delayed!.executionId]) expect(output).not.toContain(secret)
  })

  it('keeps unanswered model-scored first checks in the same frozen denominator', async () => {
    const observed = await computationClaim(1)
    const missed = await computationClaim(2, { score: null })
    const configuration = { scoringKind: 'model' as const, configurationDigest: `sha256:${'b'.repeat(64)}`, scorerVersion: 'model.v1' }
    for (const source of [observed, missed]) source.claim.stratum.scorerConfiguration = configuration
    Object.assign(observed.claim.result!, { ...configuration, identityStatus: 'verified', observedModel: 'pinned-model', observedUpstream: 'pinned-upstream' })
    const report = cell(await buildLearningMeasurementReport(await computationInput([observed.watermark, observed.claim, missed.watermark, missed.claim])), 'false_mastery_next_delayed.v1')
    expect(report).toMatchObject({ observedValue: 1, allEligibleValue: null, counts: { maturedClaims: 2, checkedClaims: 1, failedClaims: 1 },
      missingOutcomeBounds: { lower: 0.5, upper: 1 }, stratum: { observedModel: 'pinned-model' } })
  })

  it('keeps changed observed scorer identities separate without complete-population claims', async () => {
    const a = await computationEpisode(1)
    const b = await computationEpisode(2, { cold: 40, delayed: 60 })
    const configuration = { scoringKind: 'model' as const, configurationDigest: `sha256:${'b'.repeat(64)}`, scorerVersion: 'model.v1' }
    for (const [index, source] of [a, b].entries()) {
      source.episode.assignment.scorerConfiguration = configuration
      for (const result of [source.episode.cold!, source.episode.delayed!]) Object.assign(result, { ...configuration,
        identityStatus: 'verified', observedModel: `model${index}`, observedUpstream: 'upstream' })
    }
    const result = await buildLearningMeasurementReport(await computationInput([a.watermark, a.episode, b.watermark, b.episode]))
    const strata = result.pages.flatMap(page => page.cells).filter(value => value.metric === 'verified_learning_gain.v1' && value.horizonDays === 7
      && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')
    expect(strata).toHaveLength(2)
    expect(strata.map(value => value.observedValue).sort((a, b) => a! - b!)).toEqual([-20, 20])
    for (const value of strata) expect(value).toMatchObject({ status: 'unknown_source_coverage', populationState: 'unknown', allEligibleValue: null,
      missingOutcomeBounds: null, confidenceInterval: null })
  })

  it('uses seven local dates for the first check instead of a 168-hour minimum', async () => {
    const source = await computationClaim(1)
    const anchorAt = Date.parse('2026-03-02T04:30:00Z') // March 1, 23:30 Toronto.
    const openAt = Date.parse('2026-03-08T05:30:00Z') // March 8, 00:30 Toronto, seven local dates later.
    const closeAt = Date.parse('2026-03-09T04:00:00Z')
    expect(openAt - anchorAt).toBeLessThan(168 * 3_600_000)
    const claim = learnReportFirstClaimSnapshotSchema.parse({ ...source.claim,
      claim: { ...source.claim.claim, firstIndependentAt: anchorAt, firstIndependentLocalDate: '2026-03-01', firstIndependentTimezone: 'America/Toronto' },
      clock: { ...source.claim.clock, anchorAt, timezone: 'America/Toronto', dueLocalDate: '2026-03-08', dueAt: openAt, openAt, closeAt },
      acceptance: { ...source.claim.acceptance!, acceptedAt: openAt }, result: { ...source.claim.result!, acceptedAt: openAt, scoreCommittedAt: openAt + 1000 } })
    const input = await computationInput([{ ...source.watermark, dueWorkThrough: closeAt }, claim], closeAt)
    input.query.enrollmentStartAt = anchorAt - 86_400_000
    input.query.enrollmentEndAt = anchorAt
    expect(cell(await buildLearningMeasurementReport(input), 'false_mastery_next_delayed.v1')).toMatchObject({ observedValue: 1, allEligibleValue: 1 })
  })

  it('excludes unknown novelty history and rejects contradictory admission pins', async () => {
    const source = await computationEpisode(1)
    source.episode.assignment.historyStatus = 'unknown'
    const report = cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode])))
    expect(report).toMatchObject({ status: 'unknown_source_coverage', observedValue: null, allEligibleValue: null, counts: { maturedEpisodes: 1, comparablePairs: 0 } })
    source.episode.assignment.historyStatus = 'prospectively_unexposed'
    source.episode.reasonCodes = ['unmeasurable_no_t0']
    expect((await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode]))).report).toMatchObject({ status: 'failed', reasonCodes: ['conflicting_admission_pins'] })
  })

  it('rejects two frozen scorer versions claiming the same configuration digest', async () => {
    const a = await computationEpisode(1)
    const b = await computationEpisode(2)
    b.episode.assignment.scorerConfiguration!.scorerVersion = 'another-engine.v2'
    expect((await buildLearningMeasurementReport(await computationInput([a.watermark, a.episode, b.watermark, b.episode]))).report).toMatchObject({
      status: 'failed', reasonCodes: ['conflicting_scorer_configuration'],
    })
  })

  it('keeps a not-yet-due first check null and treats denied help as non-assistance', async () => {
    const claim = await computationClaim(1)
    const report = cell(await buildLearningMeasurementReport(await computationInput([claim.watermark, claim.claim], claim.claim.clock.openAt - 1)), 'false_mastery_next_delayed.v1')
    expect(report).toMatchObject({ status: 'not_yet_due', observedValue: null, allEligibleValue: null, counts: { maturedClaims: 0, checkedClaims: 0 } })
    const source = await computationEpisode(2)
    source.episode.reasonCodes = ['assistance_requested_denied']
    expect(cell(await buildLearningMeasurementReport(await computationInput([source.watermark, source.episode]))).allEligibleValue).toBe(-20)
  })
})

it.each(['eligibility', 'acceptance'] as const)('uncaptured first-check %s state stays unknown', async point => {
  const f = await computationClaim(1, { score: 60 })
  if (point === 'eligibility') f.claim.stateAtEligibility = 'unknown'
  else f.claim.stateAtAcceptance = 'unknown'
  const report = cell(await buildLearningMeasurementReport(await computationInput([f.watermark, f.claim])), 'false_mastery_next_delayed.v1')
  // No historical state means unknown coverage; even a score of 60 cannot establish a checked failure.
  expect(report.counts).toMatchObject({ maturedClaims: 1, checkedClaims: 0, failedClaims: 0 })
  expect(report.populationState).toBe('unknown')
  expect(report.allEligibleValue).toBeNull()
  expect(report.missingOutcomeBounds).toBeNull()
  expect(report.reasonCodes).toContain('unknown_prior_state')
})
