import type { LearnPublishedReportMetric, LearnReportMetric } from './learn-v2-measurement-report'

export const LEARN_REPORT_PUBLICATION_POLICY_VERSION = 'learn-v2.report-publication.minimum-five-learners.v1' as const
export const LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS = 5
export const LEARN_REPORT_INSUFFICIENT_LEARNERS = 'insufficient_learners'

/**
 * Small-cell rule (orchestrator decision on #524, 2026-11-22).
 *
 * A published cell needs at least five distinct learners across its rows. Every learner set that
 * determines a published value must be empty or reach five: all rows, the matured population, the
 * observed outcomes, the missing outcomes, and the missing outcomes whose bound carries data (a
 * missing delayed score with a valid cold score contributes [-cold, 100 - cold]). Otherwise a
 * published mean and count would let a bound be solved for the missing learners. Nested breakdowns
 * apply the same sets, and so does each breakdown's complement inside its parent:
 * - sensitivity: flagged and unflagged rows;
 * - replacements: linked rows under their replacement observations, unlinked rows under primary;
 * - allocations: every order and form bucket;
 * - starting bands: band cells partition the group's "all" cell, so one unsafe band suppresses
 *   every band cell, the "all" cell's band attrition, and any nested breakdown that is unsafe in
 *   one band cell is suppressed in all band cells.
 * Suppressed fields are null with reason `insufficient_learners`; cell existence and status remain.
 * Bootstrap intervals still need twenty contributing learners.
 *
 * Accepted residuals ("Accept for owner-only (Recommended)", owner decision 2026-11-22): differencing
 * two sealed snapshots whose cohorts differ by fewer than five learners, and solving a cell's two
 * weightings for a dominant learner whose episode count is known. Both are accepted only while the
 * sole viewer grant is the project owner, who already has direct database access; reports are
 * internal and default-off, and the grant excludes individual pair evidence by policy rather than
 * by mathematical guarantee. Before any second viewer grant is issued, both must be fixed or
 * re-reviewed.
 */
export type LearnReportDisclosure = {
  cell: boolean, attrition: boolean, replacements: boolean, sensitivity: boolean, allocations: boolean,
}
type Contribution = { learnerKey: string }
type Observation = { value: number | null, lower: number, upper: number }
export type LearnReportDisclosureRow = Contribution & {
  observation: Observation, secondary: Observation | null, paste: boolean | 'unknown', focus: boolean | 'unknown',
  accepted: boolean, acceptedCold: boolean, order: string, observedOrder: string, coldForm: string, delayedForm: string,
  observedColdForm: string | null, observedDelayedForm: string | null,
}

function publishable(rows: readonly Contribution[]) {
  const learners = new Set(rows.map(row => row.learnerKey)).size
  return learners === 0 || learners >= LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS
}

export function learnReportDisclosure(gain: boolean, rows: readonly LearnReportDisclosureRow[], matured: readonly LearnReportDisclosureRow[]): LearnReportDisclosure {
  const scale = gain ? { lower: -100, upper: 100 } : { lower: 0, upper: 1 }
  const outcomes = (values: readonly LearnReportDisclosureRow[], observe: (row: LearnReportDisclosureRow) => Observation = row => row.observation) => {
    const missing = values.filter(row => observe(row).value === null)
    return [values, values.filter(row => observe(row).value !== null), missing,
      missing.filter(row => observe(row).lower !== scale.lower || observe(row).upper !== scale.upper)]
  }
  const flagged = (row: LearnReportDisclosureRow) => row.paste === true || row.focus === true
  const buckets = (values: readonly LearnReportDisclosureRow[], key: (row: LearnReportDisclosureRow) => string | null) => {
    const grouped = new Map<string, LearnReportDisclosureRow[]>()
    for (const row of values) {
      const bucket = key(row) ?? 'unknown'
      grouped.set(bucket, [...(grouped.get(bucket) ?? []), row])
    }
    return [...grouped.values()]
  }
  const accepted = matured.filter(row => row.accepted)
  return {
    cell: new Set(rows.map(row => row.learnerKey)).size >= LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS
      && [rows, ...outcomes(matured)].every(publishable),
    attrition: true,
    sensitivity: [...outcomes(matured.filter(flagged)), ...outcomes(matured.filter(row => !flagged(row)))].every(publishable),
    replacements: [...outcomes(matured.filter(row => row.secondary !== null), row => row.secondary!),
      ...outcomes(matured.filter(row => row.secondary === null))].every(publishable),
    allocations: [
      ...buckets(matured, row => row.order), ...buckets(accepted, row => row.observedOrder),
      ...buckets(matured, row => row.delayedForm), ...buckets(accepted, row => row.observedDelayedForm),
      ...(gain ? [...buckets(matured, row => row.coldForm), ...buckets(matured.filter(row => row.acceptedCold), row => row.observedColdForm)] : []),
    ].every(publishable),
  }
}

export function reconcileLearnReportBandDisclosures(all: LearnReportDisclosure, bands: readonly LearnReportDisclosure[]) {
  const bandsPublishable = bands.every(band => band.cell)
  const nested = (key: 'replacements' | 'sensitivity' | 'allocations') => bandsPublishable && bands.every(band => band[key])
  return {
    all: { ...all, attrition: all.cell && bandsPublishable },
    bands: bands.map(() => ({
      cell: bandsPublishable, attrition: bandsPublishable, replacements: nested('replacements'),
      sensitivity: nested('sensitivity'), allocations: nested('allocations'),
    })),
  }
}

export function publishLearnReportCell(cell: LearnReportMetric, disclosure: LearnReportDisclosure): LearnPublishedReportMetric {
  const shown = disclosure.cell
  const nested = shown && disclosure.attrition && disclosure.replacements && disclosure.sensitivity && disclosure.allocations
  return {
    ...cell, publicationPolicyVersion: LEARN_REPORT_PUBLICATION_POLICY_VERSION,
    reasonCodes: nested ? cell.reasonCodes : [...new Set([...cell.reasonCodes, LEARN_REPORT_INSUFFICIENT_LEARNERS])].sort(),
    observedValue: shown ? cell.observedValue : null, allEligibleValue: shown ? cell.allEligibleValue : null,
    missingOutcomeBounds: shown ? cell.missingOutcomeBounds : null, confidenceInterval: shown ? cell.confidenceInterval : null,
    counts: shown ? cell.counts : null, legacyIndependentAudit: shown ? cell.legacyIndependentAudit : null,
    instrumentation: shown ? cell.instrumentation : null, sourceAccounting: shown ? cell.sourceAccounting : null,
    replacements: shown && disclosure.replacements ? cell.replacements : null,
    sensitivity: shown && disclosure.sensitivity ? cell.sensitivity : null,
    allocations: shown && disclosure.allocations ? cell.allocations : null,
    attritionByStartingBand: shown && disclosure.attrition ? cell.attritionByStartingBand : null,
  }
}
