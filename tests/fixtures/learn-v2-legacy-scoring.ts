import { makeFunctionReference } from 'convex/server'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { internalMutation } from '../../convex/_generated/server'
import type { internal } from '../../convex/_generated/api'
import { legacyMasteryAttemptArgs, recordLegacyMasteryAttemptForOwner } from '../../convex/learnV2Mastery'
import { legacyCalibrationAttemptArgs, recordLegacyCalibrationAttemptForOwner } from '../../convex/learnV2MapCalibration'

export const legacyMasteryAttempt = makeFunctionReference<'mutation', FunctionArgs<typeof internal.learnV2Mastery.recordMasteryAttempt>,
  FunctionReturnType<typeof internal.learnV2Mastery.recordMasteryAttempt>>('legacyScoringFixture:mastery')
export const legacyCalibrationAttempt = makeFunctionReference<'mutation', FunctionArgs<typeof internal.learnV2MapCalibration.recordCalibrationAttempt>,
  FunctionReturnType<typeof internal.learnV2MapCalibration.recordCalibrationAttempt>>('legacyScoringFixture:calibration')

export const legacyScoringModules = {
  './legacyScoringFixture.ts': async () => ({
    mastery: internalMutation({ args: legacyMasteryAttemptArgs, handler: recordLegacyMasteryAttemptForOwner }),
    calibration: internalMutation({ args: legacyCalibrationAttemptArgs, handler: recordLegacyCalibrationAttemptForOwner }),
  }),
}
