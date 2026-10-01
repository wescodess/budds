// Test configuration only: these fictional reviews carry no activation authority.
export function syntheticReviewedActivationApproval() {
  const testedSha = 'a'.repeat(40)
  return {
    version: 'adaptive-activation-approval.v1', scope: 'adaptive_cohort_entitlement', decision: 'approved', testedSha,
    owners: Object.fromEntries(['accessibility', 'security', 'operations', 'rollback'].map(role => [role, {
      principal: `synthetic-test-${role}`, reviewDecision: 'approved', testedSha,
      evidence: [{ reference: `https://example.invalid/synthetic-test-review/${role}`, testedSha, reviewDecision: 'approved', provenance: 'independent_review' }],
    }])),
  }
}
