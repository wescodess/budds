import { describe, expect, it } from 'vitest'
import {
  buildLearningMeasurementReport, buildPublishedLearningMeasurementReport, LEARN_REPORT_PUBLICATION_POLICY_VERSION,
  type LearnPublishedReportMetric, type LearnReportInputSnapshot,
} from './learn-v2-measurement-report'
import { learnReportDisclosure, type LearnReportDisclosureRow } from './learn-v2-measurement-report-policy'
import { computationClaim, computationEpisode, computationInput } from '../tests/fixtures/learn-v2-measurement-computation'

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
  it('publishes identical suppressed singleton cells across bands, acceptance and reasons', async () => {
    const first = await published(await episodes(1, () => ({ cold: 30, delayed: null, acceptedDelayed: true })))
    const second = await published(await episodes(1, () => ({ cold: 90, delayed: null })))
    expect(first).toHaveLength(20)
    expect(first).toEqual(second)
    for (const cell of first) expect(cell).toMatchObject({ ...suppressed, status: 'insufficient_data',
      outcomeCoverage: 'unknown', precision: 'unknown', reasonCodes: ['insufficient_learners'] })
  })

  it('publishes identical suppressed five-learner cells when an unscored outlier changes band', async () => {
    const first = await published(await episodes(5, index => ({ cold: index === 0 ? 90 : 60, delayed: index === 0 ? null : 40, acceptedDelayed: true })))
    const second = await published(await episodes(5, index => ({ cold: index === 0 ? 30 : 60, delayed: index === 0 ? null : 40, acceptedDelayed: true })))
    expect(first).toHaveLength(20)
    expect(first).toEqual(second)
    for (const cell of first.filter(cell => cell.horizonDays === 7)) expect(cell).toMatchObject(suppressed)
  })

  it('hides uniform false-mastery outcomes even with twenty observed learners in a suppressed cell', async () => {
    const build = async (score: number) => {
      const sources = await Promise.all(Array.from({ length: 21 }, (_, index) => computationClaim(index + 1,
        { score: index === 20 ? null : score, accepted: true })))
      const rows = sources.flatMap(source => [source.watermark, source.claim])
      const result = await buildPublishedLearningMeasurementReport(await computationInput(rows))
      expect(result.report.status).toBe('sealed')
      return result.pages.flatMap(page => page.cells)
    }
    const failed = await build(60)
    const passed = await build(90)
    expect(failed).toHaveLength(10)
    expect(failed).toEqual(passed)
    for (const cell of failed) expect(cell).toMatchObject({ ...suppressed, precision: 'unknown' })
  })

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
    expect(find(cells).status).toBe('insufficient_data')
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
    expect(find(cells)).toMatchObject({ ...suppressed, status: 'insufficient_data' })
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

  it('withholds bounds that would reveal a single missing learner\'s cold score', async () => {
    const sources = await episodes(6, index => ({ delayed: index === 5 ? null : 40 }))
    const internal = (await buildLearningMeasurementReport(await input(sources))).pages.flatMap(page => page.cells)
    const unpublished = internal.find(cell => cell.horizonDays === 7 && cell.stratum.startingBand === 'all' && cell.weighting === 'capability_episode')!
    expect(unpublished).toMatchObject({ observedValue: -20, counts: { maturedEpisodes: 6, comparablePairs: 5 } })
    expect(5 * unpublished.observedValue! - 6 * unpublished.missingOutcomeBounds!.lower).toBeCloseTo(60)
    const cells = await published(sources)
    for (const weighting of ['capability_episode', 'learner_sensitivity'] as const) {
      expect(find(cells, 'all', weighting)).toMatchObject({ ...suppressed, status: 'insufficient_data' })
    }
  })

  it('withholds bounds when only a few missing outcomes carry a cold score', async () => {
    const sources = await episodes(10, index => index < 5 ? {} : index < 9 ? { cold: null, delayed: null } : { delayed: null })
    expect(find(await published(sources))).toMatchObject(suppressed)
    const balanced = await published(await episodes(10, index => (index < 5 ? {} : { delayed: null })))
    expect(find(balanced)).toMatchObject({ observedValue: -20, missingOutcomeBounds: { lower: -40, upper: 10 } })
  })

  it('suppresses a sensitivity estimate whose missing outcomes are small on either side', async () => {
    const sources = await episodes(15, index => (index === 5 || index >= 11 ? { delayed: null } : {}))
    for (const source of sources.slice(0, 6)) source.episode.cold!.pasteObserved = true
    const cell = find(await published(sources))
    expect(cell).toMatchObject({ observedValue: -20, sensitivity: null, instrumentation: { pasteFlagged: 6 } })
    expect(cell.missingOutcomeBounds).not.toBeNull()
    expect(cell.reasonCodes).toContain('insufficient_learners')
  })
})

describe('publication disclosure sets', () => {
  const row = (learner: number, observation: LearnReportDisclosureRow['observation'], secondary: LearnReportDisclosureRow['secondary'] = null): LearnReportDisclosureRow => ({
    learnerKey: `learner${learner}`, observation, secondary, paste: false, focus: false, accepted: true, acceptedCold: true,
    order: 'AB', observedOrder: 'AB', coldForm: 'A', delayedForm: 'B', observedColdForm: 'A', observedDelayedForm: 'B',
  })
  const pair = { value: -20, lower: -20, upper: -20 }
  const withCold = { value: null, lower: -60, upper: 40 }
  const noCold = { value: null, lower: -100, upper: 100 }

  it('checks the unlinked complement of replacements, including data-bearing missing outcomes', () => {
    const linked = Array.from({ length: 5 }, (_, index) => row(index, pair, pair))
    const unlinked = [...Array.from({ length: 5 }, (_, index) => row(index + 10, pair)), ...Array.from({ length: 4 }, (_, index) => row(index + 20, noCold)), row(30, withCold)]
    const rows = [...linked, ...unlinked]
    expect(learnReportDisclosure(true, rows, rows).replacements).toBe(false)
    const safe = [...linked, ...unlinked.slice(0, 5), ...Array.from({ length: 5 }, (_, index) => row(index + 40, withCold))]
    expect(learnReportDisclosure(true, safe, safe)).toMatchObject({ cell: true, replacements: true })
  })

  it('checks missing replacement outcomes under their own observations', () => {
    const rows = [...Array.from({ length: 5 }, (_, index) => row(index, pair, pair)), row(5, pair, withCold)]
    expect(learnReportDisclosure(true, rows, rows)).toMatchObject({ cell: true, replacements: false })
  })

  it('treats unresolved first-check bounds as constant but still requires five missing learners', () => {
    const checked = Array.from({ length: 5 }, (_, index) => row(index, { value: 0, lower: 0, upper: 0 }))
    const unresolved = Array.from({ length: 5 }, (_, index) => row(index + 10, { value: null, lower: 0, upper: 1 }))
    expect(learnReportDisclosure(false, [...checked, ...unresolved], [...checked, ...unresolved]).cell).toBe(true)
    expect(learnReportDisclosure(false, [...checked, unresolved[0]!], [...checked, unresolved[0]!]).cell).toBe(false)
  })
})
