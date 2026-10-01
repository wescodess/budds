import { ADAPTIVE_ACTIVATION_CONFIGURATION, hasReviewedAdaptiveActivationApproval } from '../../shared/adaptive-activation-approval'
import { canBootstrapLearnV2E2e, type LearnV2E2eEnvironment } from './learnV2E2e'

// Disposable browser approval is explicitly synthetic and selectable only using
// the existing platform loopback + mode + token boundary. It is no live review.
const LOCAL_SYNTHETIC_APPROVAL = {
  version: 'adaptive-activation-approval.v1', scope: 'adaptive_cohort_entitlement', decision: 'approved',
  testedSha: '0'.repeat(40),
  owners: Object.fromEntries(['accessibility', 'security', 'operations', 'rollback'].map(role => [role, {
    principal: `local-synthetic-${role}`, reviewDecision: 'approved', testedSha: '0'.repeat(40),
    evidence: [{ reference: `https://example.invalid/local-synthetic/${role}`, testedSha: '0'.repeat(40), reviewDecision: 'approved', provenance: 'local_synthetic' }],
  }])),
}

export function requireAdaptiveActivationApproval(localEnvironment?: LearnV2E2eEnvironment): void {
  const localSynthetic = localEnvironment !== undefined && canBootstrapLearnV2E2e(localEnvironment)
  const approval = localSynthetic ? LOCAL_SYNTHETIC_APPROVAL : ADAPTIVE_ACTIVATION_CONFIGURATION.approval
  if (!hasReviewedAdaptiveActivationApproval(approval, localSynthetic)) throw new Error('Adaptive Learn activation approval denied')
}
