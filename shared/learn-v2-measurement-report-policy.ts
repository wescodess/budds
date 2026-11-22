import type { LearnPublishedReportMetric, LearnReportMetric } from './learn-v2-measurement-report'

export const LEARN_REPORT_PUBLICATION_POLICY_VERSION = 'learn-v2.report-publication.minimum-five.v1' as const
export const LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS = 5

export class LearnReportContributions {
  private readonly learners = new Map<string, Map<string, number>>()

  add(learner: string, group: readonly unknown[]) {
    const signature = JSON.stringify(group)
    const memberships = this.learners.get(learner) ?? new Map<string, number>()
    memberships.set(signature, (memberships.get(signature) ?? 0) + 1)
    this.learners.set(learner, memberships)
  }

  requiresComplementarySuppression() {
    const classes = new Map<string, number>()
    for (const memberships of this.learners.values()) {
      const signature = JSON.stringify([...memberships].sort(([a], [b]) => a.localeCompare(b)))
      classes.set(signature, (classes.get(signature) ?? 0) + 1)
    }
    return [...classes.values()].some(count => count < LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS)
  }
}

export function publishLearnReportCell(cell: LearnReportMetric, complementarySuppression: boolean): LearnPublishedReportMetric {
  const minimum = LEARN_REPORT_MINIMUM_CONTRIBUTING_LEARNERS
  const learners = cell.metric === 'verified_learning_gain.v1' ? cell.counts.distinctLearners.maturedEpisodes : cell.counts.distinctLearners.maturedClaims
  const suppressed = complementarySuppression || learners < minimum
  const nestedSuppressed = suppressed || cell.replacements.secondary.population < minimum
    || cell.sensitivity.excludingFlagged.population < minimum
    || Object.values(cell.attritionByStartingBand).some(band => band.population < minimum)
    || cell.counts.acceptedSubmissions + cell.counts.acceptedClaims < minimum
  const band = (value: LearnReportMetric['attritionByStartingBand']['below40']) => value.population < minimum ? null : value
  return { ...cell, publicationPolicyVersion: LEARN_REPORT_PUBLICATION_POLICY_VERSION,
    reasonCodes: [...new Set([...cell.reasonCodes, ...(nestedSuppressed ? ['insufficient_learners'] : [])])],
    observedValue: suppressed ? null : cell.observedValue, allEligibleValue: suppressed ? null : cell.allEligibleValue,
    missingOutcomeBounds: suppressed ? null : cell.missingOutcomeBounds, confidenceInterval: suppressed ? null : cell.confidenceInterval,
    counts: suppressed ? null : cell.counts, legacyIndependentAudit: suppressed ? null : cell.legacyIndependentAudit,
    replacements: suppressed || cell.replacements.secondary.population < minimum ? null : cell.replacements,
    sensitivity: suppressed || cell.sensitivity.excludingFlagged.population < minimum ? null : cell.sensitivity,
    instrumentation: suppressed ? null : cell.instrumentation,
    allocations: suppressed || cell.counts.acceptedSubmissions + cell.counts.acceptedClaims < minimum
      || (cell.metric === 'verified_learning_gain.v1' && cell.counts.acceptedColdSubmissions < minimum) ? null : cell.allocations,
    sourceAccounting: suppressed || cell.sourceAccounting.population < minimum ? null : cell.sourceAccounting,
    attritionByStartingBand: suppressed ? null : { below40: band(cell.attritionByStartingBand.below40),
      from40To80: band(cell.attritionByStartingBand.from40To80), from80To100: band(cell.attritionByStartingBand.from80To100), unknown: band(cell.attritionByStartingBand.unknown) },
  }
}
