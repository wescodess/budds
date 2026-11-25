import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { hasMeasurementReadContext } from './learnV2MeasurementReadContext'
import { privacyRead } from './learnV2PrivacyReadContext'

type ReadCtx = Pick<QueryCtx, 'db'>

export async function readMeasurementClaims(ctx: ReadCtx, userId: string, itemId: Id<'learnMeasurementItems'>, limit: number) {
  const read = (scoped: ReadCtx) => scoped.db.query('learnMeasurementClaims')
    .withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', itemId)).take(limit + 1)
  return hasMeasurementReadContext(ctx, userId) ? await privacyRead(ctx, userId, ['measurement-claims', itemId, limit], [], read) : await read(ctx)
}

export async function readMeasurementSupports(ctx: ReadCtx, userId: string, claimId: Id<'learnMeasurementClaims'>, limit: number) {
  const read = (scoped: ReadCtx) => scoped.db.query('learnMeasurementSupports')
    .withIndex('by_userId_and_claimId', q => q.eq('userId', userId).eq('claimId', claimId)).take(limit + 1)
  return hasMeasurementReadContext(ctx, userId) ? await privacyRead(ctx, userId, ['measurement-supports', claimId, limit], [], read) : await read(ctx)
}
