import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval('cleanup terminal tasks', { hours: 1 }, internal.tasks.cleanupTerminalTasks, {})
crons.interval('check missed calendar sessions', { hours: 1 }, internal.calendarEvents.checkMissedSessions, {})

export default crons
