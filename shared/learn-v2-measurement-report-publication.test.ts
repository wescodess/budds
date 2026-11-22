import { describe, expect, it } from 'vitest'
import {
  buildLearningMeasurementReport, buildPublishedLearningMeasurementReport, LEARN_REPORT_PUBLICATION_POLICY_VERSION,
  type LearnPublishedReportMetric, type LearnReportInputSnapshot,
} from './learn-v2-measurement-report'
import { computationEpisode, computationInput } from '../tests/fixtures/learn-v2-measurement-computation'

type Episode = Awaited<ReturnType<typeof computationEpisode>>
type Options = Parameters<typeof computationEpisode>[1]

async function episodes(count: number, options: (index: number) => Options = () => ({})) {
  return Promise.all(Array.from({ length: count }, (_, index) => computationEpisode(index + 1, options(index))))
}
function input(sources: readonly Episode[]) {
  const watermarks = new Map(sources.map(source => [source.watermark.learnerKey, source.watermark]))
  const rows: LearnReportInputSnapshot[] = [...watermarks.values(), ...sources.map(source => source.episode)]
  return computationInput(rows)
}
async function published(sources: readonly Episode[]) {
  const result = await buildPublishedLearningMeasurementReport(await input(sources))
  expect(result.report.status).toBe('sealed')
  return result.pages.flatMap(page => page.cells)
}
function find(cells: readonly LearnPublishedReportMetric[], band: LearnPublishedReportMetric['stratum']['startingBand'] = 'all',
  weighting: LearnPublishedReportMetric['weighting'] = 'capability_episode') {
  const found = cells.find(cell => cell.horizonDays === 7 && cell.stratum.startingBand === band && cell.weighting === weighting)
  expect(found).toBeDefined()
  return found!
}
const suppressed = {
  observedValue: null, allEligibleValue: null, missingOutcomeBounds: null, confidenceInterval: null, counts: null,
  legacyIndependentAudit: null, replacements: null, instrumentation: null, sensitivity: null, allocations: null,
  sourceAccounting: null, attritionByStartingBand: null, publicationPolicyVersion: LEARN_REPORT_PUBLICATION_POLICY_VERSION,
}

describe('minimum contributing learners publication policy', () => {
  it('withholds the singleton cold score that the unpublished bounds reveal', async () => {
    const sources = await episodes(1, () => ({ cold: 63, delayed: null }))
    const internal = (await buildLearningMeasurementReport(await input(sources))).pages.flatMap(page => page.cells)
    expect(internal.find(cell => cell.horizonDays === 7 && cell.stratum.startingBand === 'all' && cell.weighting === 'capability_episode'))
      .toMatchObject({ missingOutcomeBounds: { lower: -63, upper: 37 } })
    const cells = await published(sources)
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(cell).toMatchObject(suppressed)
      expect(cell.reasonCodes).toContain('insufficient_learners')
    }
    expect(find(cells).status).toBe('insufficient_data')
    expect(JSON.stringify(cells)).not.toMatch(/\b(63|37)\b/)
  })

  it.each([1, 4])('withholds every value-bearing field with %i distinct learners', async count => {
    const cells = await published(await episodes(count))
    for (const cell of cells) {
      expect(cell).toMatchObject(suppressed)
      expect(cell.reasonCodes).toContain('insufficient_learners')
    }
    expect(find(cells).status).toBe('observed_complete')
  })

  it('publishes five distinct learners and keeps the twenty-learner interval rule', async () => {
    const cells = await published(await episodes(5))
    for (const weighting of ['capability_episode', 'learner_sensitivity'] as const) {
      const cell = find(cells, 'all', weighting)
      expect(cell).toMatchObject({ observedValue: -20, allEligibleValue: -20, missingOutcomeBounds: { lower: -20, upper: -20 },
        confidenceInterval: null, precision: 'insufficient_clusters', counts: { comparablePairs: 5, distinctLearners: { comparablePairs: 5 } } })
      expect(cell.attritionByStartingBand).not.toBeNull()
      expect(cell.allocations).not.toBeNull()
      expect(cell.reasonCodes).not.toContain('insufficient_learners')
    }
    expect(find(cells, '40_80')).toMatchObject({ observedValue: -20, counts: { maturedEpisodes: 5 } })
  })

  it('counts distinct learners rather than episodes', async () => {
    for (const cell of await published(await episodes(5, () => ({ owner: 1 })))) expect(cell).toMatchObject(suppressed)
  })

  it('withholds a cell whose observed outcomes come from fewer than five learners', async () => {
    const cells = await published(await episodes(6, index => ({ delayed: index === 0 ? 40 : null })))
    expect(find(cells)).toMatchObject({ ...suppressed, status: 'partial_observed' })
  })

  it('suppresses every sibling band and the parent band breakdown when one band is small', async () => {
    const sources = await episodes(10, index => ({ cold: index === 0 ? 20 : 63 }))
    const cells = await published(sources)
    const all = find(cells)
    expect(all).toMatchObject({ observedValue: -18.7, counts: { maturedEpisodes: 10 }, attritionByStartingBand: null })
    expect(all.reasonCodes).toContain('insufficient_learners')
    for (const band of ['0_40', '40_80'] as const) {
      for (const weighting of ['capability_episode', 'learner_sensitivity'] as const) expect(find(cells, band, weighting)).toMatchObject(suppressed)
    }
    const internal = (await buildLearningMeasurementReport(await input(sources))).pages.flatMap(page => page.cells)
    const internalLarge = internal.find(cell => cell.horizonDays === 7 && cell.stratum.startingBand === '40_80' && cell.weighting === 'capability_episode')!
    expect(internalLarge.observedValue).toBe(-23)
    expect(JSON.stringify(cells.filter(cell => cell.stratum.startingBand !== 'all'))).not.toContain('-23')
  })

  it('publishes sibling bands when every band reaches five learners', async () => {
    const cells = await published(await episodes(10, index => ({ cold: index < 5 ? 20 : 63 })))
    expect(find(cells, '0_40')).toMatchObject({ observedValue: 20, counts: { maturedEpisodes: 5 } })
    expect(find(cells, '40_80')).toMatchObject({ observedValue: -23, counts: { maturedEpisodes: 5 } })
    expect(find(cells).attritionByStartingBand).toMatchObject({ below40: { population: 5 }, from40To80: { population: 5 } })
  })

  it('suppresses a sensitivity estimate whose excluded complement is small', async () => {
    const sources = await episodes(6)
    sources[0]!.episode.delayed!.pasteObserved = true
    const cell = find(await published(sources))
    expect(cell).toMatchObject({ observedValue: -20, sensitivity: null, instrumentation: { pasteFlagged: 1 } })
    expect(cell.reasonCodes).toContain('insufficient_learners')
  })

  it('suppresses allocation counts when one order isolates a learner', async () => {
    const cell = find(await published(await episodes(6, index => ({ order: index === 0 ? 'BA' : 'AB' }))))
    expect(cell).toMatchObject({ observedValue: -20, allocations: null })
    expect(cell.reasonCodes).toContain('insufficient_learners')
  })
})
