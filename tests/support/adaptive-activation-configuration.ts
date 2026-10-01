import { afterEach, beforeEach } from 'vitest'
import { ADAPTIVE_ACTIVATION_CONFIGURATION } from '../../shared/adaptive-activation-approval'
import { syntheticReviewedActivationApproval } from '../fixtures/adaptive-activation-approval'

const shippedApproval = ADAPTIVE_ACTIVATION_CONFIGURATION.approval

// Configure only fictional review evidence; tests still explicitly grant their
// own cohort entitlement and must independently configure V2 access.
beforeEach(() => { ADAPTIVE_ACTIVATION_CONFIGURATION.approval = syntheticReviewedActivationApproval() })
afterEach(() => { ADAPTIVE_ACTIVATION_CONFIGURATION.approval = shippedApproval })
