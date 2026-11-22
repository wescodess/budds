import type { LearnPublishedReportMetric, LearnReportMetric } from './learn-v2-measurement-report'

export const LEARN_REPORT_PUBLICATION_POLICY_VERSION = 'learn-v2.report-publication.minimum-five-learners.v1' as const
export const LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS = 5
export const LEARN_REPORT_INSUFFICIENT_LEARNERS = 'insufficient_learners'

/**
 * Small-cell rule (orchestrator decision on #524, 2026-11-22).
 *
 * A published cell needs at least five distinct learners across its rows. Every learner set
 * that determines a published value (all rows, matured population, observed outcomes) must be
 * empty or reach five. Nested breakdowns follow the same test, and so does each breakdown's
 * complement inside its parent, so no suppressed rows can be recovered by subtraction:
 * - sensitivity: flagged and unflagged rows;
 * - replacements: linked and unlinked rows;
 * - allocations: every order and form bucket;
 * - starting bands: band cells partition the group's "all" cell, so one unsafe band suppresses
 *   every band cell, the "all" cell's band attrition, and any nested breakdown that is unsafe in
 *   one band cell is suppressed in all band cells.
 * Suppressed fields are null with reason `insufficient_learners`; cell existence and status remain.
 * Bootstrap intervals still need twenty contributing learners.
 */
export type LearnReportDisclosure = {
  cell: boolean, attrition: boolean, replacements: boolean, sensitivity: boolean, allocations: boolean,
}
type Contribution = { learnerKey: string }

export function isLearnReportLearnerSetPublishable(rows: readonly Contribution[]) {
  const learners = new Set(rows.map(row => row.learnerKey)).size
  return learners === 0 || learners >= LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS
}

export function learnReportBreakdownsPublishable(sets: readonly (readonly Contribution[])[]) {
  return sets.every(isLearnReportLearnerSetPublishable)
}

export function learnReportCellPublishable(rows: readonly Contribution[], sets: readonly (readonly Contribution[])[]) {
  return new Set(rows.map(row => row.learnerKey)).size >= LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS && learnReportBreakdownsPublishable(sets)
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
