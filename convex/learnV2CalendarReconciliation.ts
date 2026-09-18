import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { hasLearnV2Access, requireLearnV2MutationAccess, requireLearnV2QueryAccess } from './lib/learnV2Access'
import { getCalendarAccessToken } from './lib/calendarTokenRuntime'

const GOOGLE_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GOOGLE_WATCH = `${GOOGLE_EVENTS}/watch`
const PAGE_SIZE = 100
const MAX_PAGES = 10
const LEASE_MS = 60_000
const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60_000

function enabled() { return process.env.LEARN_V2_CALENDAR_ENABLED === 'true' }
async function opaqueTokenHash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function required(connection: Doc<'calendarConnections'>) {
  return connection.status === 'connected' && connection.learnV2ConsentVersion === 1
    && connection.grantedScopes?.includes('https://www.googleapis.com/auth/calendar.events.owned')
    && connection.grantedScopes?.includes('https://www.googleapis.com/auth/calendar.events.freebusy')
}

export const listProposals = query({ args: {}, handler: async ctx => {
  const userId = await requireLearnV2QueryAccess(ctx)
  if (!enabled()) return []
  const rows = await ctx.db.query('calendarReconciliationProposals').withIndex('by_userId_and_status_and_expiresAt', q => q.eq('userId', userId).eq('status', 'open').gt('expiresAt', Date.now())).take(50)
  return rows.map(row => ({ _id: row._id, kind: row.kind, proposedStartAt: row.proposedStartAt, proposedEndAt: row.proposedEndAt, expiresAt: row.expiresAt, createdAt: row.createdAt }))
} })

export const rejectProposal = mutation({ args: { proposalId: v.id('calendarReconciliationProposals') }, handler: async (ctx, args) => {
  const userId = await requireLearnV2MutationAccess(ctx)
  const row = await ctx.db.get(args.proposalId)
  if (!row || row.userId !== userId || row.status !== 'open') throw new Error('Calendar reconciliation proposal not found')
  if (row.expiresAt <= Date.now()) throw new Error('Calendar proposal is expired; review the current Budds plan')
  const projection = await ctx.db.get(row.projectionId)
  const session = projection ? await ctx.db.get(projection.studySessionId) : null
  const plan = projection?.studyPlanRevisionId ? await ctx.db.get(projection.studyPlanRevisionId) : null
  if (!projection || !session || !plan || projection.userId !== userId || session.revision !== row.expectedSessionRevision || (plan.recordRevision ?? 1) !== row.expectedPlanRecordRevision) throw new Error('Calendar proposal is stale; review the current Budds plan')
  // Rejecting a provider suggestion does not recreate the Google event. Keep
  // the projection visibly needing reconciliation while Budds remains intact.
  await ctx.db.patch(row._id, { status: 'rejected', resolvedAt: Date.now(), updatedAt: Date.now() })
  return { resolved: 'rejected' as const }
} })

// There is deliberately no apply command: existing plan commands do not offer
// a revision-safe external-event patch. An owner must resolve in Budds.
export const getConnectionForSync = internalQuery({ args: { userId: v.string() }, handler: async (ctx, args) => {
  if (!enabled() || !(await hasLearnV2Access(ctx, args.userId))) throw new Error('Learn V2 calendar access denied')
  const connection = await ctx.db.query('calendarConnections').withIndex('by_userId', q => q.eq('userId', args.userId)).first()
  if (!connection || !required(connection)) throw new Error('Google Calendar re-consent is required')
  return connection
} })

