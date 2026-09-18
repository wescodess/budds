import { v } from 'convex/values'
import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { requireAuth } from './lib/auth'
import { hasLearnV2Access, requireLearnV2QueryAccess } from './lib/learnV2Access'
import { getCalendarAccessToken } from './lib/calendarTokenRuntime'

const GOOGLE_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GOOGLE_FREE_BUSY = 'https://www.googleapis.com/calendar/v3/freeBusy'
const REQUIRED_SCOPES = new Set([
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
])
const MAX_PROJECTIONS = 100
const PROVIDER_CREATE_LEASE_MS = 60_000

export async function deterministicGoogleProjectionId(input: string): Promise<string> {
  // Google accepts lower-case base32hex identifiers. A cryptographic digest
  // avoids exposing any Convex identity while preserving retry identity.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))
  const alphabet = '0123456789abcdefghijklmnopqrstuv'
  let bits = 0; let value = 0; let encoded = ''
  for (const byte of digest) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { encoded += alphabet[(value >>> (bits - 5)) & 31]!; bits -= 5 }
  }
  if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31]!
  return `b${encoded.slice(0, 51)}`
}

function v2CalendarEnabled() { return process.env.LEARN_V2_CALENDAR_ENABLED === 'true' }
function hasRequiredConsent(connection: Doc<'calendarConnections'> | null) {
  return connection?.status === 'connected'
    && connection.learnV2ConsentVersion === 1
    && [...REQUIRED_SCOPES].every(scope => connection.grantedScopes?.includes(scope))
}

export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    if (!v2CalendarEnabled()) return { enabled: false, connection: 'not_connected' as const, provider: null }
    const connection = await ctx.db.query('calendarConnections').withIndex('by_userId', q => q.eq('userId', userId)).first()
    return {
      enabled: true,
      connection: !connection ? 'not_connected' as const : hasRequiredConsent(connection) ? 'ready' as const : 'reconsent_required' as const,
      provider: connection?.provider ?? null,
    }
  },
})

export const listProjections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    if (!v2CalendarEnabled()) return []
    const rows = await ctx.db.query('calendarProjections').withIndex('by_userId', q => q.eq('userId', userId)).take(MAX_PROJECTIONS)
    return rows.map(row => ({
      _id: row._id,
      studySessionId: row.studySessionId,
      status: row.status,
      pinnedPlanRevision: row.pinnedPlanRevision,
      pinnedSessionRevision: row.pinnedSessionRevision,
      projectedAt: row.projectedAt,
      updatedAt: row.updatedAt,
    }))
  },
})

export const getProjectionInput = internalQuery({
  args: { userId: v.string(), studySessionId: v.id('studySessions') },
  handler: async (ctx, args) => {
    if (!v2CalendarEnabled() || !(await hasLearnV2Access(ctx, args.userId))) throw new Error('Learn V2 calendar access denied')
    const connection = await ctx.db.query('calendarConnections').withIndex('by_userId', q => q.eq('userId', args.userId)).first()
    if (!connection || !hasRequiredConsent(connection)) throw new Error('Google Calendar re-consent is required')
    const session = await ctx.db.get(args.studySessionId)
    if (!session || session.userId !== args.userId) throw new Error('Study session not found')
    if (!['planned', 'ready'].includes(session.status) || session.scheduledStartAt <= Date.now()) throw new Error('Study session is not eligible for calendar projection')
    const plan = await ctx.db.get(session.studyPlanRevisionId)
    if (!plan || plan.userId !== args.userId || !['accepted', 'active'].includes(plan.status)) throw new Error('Accepted Study Plan revision not found')
    const existing = await ctx.db.query('calendarProjections').withIndex('by_userId_and_studySessionId', q => q.eq('userId', args.userId).eq('studySessionId', session._id)).unique()
    return { connection, session, plan, existing }
  },
})

