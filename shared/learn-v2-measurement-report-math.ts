import type { z } from 'zod'
import type { learnReportEstimateSchema, LearnReportMetric } from './learn-v2-measurement-report'

export const LEARN_V2_REPORT_PRECISION = { bootstrapReplicates: 10_000, minimumLearnerClusters: 20, confidenceLevel: 0.95 } as const
export type ReportObservation = { learnerKey: string, value: number | null, lower: number, upper: number }
export type ReportEvidence = Pick<LearnReportMetric, 'populationState' | 'sourceCoverage' | 'validity'> & {
  emptyStatus?: LearnReportMetric['status'], reasonCodes: string[],
}
type Cluster = { sum: number, observed: number, population: number, lower: number, upper: number }

function clustersFor(rows: readonly ReportObservation[]) {
  const clusters = new Map<string, Cluster>()
  for (const row of rows) {
    const cluster = clusters.get(row.learnerKey) ?? { sum: 0, observed: 0, population: 0, lower: 0, upper: 0 }
    cluster.population++
    cluster.lower += row.lower
    cluster.upper += row.upper
    if (row.value !== null) { cluster.sum += row.value; cluster.observed++ }
    clusters.set(row.learnerKey, cluster)
  }
  return [...clusters].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, cluster]) => cluster)
}

function point(clusters: readonly Cluster[], weighting: LearnReportMetric['weighting']) {
  let total = 0
  let denominator = 0
  for (const cluster of clusters) {
    if (!cluster.observed) continue
    total += weighting === 'learner_sensitivity' ? cluster.sum / cluster.observed : cluster.sum
    denominator += weighting === 'learner_sensitivity' ? 1 : cluster.observed
  }
  return denominator ? total / denominator : null
}

// Mulberry32, seeded with FNV-1a of the sealed digest and fixed cell identity.
function randomFor(seed: string) {
  let state = 0x811c9dc5
  for (let index = 0; index < seed.length; index++) state = Math.imul(state ^ seed.charCodeAt(index), 0x01000193)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }
}

function bootstrap(clusters: readonly Cluster[], weighting: LearnReportMetric['weighting'], seed: string) {
  const contributing = clusters.filter(cluster => cluster.observed)
  if (contributing.length < LEARN_V2_REPORT_PRECISION.minimumLearnerClusters) return { precision: 'insufficient_clusters' as const, confidenceInterval: null }
  const means = contributing.map(cluster => cluster.sum / cluster.observed)
  if (Math.max(...means) === Math.min(...means)) return { precision: 'insufficient_variation' as const, confidenceInterval: null }
  const random = randomFor(seed)
  const samples: number[] = []
  for (let replicate = 0; replicate < LEARN_V2_REPORT_PRECISION.bootstrapReplicates; replicate++) {
    let numerator = 0
    let denominator = 0
    for (let draw = 0; draw < clusters.length; draw++) {
      const cluster = clusters[Math.floor(random() * clusters.length)]!
      if (!cluster.observed) continue
      numerator += weighting === 'learner_sensitivity' ? cluster.sum / cluster.observed : cluster.sum
      denominator += weighting === 'learner_sensitivity' ? 1 : cluster.observed
    }
    if (!denominator) return { precision: 'insufficient_variation' as const, confidenceInterval: null }
    samples.push(numerator / denominator)
  }
  samples.sort((a, b) => a - b)
  const percentile = (fraction: number) => {
    const index = fraction * (samples.length - 1)
    const floor = Math.floor(index)
    return samples[floor]! + (samples[Math.ceil(index)]! - samples[floor]!) * (index - floor)
  }
  const lower = percentile(0.025)
  const upper = percentile(0.975)
  return lower === upper ? { precision: 'insufficient_variation' as const, confidenceInterval: null }
    : { precision: 'available' as const, confidenceInterval: { lower, upper } }
}

export function computeLearnReportEstimate(rows: readonly ReportObservation[], weighting: LearnReportMetric['weighting'], evidence: ReportEvidence,
  seed: string): z.infer<typeof learnReportEstimateSchema> {
  const clusters = clustersFor(rows)
  const population = rows.length
  const observed = clusters.reduce((sum, cluster) => sum + cluster.observed, 0)
  const contributingLearners = clusters.filter(cluster => cluster.observed).length
  const known = evidence.populationState === 'known' && evidence.sourceCoverage === 'complete'
  const observedValue = point(clusters, weighting)
  const allEligibleValue = known && population > 0 && observed === population ? observedValue : null
  const bounds = (key: 'lower' | 'upper') => weighting === 'learner_sensitivity'
    ? clusters.reduce((sum, cluster) => sum + cluster[key] / cluster.population, 0) / clusters.length
    : clusters.reduce((sum, cluster) => sum + cluster[key], 0) / population
  const precision = known && evidence.validity !== 'quarantined'
    ? bootstrap(clusters, weighting, seed) : { precision: 'unknown' as const, confidenceInterval: null }
  const status = evidence.validity === 'quarantined' ? 'quarantined'
    : !known ? 'unknown_source_coverage' : !population ? evidence.emptyStatus ?? 'no_eligible_population'
      : observed === population ? 'observed_complete' : observed ? 'partial_observed' : 'insufficient_data'
  const reasons = new Set(evidence.reasonCodes)
  if (!population) reasons.add(evidence.emptyStatus ?? 'no_eligible_population')
  if (!known) reasons.add('unknown_source_coverage')
  if (population > observed) reasons.add('missing_outcomes')
  if (!observed && population) reasons.add('insufficient_data')
  if (precision.confidenceInterval === null) reasons.add(precision.precision)
  if (evidence.validity === 'quarantined') reasons.add('quarantined')
  return { population, observed, contributingLearners, status, populationState: evidence.populationState,
    sourceCoverage: evidence.sourceCoverage, outcomeCoverage: !known ? 'unknown' : !observed ? 'none' : observed === population ? 'complete' : 'partial',
    validity: evidence.validity, ...precision, observedValue, allEligibleValue,
    missingOutcomeBounds: known && population ? { lower: bounds('lower'), upper: bounds('upper') } : null, reasonCodes: [...reasons].sort() }
}
