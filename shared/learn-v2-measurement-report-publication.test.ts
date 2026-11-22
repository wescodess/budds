import { describe, expect, it } from 'vitest'
import { buildPublishedLearningMeasurementReport as buildLearningMeasurementReport, type LearnReportInputSnapshot } from './learn-v2-measurement-report'
import { computationEpisode, computationInput } from '../tests/fixtures/learn-v2-measurement-computation'

async function report(count: number, minority = false, oneOwner = false) {
  const sources = await Promise.all(Array.from({ length: count }, (_, index) => computationEpisode(index + 1,
    { owner: oneOwner ? 1 : index + 1, cold: minority && index === 0 ? 20 : 63, delayed: null })))
  const watermarks = new Map(sources.map(source => [source.watermark.learnerKey, source.watermark]))
  const rows: LearnReportInputSnapshot[] = [...watermarks.values(), ...sources.map(source => source.episode)]
  return buildLearningMeasurementReport(await computationInput(rows))
}

describe('minimum contributing learners publication policy', () => {
  it.each([1, 4])('withholds all value-bearing fields for %i learners, including the cold-score bounds reproduction', async count => {
    const result = await report(count)
    expect(result.report.status).toBe('sealed')
    const cells = result.pages.flatMap(page => page.cells)
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(cell).toMatchObject({ observedValue: null, allEligibleValue: null, missingOutcomeBounds: null, confidenceInterval: null,
        counts: null, allocations: null, replacements: null, sensitivity: null, instrumentation: null,
        sourceAccounting: null, attritionByStartingBand: null, legacyIndependentAudit: null })
      expect(cell.reasonCodes).toContain('insufficient_learners')
    }
  })

  it('publishes bounds with five distinct learners without relaxing the twenty-learner interval rule', async () => {
    const result = await report(5)
    const cell = result.pages.flatMap(page => page.cells).find(cell => cell.horizonDays === 7
      && cell.stratum.startingBand === 'all' && cell.weighting === 'capability_episode')!
    expect(cell).toMatchObject({ missingOutcomeBounds: { lower: -63, upper: 37 }, confidenceInterval: null })
  })

  it('suppresses parents and siblings when a larger cohort contains a singleton starting band', async () => {
    const result = await report(10, true)
    for (const cell of result.pages.flatMap(page => page.cells)) {
      expect(cell.missingOutcomeBounds).toBeNull()
      expect(cell.counts).toBeNull()
      expect(cell.reasonCodes).toContain('insufficient_learners')
    }
  })

  it('counts distinct learners rather than episodes', async () => {
    const result = await report(5, false, true)
    expect(result.pages.flatMap(page => page.cells).every(cell => cell.missingOutcomeBounds === null)).toBe(true)
  })
})
