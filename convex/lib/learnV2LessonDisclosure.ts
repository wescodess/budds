import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { readTeachingDisclosureChecks } from './learnV2HelpAdmission'
import { unavailableScope } from './learnV2TeachingReads'
import { teachingReadScope } from './learnV2TeachingReadScope'

type ReadCtx = QueryCtx | MutationCtx

export async function lessonTeachingScope(ctx: QueryCtx, userId: string, studySessionId: Id<'studySessions'>) {
  return await teachingReadScope(ctx, userId, [{ kind: 'session', id: studySessionId }])
}

export async function lessonBaselineSessionContent(ctx: ReadCtx, userId: string, studySessionId: Id<'studySessions'>) {
  const session = await ctx.db.get(studySessionId)
  return session?.userId === userId && session.status === 'in_progress' && session.assessmentPurpose === 'independent_application'
    ? session.startedSessionContentId ?? null : null
}

export async function readLessonDisclosureChecks(ctx: ReadCtx, userId: string, studySessionId: Id<'studySessions'>) {
  return await readTeachingDisclosureChecks(ctx, userId, await lessonBaselineSessionContent(ctx, userId, studySessionId), async () => {
    const scope = await lessonTeachingScope(ctx, userId, studySessionId).catch(unavailableScope)
    return scope?.references.length ? scope : null
  })
}