export const getMaintenanceCandidates = internalQuery({ args: { cursor: v.union(v.string(), v.null()) }, handler: async (ctx, args) => {
  if (!enabled()) return { candidates: [], isDone: true, continueCursor: '' }
  const page = await ctx.db.query('calendarConnections').withIndex('by_status', q => q.eq('status', 'connected')).paginate({ cursor: args.cursor, numItems: 25 })
  const candidates: Array<{ userId: string, calendarConnectionId: Doc<'calendarConnections'>['_id'], renew: boolean }> = []
  for (const connection of page.page) {
    if (!(await hasLearnV2Access(ctx, connection.userId)) || !required(connection)) continue
    candidates.push({ userId: connection.userId, calendarConnectionId: connection._id, renew: !connection.learnV2WatchExpiresAt || connection.learnV2WatchExpiresAt < Date.now() + 24 * 60 * 60_000 })
  }
  return { candidates, isDone: page.isDone, continueCursor: page.continueCursor }
} })

export const reserveSync = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections'), leaseToken: v.string() }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.calendarConnectionId)
  if (!row || !required(row)) return false
  const now = Date.now()
  if ((row.learnV2WatchLeaseExpiresAt ?? 0) > now) return false
  await ctx.db.patch(row._id, { learnV2WatchLeaseToken: args.leaseToken, learnV2WatchLeaseExpiresAt: now + LEASE_MS })
  return true
} })

export const releaseSync = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections'), leaseToken: v.string() }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.calendarConnectionId)
  if (row?.learnV2WatchLeaseToken === args.leaseToken) await ctx.db.patch(row._id, { learnV2WatchLeaseToken: undefined, learnV2WatchLeaseExpiresAt: undefined })
} })

export const commitWatch = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections'), leaseToken: v.string(), channelId: v.string(), resourceId: v.string(), tokenHash: v.string(), expiresAt: v.number() }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.calendarConnectionId)
  if (!row || row.learnV2WatchLeaseToken !== args.leaseToken || !required(row) || !(await hasLearnV2Access(ctx, row.userId))) return false
  const previous = await ctx.db.query('calendarWatchChannels').withIndex('by_calendarConnectionId_and_status', q => q.eq('calendarConnectionId', row._id).eq('status', 'current')).first()
  const now = Date.now()
  if (previous) await ctx.db.patch(previous._id, { status: 'pending_stop', updatedAt: now })
  await ctx.db.insert('calendarWatchChannels', { userId: row.userId, calendarConnectionId: row._id, channelId: args.channelId, resourceId: args.resourceId, tokenHash: args.tokenHash, expiresAt: args.expiresAt, status: 'current', createdAt: now, updatedAt: now })
  await ctx.db.patch(row._id, { learnV2WatchChannelId: args.channelId, learnV2WatchResourceId: args.resourceId, learnV2WatchTokenHash: args.tokenHash, learnV2WatchExpiresAt: args.expiresAt, learnV2WatchLeaseToken: undefined, learnV2WatchLeaseExpiresAt: undefined })
  return true
} })

export const clearStoppedWatch = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections') }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.calendarConnectionId)
  if (row) await ctx.db.patch(row._id, { learnV2WatchChannelId: undefined, learnV2WatchResourceId: undefined, learnV2WatchTokenHash: undefined, learnV2WatchExpiresAt: undefined })
} })

export const getWatchStopBatch = internalQuery({ args: { calendarConnectionId: v.id('calendarConnections'), includeCurrent: v.boolean() }, handler: async (ctx, args) => {
  const current = args.includeCurrent ? await ctx.db.query('calendarWatchChannels').withIndex('by_calendarConnectionId_and_status', q => q.eq('calendarConnectionId', args.calendarConnectionId).eq('status', 'current')).take(25) : []
  const pending = current.length < 25 ? await ctx.db.query('calendarWatchChannels').withIndex('by_calendarConnectionId_and_status', q => q.eq('calendarConnectionId', args.calendarConnectionId).eq('status', 'pending_stop')).take(25 - current.length) : []
  return [...current, ...pending]
} })

