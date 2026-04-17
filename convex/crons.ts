import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval('cleanup terminal tasks', { hours: 1 }, internal.tasks.cleanupTerminalTasks, {})

export default crons