export const reserveProjection = internalMutation({
  args: { userId: v.string(), studySessionId: v.id('studySessions'), externalEventId: v.string() },
  handler: async (ctx, args) => {
    if (!v2CalendarEnabled() || !(await hasLearnV2Access(ctx, args.userId))) throw new Error('Learn V2 calendar access denied')
    const connection = await ctx.db.query('calendarConnections').withIndex('by_userId', q => q.eq('userId', args.userId)).first()
    if (!connection || !hasRequiredConsent(connection)) throw new Error('Google Calendar re-consent is required')
    const session = await ctx.db.get(args.studySessionId)
    if (!session || session.userId !== args.userId || !['planned', 'ready'].includes(session.status) || session.scheduledStartAt <= Date.now()) throw new Error('Study session is not eligible for calendar projection')
    const plan = await ctx.db.get(session.studyPlanRevisionId)
    if (!plan || plan.userId !== args.userId || !['accepted', 'active'].includes(plan.status)) throw new Error('Accepted Study Plan revision not found')
    if (!/^b[0-9a-v]{20,63}$/.test(args.externalEventId)) throw new Error('Google projection identity is invalid')
    const existing = await ctx.db.query('calendarProjections').withIndex('by_userId_and_studySessionId', q => q.eq('userId', args.userId).eq('studySessionId', session._id)).unique()
    if (existing?.status === 'projected') return { kind: 'already_projected' as const, projection: existing }
    if (existing?.status === 'reconciliation_needed') return { kind: 'conflict' as const, projection: existing }
    if ((existing?.status === 'reserving' && (existing.updatedAt ?? existing._creationTime) > Date.now() - 30_000)
      || (existing?.status === 'creating' && (existing.providerCreateLeaseExpiresAt ?? 0) > Date.now())) {
      return { kind: 'busy' as const, projection: existing }
    }
    const now = Date.now()
    const privateMetadata = JSON.stringify({
      projection: `budds.v1.${args.externalEventId}`,
      plan: plan.revision,
      sessionRevision: session.revision,
    })
    if (existing) {
      await ctx.db.patch(existing._id, {
        calendarConnectionId: connection._id,
        studyPlanRevisionId: plan._id,
        pinnedPlanRevision: plan.revision,
        pinnedSessionRevision: session.revision,
        provider: 'google',
        externalEventId: args.externalEventId,
        status: 'reserving',
        privateMetadata,
        createdAt: existing.createdAt ?? now,
        updatedAt: now,
        providerCreateLeaseToken: undefined,
        providerCreateLeaseExpiresAt: undefined,
      })
      return { kind: 'reserved' as const, projection: await ctx.db.get(existing._id) }
    }
    const id = await ctx.db.insert('calendarProjections', {
      userId: args.userId, calendarConnectionId: connection._id, studySessionId: session._id,
      studyPlanRevisionId: plan._id, pinnedPlanRevision: plan.revision, pinnedSessionRevision: session.revision,
      provider: 'google', externalEventId: args.externalEventId, status: 'reserving',
      privateMetadata,
      createdAt: now, updatedAt: now,
    })
    return { kind: 'reserved' as const, projection: await ctx.db.get(id) }
  },
})

export const claimProviderCreate = internalMutation({
  args: {
    projectionId: v.id('calendarProjections'),
    userId: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const projection = await ctx.db.get(args.projectionId)
    if (!projection || projection.userId !== args.userId || projection.status !== 'reserving') return false
    const connection = projection.calendarConnectionId
      ? await ctx.db.get(projection.calendarConnectionId)
      : null
    if (!connection || connection.userId !== args.userId || !hasRequiredConsent(connection)) return false
    const now = Date.now()
    await ctx.db.patch(projection._id, {
      status: 'creating',
      providerCreateLeaseToken: args.leaseToken,
      providerCreateLeaseExpiresAt: now + PROVIDER_CREATE_LEASE_MS,
      updatedAt: now,
    })
    return true
  },
})

export const commitProjection = internalMutation({
  args: { projectionId: v.id('calendarProjections'), userId: v.string(), leaseToken: v.string(), providerEtag: v.optional(v.string()), providerVersion: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.projectionId)
    if (!row || row.userId !== args.userId || row.status !== 'creating' || row.providerCreateLeaseToken !== args.leaseToken) return null
    const now = Date.now()
    await ctx.db.patch(row._id, { status: 'projected', projectedAt: now, updatedAt: now, lastProviderUpdatedAt: now, providerCreateLeaseToken: undefined, providerCreateLeaseExpiresAt: undefined, ...(args.providerEtag ? { providerEtag: args.providerEtag } : {}), ...(args.providerVersion ? { providerVersion: args.providerVersion } : {}) })
    return row._id
  },
})

export const markProjectionFailed = internalMutation({
  args: { projectionId: v.id('calendarProjections'), userId: v.string(), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.projectionId)
    if (!row || row.userId !== args.userId || row.status !== 'creating' || row.providerCreateLeaseToken !== args.leaseToken) return null
    await ctx.db.patch(row._id, {
      status: 'failed',
      providerCreateLeaseToken: undefined,
      providerCreateLeaseExpiresAt: undefined,
      updatedAt: Date.now(),
    })
    return row._id
  },
})

export const markProjectionReconciliationNeeded = internalMutation({
  args: { projectionId: v.id('calendarProjections'), userId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.projectionId)
    if (!row || row.userId !== args.userId) return null
    await ctx.db.patch(row._id, { status: 'reconciliation_needed', providerCreateLeaseToken: undefined, providerCreateLeaseExpiresAt: undefined, updatedAt: Date.now() })
    return row._id
  },
})

