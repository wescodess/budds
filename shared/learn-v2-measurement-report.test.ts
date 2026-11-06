import { describe, expect, it } from 'vitest'
import {
  LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, LEARN_V2_REPORT_DISPOSITIONS, learnReportMetricSchema,
  learnReportLegacyIndependentAuditSchema, validateLearnReportSourcePage, validateLearnMeasurementReportCells, type LearnReportMetric,
} from './learn-v2-measurement-report'
import { emptyMeasurementEstimate, emptyMeasurementReportCell, partialMeasurementReportCell } from '../tests/fixtures/learn-v2-measurement-report'

describe('frozen aggregate report v3', () => {
  it('keeps the legacy audit separate from prospective episodes and claims', () => {
    const cell = emptyMeasurementReportCell()
    cell.legacyIndependentAudit.unknownCount = 10000
    expect(learnReportMetricSchema.parse(cell).legacyIndependentAudit).toEqual({ unknownCount: 10000, sourceCoverage: 'complete' })
    expect(cell.counts.maturedEpisodes).toBe(0)
    expect(cell.counts.maturedClaims).toBe(0)
    expect(cell.allEligibleValue).toBeNull()
    expect(learnReportMetricSchema.parse({ ...cell, legacyIndependentAudit: { unknownCount: null, sourceCoverage: 'unknown' } }).legacyIndependentAudit.unknownCount).toBeNull()
    const { legacyIndependentAudit: _audit, ...oldCell } = cell
    expect(learnReportMetricSchema.safeParse(oldCell).success).toBe(false)
  })

  it.each([-1, 0.5, 10001, NaN, Infinity])('bounds the legacy audit count: %s', unknownCount => {
    expect(learnReportLegacyIndependentAuditSchema.safeParse({ unknownCount, sourceCoverage: 'complete' }).success).toBe(false)
  })

  it.each([
    { unknownCount: null, sourceCoverage: 'complete' }, { unknownCount: 0, sourceCoverage: 'unknown' },
    { unknownCount: 1, sourceCoverage: 'unknown' }, { unknownCount: 1, sourceCoverage: 'complete', learnerRows: [{ ownerId: 'private' }] },
  ])('rejects unknown legacy enumeration presented as a count and private audit payloads: %j', audit => {
    expect(learnReportLegacyIndependentAuditSchema.safeParse(audit).success).toBe(false)
  })

  it('pins the aggregate legacy audit input to its owner watermark in source v2', () => {
    const row = { kind: 'owner_watermark', sequence: 1, dueWorkThrough: null, historyCoverage: 'unknown',
      legacyIndependentAudit: { unknownCount: 3, sourceCoverage: 'complete' } }
    const page = { version: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, reportRunId: 'run1', sequence: 0, sourceWatermark: 1,
      rows: [row], cursor: null, isDone: true }
    expect(validateLearnReportSourcePage(page).rows).toEqual([row])
    const { legacyIndependentAudit: _audit, ...oldRow } = row
    expect(() => validateLearnReportSourcePage({ ...page, rows: [oldRow] })).toThrow()
    expect(() => validateLearnReportSourcePage({ ...page, version: 'learn-v2.measurement-report-source.v1' })).toThrow()
    expect(() => validateLearnReportSourcePage({ ...page, rows: [{ ...row, legacyIndependentAudit: { ...row.legacyIndependentAudit, learnerRows: [] } }] })).toThrow()
  })

  it('uses cold-conditioned missing-outcome bounds in the partial fixture', () => {
    const cell = partialMeasurementReportCell()
    const observedDifference = 40 - 60
    const missingCold = 40
    expect(cell.observedValue).toBe(observedDifference)
    expect(cell.missingOutcomeBounds).toEqual({ lower: (observedDifference - missingCold) / 2, upper: (observedDifference + 100 - missingCold) / 2 })
    expect(cell.replacements.secondary.missingOutcomeBounds).toEqual({ lower: -missingCold, upper: 100 - missingCold })
    expect(cell.sensitivity.excludingFlagged.missingOutcomeBounds).toEqual({ lower: -missingCold, upper: 100 - missingCold })
  })

  const subEstimates = ['secondary', 'excludingFlagged'] as const
  const parentConstraints: Array<[string, (cell: LearnReportMetric) => void]> = [
    ['unknown population', cell => { cell.populationState = 'unknown'; cell.missingOutcomeBounds = null }],
    ['unknown source coverage', cell => { cell.sourceCoverage = 'unknown'; cell.missingOutcomeBounds = null }],
    ['unknown source status', cell => { cell.status = 'unknown_source_coverage' }],
    ['quarantined validity', cell => { cell.validity = 'quarantined' }],
    ['quarantined status', cell => { cell.status = 'quarantined' }],
    ['unknown validity', cell => { cell.validity = 'unknown' }],
  ]
  describe.each(subEstimates)('%s parent constraints', name => {
    it.each(parentConstraints)('rejects stronger evidence than the parent: %s', (_label, mutate) => {
      const cell = partialMeasurementReportCell()
      expect(learnReportMetricSchema.safeParse(cell).success).toBe(true)
      mutate(cell)
      const other = name === 'secondary' ? cell.sensitivity.excludingFlagged : cell.replacements.secondary
      other.populationState = cell.populationState
      other.sourceCoverage = cell.status === 'unknown_source_coverage' ? 'unknown' : cell.sourceCoverage
      other.validity = cell.status === 'quarantined' ? 'quarantined' : cell.validity
      if (other.populationState === 'unknown' || other.sourceCoverage === 'unknown') other.missingOutcomeBounds = null
      expect(learnReportMetricSchema.safeParse(cell).success).toBe(false)
    })

    it('cannot claim verified validity under a provisional parent', () => {
      const cell = partialMeasurementReportCell()
      const estimate = name === 'secondary' ? cell.replacements.secondary : cell.sensitivity.excludingFlagged
      estimate.validity = 'verified'
      expect(learnReportMetricSchema.safeParse(cell).success).toBe(false)
    })

    it('allows a sub-estimate to retain weaker evidence', () => {
      const cell = partialMeasurementReportCell()
      const estimate = name === 'secondary' ? cell.replacements.secondary : cell.sensitivity.excludingFlagged
      Object.assign(estimate, { populationState: 'unknown', sourceCoverage: 'unknown', validity: 'quarantined', status: 'quarantined', missingOutcomeBounds: null })
      expect(learnReportMetricSchema.safeParse(cell).success).toBe(true)
    })
  })

  it('accepts sub-estimates that preserve an unknown and quarantined parent', () => {
    const cell = partialMeasurementReportCell()
    for (const estimate of [cell, cell.replacements.secondary, cell.sensitivity.excludingFlagged]) {
      Object.assign(estimate, { populationState: 'unknown', sourceCoverage: 'unknown', validity: 'quarantined', status: 'quarantined', missingOutcomeBounds: null })
    }
    expect(learnReportMetricSchema.safeParse(cell).success).toBe(true)
  })

  it('retains the paired-row lower bound when no rows are flagged', () => {
    const cell = partialMeasurementReportCell()
    Object.assign(cell.instrumentation, { pasteFlagged: 0, focusFlagged: 0, eitherFlagged: 0, knownUnflagged: 1 })
    cell.sensitivity.excludingFlagged.population = 2
    expect(learnReportMetricSchema.safeParse(cell).success).toBe(false)
    Object.assign(cell.sensitivity.excludingFlagged, { observed: 1, contributingLearners: 1, status: 'partial_observed', outcomeCoverage: 'partial', observedValue: -20 })
    expect(learnReportMetricSchema.safeParse(cell).success).toBe(true)
    cell.sensitivity.excludingFlagged.contributingLearners = 0
    expect(learnReportMetricSchema.safeParse(cell).success).toBe(false)
  })

  it('can remove at most the flagged rows from the paired population', () => {
    const cell = partialMeasurementReportCell()
    Object.assign(cell, { status: 'observed_complete', outcomeCoverage: 'complete', allEligibleValue: -20, missingOutcomeBounds: { lower: -20, upper: -20 } })
    Object.assign(cell.counts, { acceptedSubmissions: 2, validDelayedScores: 2, comparablePairs: 2 })
    Object.assign(cell.counts.distinctLearners, { acceptedSubmissions: 2, validDelayedScores: 2, comparablePairs: 2 })
    Object.assign(cell.counts.dispositions, { missing_delayed: 0, valid_scored: 2 })
    cell.allocations.observedOrders.ABC = 2
    cell.allocations.observedDelayedForms.B = 2
    cell.attritionByStartingBand.from40To80 = { population: 2, accepted: 2, validScored: 2, paired: 2 }
    expect(learnReportMetricSchema.safeParse(cell).success).toBe(false)
    Object.assign(cell.sensitivity.excludingFlagged, { observed: 1, contributingLearners: 1, status: 'observed_complete', outcomeCoverage: 'complete',
      observedValue: -20, allEligibleValue: -20, missingOutcomeBounds: { lower: -20, upper: -20 } })
    expect(learnReportMetricSchema.safeParse(cell).success).toBe(true)
  })

  it('retains disjoint attrition, replacement, instrumentation, source and allocation accounting', () => {
    const cell = partialMeasurementReportCell()
    expect(Object.keys(cell.counts.dispositions)).toEqual([...LEARN_V2_REPORT_DISPOSITIONS])
    expect(cell.observedValue).toBe(-20)
    expect(cell.allEligibleValue).toBeNull()
    expect(cell.replacements).toMatchObject({ originalPopulation: 2, withLinkedReplacement: 1, primaryIncludedPairs: 0, secondary: { population: 1, observedValue: null } })
    expect(cell.instrumentation).toMatchObject({ pasteFlagged: 1, focusFlagged: 1, eitherFlagged: 1, unknownUnflagged: 1 })
    expect(cell.sensitivity.excludingFlagged).toMatchObject({ population: 1, observed: 0, observedValue: null, reasonCodes: ['missing_delayed', 'insufficient_clusters'] })
    expect(cell.sourceAccounting).toMatchObject({ population: 3, missingT0: { covered: 3, affected: 1, unknown: 0 } })
    expect(cell.allocations.assignedOrders.ABC).toBe(2)
    expect(cell.allocations.observedOrders.ABC).toBe(1)
    expect(cell.allocations.observedColdForms.A).toBe(2)
    expect(cell.allocations.observedDelayedForms.B).toBe(1)
    expect(cell.attritionByStartingBand.from40To80).toEqual({ population: 2, accepted: 1, validScored: 1, paired: 1 })
    expect(cell.attritionByStartingBand.unknown.population).toBe(0)
  })

  const inconsistent: Array<[string, (cell: LearnReportMetric) => void]> = [
    ['disposition total', cell => { cell.counts.dispositions.scoring_pending++ }],
    ['replacement population', cell => { cell.replacements.originalPopulation++ }],
    ['replacement nesting', cell => { cell.replacements.withAcceptedReplacement = 2 }],
    ['replacement secondary denominator', cell => { cell.replacements.secondary.population = 0 }],
    ['instrumentation union', cell => { cell.instrumentation.eitherFlagged = 0 }],
    ['unknown instrumentation population', cell => { cell.instrumentation.unknownUnflagged = 0 }],
    ['unknown instrumentation union', cell => { cell.instrumentation.unknownInstrumentation = 0 }],
    ['unknown and flagged overlap', cell => { cell.instrumentation.flaggedWithUnknownInstrumentation = 1 }],
    ['sensitivity denominator', cell => { cell.sensitivity.excludingFlagged.population = 2 }],
    ['sensitivity invented zero', cell => { cell.sensitivity.excludingFlagged.observedValue = 0 }],
    ['sensitivity all-eligible point', cell => { cell.sensitivity.excludingFlagged.allEligibleValue = 0 }],
    ['sensitivity missing reasons', cell => { cell.sensitivity.excludingFlagged.reasonCodes = [] }],
    ['sensitivity sparse interval', cell => { cell.sensitivity.excludingFlagged.confidenceInterval = { lower: 0, upper: 0 } }],
    ['sensitivity unknown-source bounds', cell => { cell.sensitivity.excludingFlagged.sourceCoverage = 'unknown' }],
    ['secondary invented zero', cell => { cell.replacements.secondary.observedValue = 0 }],
    ['secondary metric scale', cell => { cell.replacements.secondary.missingOutcomeBounds = { lower: -101, upper: 101 } }],
    ['assigned order total', cell => { cell.allocations.assignedOrders.ABC = 1 }],
    ['observed order population', cell => { cell.allocations.observedOrders.ABC = 2 }],
    ['unassigned observed order', cell => { cell.allocations.observedOrders.ABC = 0; cell.allocations.observedOrders.ACB = 1 }],
    ['cold form total', cell => { cell.allocations.observedColdForms.A = 1 }],
    ['delayed form total', cell => { cell.allocations.assignedDelayedForms.B = 3 }],
    ['covered source reason total', cell => { cell.sourceAccounting.missingT0.covered = 2 }],
    ['source reason affected count', cell => { cell.sourceAccounting.exhaustedInventory.affected = 4 }],
    ['source population', cell => { cell.sourceAccounting.population = 1 }],
    ['band attrition population', cell => { cell.attritionByStartingBand.unknown.population = 1 }],
    ['band attrition accepted count', cell => { cell.attritionByStartingBand.from40To80.accepted = 0 }],
    ['claimed single band', cell => { cell.stratum.startingBand = '0_40' }],
  ]
  it.each(inconsistent)('rejects inconsistent %s', (_name, mutate) => {
    const cell = partialMeasurementReportCell()
    mutate(cell)
    expect(() => learnReportMetricSchema.parse(cell)).toThrow()
  })

  it.each([-1, 0.5, 10001, NaN, Infinity])('bounds every new count without truncation: %s', invalid => {
    const cell = partialMeasurementReportCell()
    expect(() => learnReportMetricSchema.parse({ ...cell, counts: { ...cell.counts,
      dispositions: { ...cell.counts.dispositions, missing_cold: invalid } } })).toThrow()
    expect(() => learnReportMetricSchema.parse({ ...cell, sourceAccounting: { ...cell.sourceAccounting,
      missingT0: { ...cell.sourceAccounting.missingT0, affected: invalid } } })).toThrow()
  })

  it('allows primary replacement pairs only with pinned pre-enrollment protocol rules', () => {
    const cell = partialMeasurementReportCell()
    Object.assign(cell.replacements, { withAcceptedReplacement: 1, withValidReplacement: 1, withComparableReplacement: 1, primaryIncludedPairs: 1,
      secondary: { ...emptyMeasurementEstimate(), population: 1, observed: 1, contributingLearners: 1, status: 'observed_complete', outcomeCoverage: 'complete',
        observedValue: -10, allEligibleValue: -10, missingOutcomeBounds: { lower: -10, upper: -10 }, reasonCodes: ['insufficient_clusters'] } })
    expect(() => learnReportMetricSchema.parse(cell)).toThrow()
    cell.replacements.policy = { kind: 'predeclared', protocolVersion: 'protocol.v1', ruleVersion: 'replacement.v1', ruleDigest: `sha256:${'b'.repeat(64)}` }
    expect(learnReportMetricSchema.parse(cell).replacements.primaryIncludedPairs).toBe(1)
    expect(() => learnReportMetricSchema.parse({ ...cell, replacements: { ...cell.replacements, policy: { kind: 'predeclared', protocolVersion: 'protocol.v1' } } })).toThrow()
  })

  it('keeps source coverage unknown separately from a known zero affected count', () => {
    const cell = partialMeasurementReportCell()
    cell.sourceAccounting.purgedEvidence = { covered: 0, affected: 0, unknown: 3 }
    expect(learnReportMetricSchema.parse(cell).sourceAccounting.purgedEvidence).toEqual({ covered: 0, affected: 0, unknown: 3 })
    expect(() => learnReportMetricSchema.parse({ ...cell, sourceAccounting: { ...cell.sourceAccounting, ownerId: 'private' } })).toThrow()
  })

  it('requires a concrete response kind, keeping keyed and rubric-scored cells separate', () => {
    const cell = emptyMeasurementReportCell()
    expect(cell.stratum.responseKind).toBe('keyed')
    expect(learnReportMetricSchema.parse({ ...cell, stratum: { ...cell.stratum, responseKind: 'bounded_rubric', scoringKind: 'model' } }).stratum.responseKind).toBe('bounded_rubric')
    expect(() => learnReportMetricSchema.parse({ ...cell, stratum: { ...cell.stratum, responseKind: 'mixed' } })).toThrow()
  })

  it('uses matured first-check claims for false-mastery dispositions and sensitivity rates', () => {
    const cell = emptyMeasurementReportCell()
    cell.metric = 'false_mastery_next_delayed.v1'
    Object.assign(cell, { status: 'observed_complete', outcomeCoverage: 'complete', observedValue: 1, allEligibleValue: 1,
      missingOutcomeBounds: { lower: 1, upper: 1 }, reasonCodes: ['insufficient_clusters'] })
    Object.assign(cell.counts, { considered: 1, maturedClaims: 1, acceptedClaims: 1, checkedClaims: 1, failedClaims: 1 })
    Object.assign(cell.counts.distinctLearners, { maturedClaims: 1, checkedClaims: 1, failedClaims: 1 })
    cell.counts.dispositions.valid_scored = 1
    cell.replacements.originalPopulation = 1
    cell.instrumentation.unknownUnflagged = 1
    cell.instrumentation.pasteUnknown = 1
    cell.instrumentation.focusUnknown = 1
    cell.instrumentation.unknownInstrumentation = 1
    cell.sensitivity.excludingFlagged = { ...emptyMeasurementEstimate(), population: 1, observed: 1, contributingLearners: 1,
      status: 'observed_complete', outcomeCoverage: 'complete', observedValue: 1, allEligibleValue: 1, missingOutcomeBounds: { lower: 1, upper: 1 }, reasonCodes: ['insufficient_clusters'] }
    cell.allocations.assignedOrders.unknown = 1
    cell.allocations.observedOrders.unknown = 1
    cell.allocations.assignedDelayedForms.unknown = 1
    cell.allocations.observedDelayedForms.unknown = 1
    cell.sourceAccounting.population = 1
    for (const reason of [cell.sourceAccounting.missingT0, cell.sourceAccounting.unknownExposure, cell.sourceAccounting.exhaustedInventory,
      cell.sourceAccounting.purgedEvidence, cell.sourceAccounting.replacement, cell.sourceAccounting.treatmentChange, cell.sourceAccounting.outsideHelpUncertainty]) reason.covered = 1
    cell.attritionByStartingBand.unknown = { population: 1, accepted: 1, validScored: 1, paired: 1 }
    expect(learnReportMetricSchema.parse(cell).observedValue).toBe(1)
    cell.sensitivity.excludingFlagged.observedValue = 2
    expect(() => learnReportMetricSchema.parse(cell)).toThrow()
    Object.assign(cell.sensitivity.excludingFlagged, { observed: 0, contributingLearners: 0, status: 'insufficient_data', outcomeCoverage: 'none',
      observedValue: null, allEligibleValue: null, missingOutcomeBounds: { lower: 0, upper: 1 } })
    expect(() => learnReportMetricSchema.parse(cell)).toThrow()
  })

  it('pages bounded aggregate-only v3 cells and rejects old or private output shapes', () => {
    const page = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId: 'run1', cells: [partialMeasurementReportCell()], cursor: null, isDone: true }
    expect(validateLearnMeasurementReportCells(page).cells).toHaveLength(1)
    expect(() => validateLearnMeasurementReportCells({ ...page, version: 'learn-v2.measurement-report.v1' })).toThrow()
    expect(() => validateLearnMeasurementReportCells({ ...page, version: 'learn-v2.measurement-report.v2' })).toThrow()
    expect(() => validateLearnMeasurementReportCells({ ...page, cells: [{ ...page.cells[0], learnerRows: [{ response: 'private' }] }] })).toThrow()
    expect(() => validateLearnMeasurementReportCells({ ...page, cells: Array.from({ length: 9 }, () => page.cells[0]) })).toThrow()
  })
})
