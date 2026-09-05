'use node'

import { v } from 'convex/values'
import { action } from './_generated/server'
import { rejectLegacyAudioOverviewWrite } from './lib/audioOverviewLegacyBoundary'

const wordTimingValidator = v.object({
  word: v.string(),
  start: v.number(),
  end: v.number(),
})

const uploadIdentityArgs = {
  jobId: v.id('audioOverviewJobs'),
  capability: v.string(),
  turnOrder: v.number(),
  claimId: v.id('audioOverviewUploadClaims'),
  storageId: v.id('_storage'),
}

export const completeVerified = action({
  args: {
    ...uploadIdentityArgs,
    durationMs: v.number(),
    wordTimings: v.optional(v.array(wordTimingValidator)),
  },
  handler: async () => rejectLegacyAudioOverviewWrite(),
})

export const abortVerified = action({
  args: uploadIdentityArgs,
  handler: async () => rejectLegacyAudioOverviewWrite(),
})
