import { createLearnScorerRegistry, type BoundLearnScorerConfiguration } from './learnV2ScorerConfig'
import type { LearnScorerBinding } from '../../shared/learn-v2-measurement'

// Reviewed production inventory is empty. Runtime defaults cannot add entries.
export async function getLearnMeasurementScorer(_binding?: Extract<LearnScorerBinding, { kind: 'model' }>) {
  const registry = await createLearnScorerRegistry({ epoch: 'learn-v2.unconfigured.v1', configurations: [], legacyAllowlist: [], prospectiveConfigurationId: null })
  return { registry, saved: null as BoundLearnScorerConfiguration | null }
}
