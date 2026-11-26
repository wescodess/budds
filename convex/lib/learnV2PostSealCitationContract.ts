import { v, type Infer } from 'convex/values'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '../../shared/learn-v2-assessment-disclosure'
import { postSealTeachingArgs } from './learnV2PublicContract'

export const postSealCitationArgs = {
  postSealReference: v.object(postSealTeachingArgs), sourceRef: v.string(),
}
export const postSealCitationValidator = v.union(
  v.object({ version: v.literal(LEARN_V2_POST_SEAL_TEACHING_VERSION), status: v.literal('unavailable'),
    reasonCode: v.union(v.literal('disabled'), v.literal('unavailable')) }),
  v.object({ version: v.literal(LEARN_V2_POST_SEAL_TEACHING_VERSION), status: v.literal('available'),
    evidence: v.object({ kind: v.literal('factual'), activityId: v.string(), eligibility: v.literal('historical'),
      readOnly: v.literal(true), integrityState: v.literal('accepted'), claims: v.array(v.object({
        claimId: v.string(), claimText: v.string(), claimStatus: v.literal('unknown'), integrityState: v.literal('accepted'),
        source: v.object({ origin: v.union(v.literal('folder_document'), v.literal('user_url'), v.literal('open_database'), v.literal('general_web_search')),
          locator: v.union(v.string(), v.null()), sourceSnapshotId: v.string(), sourceSnapshotRevision: v.number(), sourceRecordRevision: v.number() }),
      })) }),
  }),
)
export type PostSealCitationSource = Infer<typeof postSealCitationValidator>
export const unavailablePostSealCitation = (reasonCode: 'disabled' | 'unavailable' = 'unavailable'): PostSealCitationSource =>
  ({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'unavailable', reasonCode })