export const projectSession = action({
  args: { studySessionId: v.id('studySessions') },
  handler: async (ctx, args): Promise<{
    kind: 'projected' | 'already_projected' | 'busy' | 'conflict'
    studySessionId: Id<'studySessions'>
    scheduledStartAt?: number
    scheduledEndAt?: number
  }> => {
    const userId = await requireAuth(ctx)
    const input = await ctx.runQuery(internal.learnV2Calendar.getProjectionInput, { userId, studySessionId: args.studySessionId })
    if (input.existing?.status === 'projected') return { kind: 'already_projected', studySessionId: args.studySessionId }
    if (input.existing?.status === 'reconciliation_needed') return { kind: 'conflict', studySessionId: args.studySessionId }
    if ((input.existing?.status === 'reserving'
      && (input.existing.updatedAt ?? input.existing._creationTime) > Date.now() - 30_000)
      || (input.existing?.status === 'creating'
        && (input.existing.providerCreateLeaseExpiresAt ?? 0) > Date.now())) {
      return { kind: 'busy', studySessionId: args.studySessionId }
    }
    const accessToken = await getCalendarAccessToken(ctx, userId, input.connection)
    const start = input.session.scheduledStartAt
    const end = input.session.scheduledEndAt ?? start + 30 * 60_000
    const busy = await fetch(GOOGLE_FREE_BUSY, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), items: [{ id: 'primary' }] }), signal: AbortSignal.timeout(15_000),
    })
    if (!busy.ok) throw new Error(`Google Calendar FreeBusy failed with status ${busy.status}`)
    const busyBody = await busy.json() as { calendars?: { primary?: { busy?: unknown[], errors?: unknown[] } } }
    if ((busyBody.calendars?.primary?.errors?.length ?? 0) > 0) {
      throw new Error('Google Calendar FreeBusy returned a calendar error')
    }
    if ((busyBody.calendars?.primary?.busy?.length ?? 0) > 0) return { kind: 'busy' as const, studySessionId: args.studySessionId }
    const externalEventId = await deterministicGoogleProjectionId(`${input.connection._id}:${input.session._id}:${input.plan.revision}:${input.session.revision}`)
    const reservation = await ctx.runMutation(internal.learnV2Calendar.reserveProjection, { userId, studySessionId: args.studySessionId, externalEventId })
    if (reservation.kind !== 'reserved' || !reservation.projection) return { kind: reservation.kind === 'reserved' ? 'busy' as const : reservation.kind, studySessionId: args.studySessionId }
    const projection = reservation.projection
    const createLeaseToken = crypto.randomUUID()
    if (!await ctx.runMutation(internal.learnV2Calendar.claimProviderCreate, {
      projectionId: projection._id,
      userId,
      leaseToken: createLeaseToken,
    })) return { kind: 'busy' as const, studySessionId: args.studySessionId }
    const siteUrl = process.env.SITE_URL || process.env.NUXT_PUBLIC_SITE_URL || ''
    let response: Response
    try {
      response = await fetch(GOOGLE_EVENTS, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: projection.externalEventId, summary: 'Budds study session',
          description: siteUrl ? `${siteUrl}/app/learn/today` : 'Budds study session',
          start: { dateTime: new Date(start).toISOString(), timeZone: input.connection.timezone },
          end: { dateTime: new Date(end).toISOString(), timeZone: input.connection.timezone },
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
          extendedProperties: { private: { buddsProjection: projection.privateMetadata ?? 'budds.study-session.v1' } },
        }), signal: AbortSignal.timeout(30_000),
      })
    }
    catch (error) {
      await ctx.runMutation(internal.learnV2Calendar.markProjectionFailed, { projectionId: projection._id, userId, leaseToken: createLeaseToken })
      throw error
    }
    if (response.status === 409) {
      await ctx.runMutation(internal.learnV2Calendar.markProjectionReconciliationNeeded, { projectionId: projection._id, userId })
      return { kind: 'conflict' as const, studySessionId: args.studySessionId }
    }
    if (!response.ok) {
      await ctx.runMutation(internal.learnV2Calendar.markProjectionFailed, { projectionId: projection._id, userId, leaseToken: createLeaseToken })
      throw new Error(`Google Calendar create failed with status ${response.status}`)
    }
    const created = await response.json() as { etag?: string, updated?: string }
    const committed = await ctx.runMutation(internal.learnV2Calendar.commitProjection, { projectionId: projection._id, userId, leaseToken: createLeaseToken, providerEtag: created.etag, providerVersion: created.updated })
    if (!committed) {
      await fetch(`${GOOGLE_EVENTS}/${encodeURIComponent(projection.externalEventId!)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined)
      throw new Error('Google Calendar projection could not be committed')
    }
    return { kind: 'projected' as const, studySessionId: args.studySessionId, scheduledStartAt: start, scheduledEndAt: end }
  },
})