export const markWatchStopped = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections'), channelId: v.string() }, handler: async (ctx, args) => {
  const row = await ctx.db.query('calendarWatchChannels').withIndex('by_calendarConnectionId_and_channelId', q => q.eq('calendarConnectionId', args.calendarConnectionId).eq('channelId', args.channelId)).unique()
  if (!row) return false
  await ctx.db.patch(row._id, { status: 'stopped', updatedAt: Date.now() })
  return true
} })

export const stopPendingWatches = internalAction({ args: { userId: v.string(), calendarConnectionId: v.id('calendarConnections') }, handler: async (ctx, args) => {
  const connection: Doc<'calendarConnections'> | null = await ctx.runQuery(internal.calendarConnections.getConnectionByIdForCleanup, { calendarConnectionId: args.calendarConnectionId })
  if (!connection || connection.userId !== args.userId) return { stopped: 0, failed: 0 }
  const token = await getCalendarAccessToken(ctx, args.userId, connection)
  const rows: Doc<'calendarWatchChannels'>[] = await ctx.runQuery(internal.learnV2CalendarReconciliation.getWatchStopBatch, { calendarConnectionId: connection._id, includeCurrent: false })
  let stopped = 0; let failed = 0
  for (const row of rows) {
    try {
      const response = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.channelId, resourceId: row.resourceId }), signal: AbortSignal.timeout(15_000) })
      if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(String(response.status))
      await ctx.runMutation(internal.learnV2CalendarReconciliation.markWatchStopped, { calendarConnectionId: connection._id, channelId: row.channelId })
      stopped++
    } catch { failed++ }
  }
  return { stopped, failed }
} })

export const markAttention = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections'), reason: v.union(v.literal('token_expired'), v.literal('revoked'), v.literal('scope_lost')) }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.calendarConnectionId)
  if (row) await ctx.db.patch(row._id, { learnV2AttentionRequiredAt: Date.now(), learnV2AttentionReason: args.reason })
} })

export const commitSyncToken = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections'), leaseToken: v.string(), nextSyncToken: v.optional(v.string()), reset: v.boolean() }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.calendarConnectionId)
  if (!row || row.learnV2WatchLeaseToken !== args.leaseToken) return false
  await ctx.db.patch(row._id, { learnV2SyncToken: args.reset ? undefined : args.nextSyncToken, learnV2SyncPageToken: undefined, learnV2SyncFullResync: args.reset || undefined, learnV2SyncQueryVersion: 1, learnV2WatchLeaseToken: undefined, learnV2WatchLeaseExpiresAt: undefined })
  return true
} })

export const checkpointSyncPage = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections'), leaseToken: v.string(), pageToken: v.string(), fullResync: v.boolean() }, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.calendarConnectionId)
  if (!row || row.learnV2WatchLeaseToken !== args.leaseToken) return false
  await ctx.db.patch(row._id, { learnV2SyncPageToken: args.pageToken, learnV2SyncFullResync: args.fullResync || undefined, learnV2WatchLeaseToken: undefined, learnV2WatchLeaseExpiresAt: undefined })
  return true
} })

