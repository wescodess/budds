import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval('cleanup terminal tasks', { hours: 1 }, internal.tasks.cleanupTerminalTasks, {})
crons.interval('cleanup audio overview uploads', { hours: 1 }, internal.audioOverviewUploads.cleanupExpired, {})
crons.interval('reconcile stale audio overview jobs', { minutes: 30 }, internal.audioOverviewJobs.reconcileStale, {})
crons.interval('cleanup terminal audio overview jobs', { hours: 1 }, internal.audioOverviewJobs.cleanupTerminalJobs, {})
crons.interval('check missed calendar sessions', { hours: 1 }, internal.calendarEvents.checkMissedSessions, {})
crons.interval('rescue calendar event cleanup', { minutes: 5 }, internal.calendarEventCleanup.sweepDue, {})
crons.interval('purge terminal calendar event cleanup', { hours: 1 }, internal.calendarEventCleanup.purgeTerminal, {})
crons.interval('rescue pending external cleanup', { hours: 6 }, internal.accountDeletion.sweepPendingCleanup, {})
crons.interval('resume stale account deletion jobs', { minutes: 15 }, internal.accountDeletion.resumeStaleDeletionJobs, {})
crons.interval('resume stale course deletion jobs', { minutes: 15 }, internal.courseDeletion.resumeStale, {})
crons.interval('cleanup distributed rate limits', { hours: 1 }, internal.rateLimits.cleanupExpired, {})

export default crons
