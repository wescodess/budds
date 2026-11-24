import { makeFunctionReference } from 'convex/server'
import type { TestConvex } from 'convex-test'
import { expect, vi } from 'vitest'
import crons from '../../convex/crons'
import type schema from '../../convex/schema'

export function learnDueCron() {
  const exported = Reflect.get(crons, 'export')
  if (typeof exported !== 'function') throw new Error('Cron registration is unavailable')
  const jobs = JSON.parse(exported.call(crons)) as Record<string, { name: string, args: Record<string, never>[], schedule: unknown }>
  const job = jobs['materialize Learn V2 delayed checks']
  expect(job, 'The due-work cron must be registered').toBeDefined()
  expect(job!.schedule).toEqual({ type: 'interval', minutes: 1 })
  return { reference: makeFunctionReference<'mutation'>(job!.name), args: job!.args[0] }
}

export async function runLearnDueCron(t: TestConvex<typeof schema>) {
  const job = learnDueCron()
  const result = await t.mutation(job.reference, job.args)
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
  return result
}