export const recordExternalChange = internalMutation({ args: { calendarConnectionId: v.id('calendarConnections'), externalEventId: v.string(), kind: v.union(v.literal('moved'), v.literal('deleted'), v.literal('conflict')), providerUpdatedAt: v.optional(v.number()), proposedStartAt: v.optional(v.number()), proposedEndAt: v.optional(v.number()) }, handler: async (ctx, args) => {
  const connection = await ctx.db.get(args.calendarConnectionId)
  if (!connection) return null
  const projection = await ctx.db.query('calendarProjections').withIndex('by_userId_and_provider_and_externalEventId', q => q.eq('userId', connection.userId).eq('provider', 'google').eq('externalEventId', args.externalEventId)).unique()
  if (!projection || projection.calendarConnectionId !== connection._id || !['projected', 'reconciliation_needed'].includes(projection.status)) return null
  const providerUpdatedAt = args.providerUpdatedAt ?? Date.now()
  if ((projection.lastProviderUpdatedAt ?? 0) >= providerUpdatedAt) return null
  const session = await ctx.db.get(projection.studySessionId)
  if (!session || session.userId !== connection.userId) return null
  if (args.kind === 'moved' && (args.proposedStartAt === undefined || args.proposedEndAt === undefined || args.proposedEndAt <= args.proposedStartAt)) return null
  const authoritativeEnd = session.scheduledEndAt ?? session.scheduledStartAt + 30 * 60_000
  if (args.kind === 'moved' && args.proposedStartAt === session.scheduledStartAt && args.proposedEndAt === authoritativeEnd) {
    await ctx.db.patch(projection._id, { lastProviderUpdatedAt: providerUpdatedAt, updatedAt: Date.now() })
    return null
  }
  const existing = await ctx.db.query('calendarReconciliationProposals').withIndex('by_projectionId_and_status', q => q.eq('projectionId', projection._id).eq('status', 'open')).first()
  if (existing && existing.expiresAt <= Date.now()) {
    await ctx.db.patch(existing._id, { status: 'expired', resolvedAt: Date.now(), updatedAt: Date.now() })
  }
  if (existing && existing.expiresAt > Date.now()) {
    // A newer deletion supersedes an unreviewed move; a newer move refreshes
    // its redacted times without creating an unbounded proposal trail.
    await ctx.db.patch(existing._id, { kind: args.kind, providerUpdatedAt, proposedStartAt: args.kind === 'moved' ? args.proposedStartAt : undefined, proposedEndAt: args.kind === 'moved' ? args.proposedEndAt : undefined, updatedAt: Date.now() })
    await ctx.db.patch(projection._id, { status: 'reconciliation_needed', lastProviderUpdatedAt: providerUpdatedAt, updatedAt: Date.now() })
    return existing._id
  }
  const plan = projection.studyPlanRevisionId ? await ctx.db.get(projection.studyPlanRevisionId) : null
  if (!plan) return null
  const now = Date.now()
  await ctx.db.patch(projection._id, { status: 'reconciliation_needed', updatedAt: now, lastProviderUpdatedAt: providerUpdatedAt })
  return await ctx.db.insert('calendarReconciliationProposals', { userId: connection.userId, calendarConnectionId: connection._id, projectionId: projection._id, kind: args.kind, status: 'open', expectedPlanRecordRevision: plan.recordRevision ?? 1, expectedSessionRevision: projection.pinnedSessionRevision ?? 1, providerUpdatedAt, ...(args.kind === 'moved' ? { proposedStartAt: args.proposedStartAt, proposedEndAt: args.proposedEndAt } : {}), expiresAt: now + PROPOSAL_TTL_MS, createdAt: now, updatedAt: now })
} })

export const acceptWebhookHint = internalMutation({ args: { channelId: v.string(), resourceId: v.string(), token: v.string(), messageNumber: v.string(), state: v.string() }, handler: async (ctx, args) => {
  if (!enabled() || (args.state !== 'exists' && args.state !== 'sync') || args.channelId.length > 256 || args.resourceId.length > 512 || args.token.length > 512 || args.messageNumber.length > 20 || !/^\d+$/.test(args.messageNumber)) return null
  const messageNumberOrder = args.messageNumber.replace(/^0+/, '').padStart(20, '0')
  const connection = await ctx.db.query('calendarConnections').withIndex('by_learnV2WatchChannelId', q => q.eq('learnV2WatchChannelId', args.channelId)).unique()
  // A previous overlapping renewal channel is intentionally stale: it may
  // still deliver but cannot advance the current connection cursor.
  if (!connection || !required(connection) || !(await hasLearnV2Access(ctx, connection.userId)) || connection.learnV2WatchResourceId !== args.resourceId
    || connection.learnV2WatchTokenHash !== await opaqueTokenHash(args.token)) return null
  const active = await ctx.db.query('calendarWatchChannels').withIndex('by_calendarConnectionId_and_channelId', q => q.eq('calendarConnectionId', connection._id).eq('channelId', args.channelId)).unique()
  if (!active || active.status !== 'current' || active.resourceId !== args.resourceId || active.tokenHash !== connection.learnV2WatchTokenHash) return null
  const replay = await ctx.db.query('calendarWebhookReceipts').withIndex('by_calendarConnectionId_and_channelId_and_messageNumber', q => q.eq('calendarConnectionId', connection._id).eq('channelId', args.channelId).eq('messageNumber', args.messageNumber)).unique()
  if (replay) return null
  const latest = await ctx.db.query('calendarWebhookReceipts').withIndex('by_calendarConnectionId_and_channelId_and_messageNumberOrder', q => q.eq('calendarConnectionId', connection._id).eq('channelId', args.channelId)).order('desc').first()
  if (latest && messageNumberOrder <= latest.messageNumberOrder) return null
  await ctx.db.insert('calendarWebhookReceipts', { userId: connection.userId, calendarConnectionId: connection._id, channelId: args.channelId, messageNumber: args.messageNumber, messageNumberOrder, receivedAt: Date.now() })
  return { userId: connection.userId, calendarConnectionId: connection._id }
} })

