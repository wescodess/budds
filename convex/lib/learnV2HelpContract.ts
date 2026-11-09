import { v, type Infer } from 'convex/values'
import { z } from 'zod'
import { learnIdSchema, learnResponseIdempotencyKeySchema } from '../../shared/learn-v2-responses'

export const LEARN_HELP_ADMISSION_VERSION = 'learn-v2.help-admission.v1' as const
export const LEARN_HELP_LIMITS = { openOpportunities: 8, references: 64, sources: 64, folderDepth: 8 } as const
export const LEARN_HELP_OPEN_PHASES = ['preparing', 'ready', 'test_open'] as const
const kind = v.union(v.literal('chat'), v.literal('search'), v.literal('source'), v.literal('audio'), v.literal('replay'))
export const helpReference = v.union(
  v.object({ kind: v.literal('conversation'), id: v.id('conversations') }),
  v.object({ kind: v.literal('folder'), id: v.id('folders') }),
  v.object({ kind: v.literal('document'), id: v.id('documents') }),
  v.object({ kind: v.literal('source_snapshot'), id: v.id('learnSourceSnapshots') }),
  v.object({ kind: v.literal('learning_void'), id: v.id('learningVoids') }),
  v.object({ kind: v.literal('thread'), id: v.id('learningThreads') }),
  v.object({ kind: v.literal('audio_overview'), id: v.id('audioOverviews') }),
  v.object({ kind: v.literal('audio_job'), id: v.id('audioOverviewJobs') }),
)
const referenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('conversation'), id: learnIdSchema<'conversations'>() }),
  z.strictObject({ kind: z.literal('folder'), id: learnIdSchema<'folders'>() }),
  z.strictObject({ kind: z.literal('document'), id: learnIdSchema<'documents'>() }),
  z.strictObject({ kind: z.literal('source_snapshot'), id: learnIdSchema<'learnSourceSnapshots'>() }),
  z.strictObject({ kind: z.literal('learning_void'), id: learnIdSchema<'learningVoids'>() }),
  z.strictObject({ kind: z.literal('thread'), id: learnIdSchema<'learningThreads'>() }),
  z.strictObject({ kind: z.literal('audio_overview'), id: learnIdSchema<'audioOverviews'>() }),
  z.strictObject({ kind: z.literal('audio_job'), id: learnIdSchema<'audioOverviewJobs'>() }),
])
export const admitHelpArgs = {
  version: v.literal(LEARN_HELP_ADMISSION_VERSION), kind, idempotencyKey: v.string(),
  scope: v.union(v.null(), v.object({ references: v.array(helpReference) })),
}
export const admitHelpSchema = z.strictObject({
  version: z.literal(LEARN_HELP_ADMISSION_VERSION), kind: z.enum(['chat', 'search', 'source', 'audio', 'replay']),
  idempotencyKey: learnResponseIdempotencyKeySchema,
  scope: z.strictObject({ references: z.array(referenceSchema).min(1).max(LEARN_HELP_LIMITS.references) }).nullable(),
})
export const helpAdmissionValidator = v.union(
  v.object({ version: v.literal(LEARN_HELP_ADMISSION_VERSION), status: v.literal('ordinary') }),
  v.object({ version: v.literal(LEARN_HELP_ADMISSION_VERSION), status: v.literal('authorized'), authorizations: v.array(v.object({
    assessmentOpportunityId: v.id('learnAssessmentOpportunities'), authorizationId: v.id('learnAssessmentExposures'),
  })) }),
  v.object({ version: v.literal(LEARN_HELP_ADMISSION_VERSION), status: v.literal('denied'),
    reasonCode: v.union(v.literal('test_open'), v.literal('disclosure_unknown'), v.literal('unavailable')) }),
)
export type LearnHelpAdmission = Infer<typeof helpAdmissionValidator>
export type LearnHelpRequest = z.infer<typeof admitHelpSchema>
export type LearnHelpReference = Infer<typeof helpReference>

// Existing route keys may contain colons or be shorter than the new command
// format. Preserve their identity without storing the original key or payload.
export async function helpAdmissionKey(namespace: string, key: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([LEARN_HELP_ADMISSION_VERSION, namespace, key]))))
  return `help_${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}