export const syncConnection = internalAction({ args: { userId: v.string(), calendarConnectionId: v.id('calendarConnections'), pageToken: v.optional(v.string()), fullResync: v.optional(v.boolean()) }, handler: async (ctx, args) => {
  const connection: Doc<'calendarConnections'> = await ctx.runQuery(internal.learnV2CalendarReconciliation.getConnectionForSync, { userId: args.userId })
  if (connection._id !== args.calendarConnectionId) return { kind: 'stale' as const }
  const leaseToken = crypto.randomUUID()
  if (!await ctx.runMutation(internal.learnV2CalendarReconciliation.reserveSync, { calendarConnectionId: connection._id, leaseToken })) return { kind: 'busy' as const }
  try {
    let token: string
    try { token = await getCalendarAccessToken(ctx, args.userId, connection) }
    catch (error) { await ctx.runMutation(internal.learnV2CalendarReconciliation.markAttention, { calendarConnectionId: connection._id, reason: 'token_expired' }); await ctx.runMutation(internal.learnV2CalendarReconciliation.releaseSync, { calendarConnectionId: connection._id, leaseToken }); throw error }
    const fullResync = args.fullResync === true || connection.learnV2SyncFullResync === true
    const hadSyncToken = !fullResync && Boolean(connection.learnV2SyncToken)
    let pageToken: string | undefined = args.pageToken ?? connection.learnV2SyncPageToken
    let nextSyncToken: string | undefined
    let reset = false
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ maxResults: String(PAGE_SIZE), showDeleted: 'true', singleEvents: 'true' })
      if (!fullResync && connection.learnV2SyncToken) params.set('syncToken', connection.learnV2SyncToken)
      if (pageToken) params.set('pageToken', pageToken)
      const response = await fetch(`${GOOGLE_EVENTS}?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
      if (response.status === 410) { reset = true; break }
      if (response.status === 401 || response.status === 403) { await ctx.runMutation(internal.learnV2CalendarReconciliation.markAttention, { calendarConnectionId: connection._id, reason: response.status === 401 ? 'token_expired' : 'scope_lost' }); await ctx.runMutation(internal.learnV2CalendarReconciliation.releaseSync, { calendarConnectionId: connection._id, leaseToken }); return { kind: 'attention' as const } }
      if (!response.ok) throw new Error(`Google Calendar incremental sync failed with status ${response.status}`)
      const body = await response.json() as { items?: Array<{ id?: string, status?: string, updated?: string, start?: { dateTime?: string }, end?: { dateTime?: string } }>, nextPageToken?: string, nextSyncToken?: string }
      for (const item of body.items ?? []) if (item.id) {
        const updated = item.updated ? Date.parse(item.updated) : NaN
        const start = item.start?.dateTime ? Date.parse(item.start.dateTime) : NaN
        const end = item.end?.dateTime ? Date.parse(item.end.dateTime) : NaN
        const kind = item.status === 'cancelled' ? 'deleted' : (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ? 'conflict' : 'moved')
        await ctx.runMutation(internal.learnV2CalendarReconciliation.recordExternalChange, { calendarConnectionId: connection._id, externalEventId: item.id, kind, ...(Number.isFinite(updated) ? { providerUpdatedAt: updated } : {}), ...(Number.isFinite(start) ? { proposedStartAt: start } : {}), ...(Number.isFinite(end) ? { proposedEndAt: end } : {}) })
      }
      pageToken = body.nextPageToken; nextSyncToken = body.nextSyncToken ?? nextSyncToken
      if (!pageToken) break
    }
    if (pageToken && !reset) {
      const checkpointed = await ctx.runMutation(internal.learnV2CalendarReconciliation.checkpointSyncPage, { calendarConnectionId: connection._id, leaseToken, pageToken, fullResync })
      if (checkpointed) await ctx.scheduler.runAfter(0, internal.learnV2CalendarReconciliation.syncConnection, { userId: args.userId, calendarConnectionId: connection._id, pageToken, fullResync })
      return { kind: 'checkpointed' as const }
    }
    if (!reset && !nextSyncToken) throw new Error('Google Calendar sync did not provide a final sync token')
    await ctx.runMutation(internal.learnV2CalendarReconciliation.commitSyncToken, { calendarConnectionId: connection._id, leaseToken, nextSyncToken, reset })
    if (reset && hadSyncToken) await ctx.scheduler.runAfter(0, internal.learnV2CalendarReconciliation.syncConnection, { userId: args.userId, calendarConnectionId: connection._id, fullResync: true })
    return { kind: reset ? 'reset' as const : 'synced' as const }
  } catch (error) { await ctx.runMutation(internal.learnV2CalendarReconciliation.releaseSync, { calendarConnectionId: connection._id, leaseToken }); throw error }
} })

export const renewWatch = internalAction({ args: { userId: v.string(), calendarConnectionId: v.id('calendarConnections') }, handler: async (ctx, args) => {
  const connection: Doc<'calendarConnections'> = await ctx.runQuery(internal.learnV2CalendarReconciliation.getConnectionForSync, { userId: args.userId })
  if (connection._id !== args.calendarConnectionId) return { kind: 'stale' as const }
  const leaseToken = crypto.randomUUID()
  if (!await ctx.runMutation(internal.learnV2CalendarReconciliation.reserveSync, { calendarConnectionId: connection._id, leaseToken })) return { kind: 'busy' as const }
  try {
    const address = process.env.LEARN_V2_CALENDAR_WEBHOOK_URL
    if (!address) throw new Error('Google Calendar webhook URL is not configured')
    const token = crypto.randomUUID()
    const channelId = crypto.randomUUID()
    let accessToken: string
    try { accessToken = await getCalendarAccessToken(ctx, args.userId, connection) }
    catch (error) { await ctx.runMutation(internal.learnV2CalendarReconciliation.markAttention, { calendarConnectionId: connection._id, reason: 'token_expired' }); await ctx.runMutation(internal.learnV2CalendarReconciliation.releaseSync, { calendarConnectionId: connection._id, leaseToken }); throw error }
    const response = await fetch(GOOGLE_WATCH, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: channelId, type: 'web_hook', address, token }), signal: AbortSignal.timeout(20_000) })
    if (response.status === 401 || response.status === 403) { await ctx.runMutation(internal.learnV2CalendarReconciliation.markAttention, { calendarConnectionId: connection._id, reason: response.status === 401 ? 'token_expired' : 'scope_lost' }); await ctx.runMutation(internal.learnV2CalendarReconciliation.releaseSync, { calendarConnectionId: connection._id, leaseToken }); return { kind: 'attention' as const } }
    if (!response.ok) throw new Error(`Google Calendar watch failed with status ${response.status}`)
    const body = await response.json() as { resourceId?: string, expiration?: string }
    if (!body.resourceId || !body.expiration || !Number.isFinite(Number(body.expiration))) throw new Error('Google Calendar watch returned an invalid channel')
    const committed = await ctx.runMutation(internal.learnV2CalendarReconciliation.commitWatch, { calendarConnectionId: connection._id, leaseToken, channelId, resourceId: body.resourceId, tokenHash: await opaqueTokenHash(token), expiresAt: Number(body.expiration) })
    if (!committed) {
      await fetch('https://www.googleapis.com/calendar/v3/channels/stop', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: channelId, resourceId: body.resourceId }), signal: AbortSignal.timeout(15_000) }).catch(() => undefined)
      return { kind: 'busy' as const }
    }
    // Renewal overlaps by design. The replacement is durable before the old
    // channel is stopped, so a failed best-effort stop cannot create a gap.
    if (connection.learnV2WatchChannelId && connection.learnV2WatchResourceId) {
      const stopped = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: connection.learnV2WatchChannelId, resourceId: connection.learnV2WatchResourceId }), signal: AbortSignal.timeout(15_000) }).catch(() => null)
      if (stopped && (stopped.ok || stopped.status === 404 || stopped.status === 410)) await ctx.runMutation(internal.learnV2CalendarReconciliation.markWatchStopped, { calendarConnectionId: connection._id, channelId: connection.learnV2WatchChannelId })
    }
    return { kind: 'watching' as const }
  } catch (error) { await ctx.runMutation(internal.learnV2CalendarReconciliation.releaseSync, { calendarConnectionId: connection._id, leaseToken }); throw error }
} })

export const expireProposals = internalMutation({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query('calendarReconciliationProposals').withIndex('by_status_and_expiresAt', q => q.eq('status', 'open').lt('expiresAt', Date.now())).take(100)
  for (const row of rows) await ctx.db.patch(row._id, { status: 'expired', resolvedAt: Date.now(), updatedAt: Date.now() })
  return rows.length
} })

export const purgeWebhookReceipts = internalMutation({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query('calendarWebhookReceipts').withIndex('by_receivedAt', q => q.lt('receivedAt', Date.now() - 7 * 24 * 60 * 60_000)).take(100)
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length
} })

export const purgeStoppedWatches = internalMutation({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query('calendarWatchChannels').withIndex('by_status', q => q.eq('status', 'stopped')).take(100)
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length
} })

export const maintainConnections = internalAction({ args: { cursor: v.union(v.string(), v.null()) }, handler: async (ctx, args) => {
  if (!enabled()) return { scheduled: 0, isDone: true }
  const page: { candidates: Array<{ userId: string, calendarConnectionId: Doc<'calendarConnections'>['_id'], renew: boolean }>, isDone: boolean, continueCursor: string } = await ctx.runQuery(internal.learnV2CalendarReconciliation.getMaintenanceCandidates, { cursor: args.cursor })
  let scheduled = 0
  for (const candidate of page.candidates) {
    await ctx.scheduler.runAfter(0, internal.learnV2CalendarReconciliation.syncConnection, { userId: candidate.userId, calendarConnectionId: candidate.calendarConnectionId })
    if (candidate.renew) await ctx.scheduler.runAfter(1_000, internal.learnV2CalendarReconciliation.renewWatch, { userId: candidate.userId, calendarConnectionId: candidate.calendarConnectionId })
    await ctx.scheduler.runAfter(2_000, internal.learnV2CalendarReconciliation.stopPendingWatches, { userId: candidate.userId, calendarConnectionId: candidate.calendarConnectionId })
    scheduled++
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.learnV2CalendarReconciliation.maintainConnections, { cursor: page.continueCursor })
  return { scheduled, isDone: page.isDone }
} })
