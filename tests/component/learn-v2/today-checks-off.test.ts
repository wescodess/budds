import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { learnTodayCheckRoute } from '#shared/learn-v2-today-check'
import { LEARN_MEASUREMENT_CAPABILITIES } from '#shared/learn-v2-measurement-storage-manifest'

const today = ref<any>(null)
const todayArgs: unknown[] = []
const onUpdate = vi.fn(() => () => {})

mockNuxtImport('useConvex', () => () => ({ onUpdate, mutation: vi.fn(), query: vi.fn() }))
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline: ref(true) }))
mockNuxtImport('useLearnV2Access', () => () => ({ allowed: computed(() => true), checkingAccess: computed(() => false) }))
mockNuxtImport('useConvexQuery', () => (reference: any, args: unknown) => {
  if (!getFunctionName(reference)?.includes('getToday')) return { data: ref(null) }
  todayArgs.push(args)
  return { data: today }
})
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))

const pagePath = ['~', 'pages', 'app', 'learn', 'today.vue'].join('/')
const check = { version: 'learn-v2.today-check-pointer.v1', reference: 'ref_1', state: 'ready', destination: { kind: 'canvas', threadId: 'thread_1', route: learnTodayCheckRoute('thread_1', 'ref_1') } }
const checkPointers = { status: 'available', reasonCode: null, checks: [{ ...check, version: 'learn-v2.today-check-pointer.v2', timing: 'about_a_week', topic: 'Enzymes' }], isDone: false, continueCursor: 'next' }
const ready = { status: 'ready', sessionId: 'session_1', sessionRevision: 1, content: { revision: 2 }, plan: { recordRevision: 3, blueprintRecordRevision: 4 }, objective: { title: 'Explain enzymes', estimatedMinutes: 12 }, scheduledStartAt: 0, timezone: 'UTC' }

async function render(value: unknown) {
  today.value = value
  const Page = await import(pagePath)
  const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnV2CalendarProjectionCard: true } } })
  const html = wrapper.html()
  wrapper.unmount()
  return html
}

describe('Today checks with responses off', () => {
  beforeEach(() => { onUpdate.mockClear() })

  it('keeps the capability gates off by default', () => {
    expect(LEARN_MEASUREMENT_CAPABILITIES.responses).toBe(false)
    expect(LEARN_MEASUREMENT_CAPABILITIES.todayCanvasChecks).toBe(false)
  })

  it('renders Today exactly as without pointers, even if a pointer envelope arrives', async () => {
    const baseline = await render(ready)
    const withPointers = await render({ ...ready, assessment: { kind: 'check', reasonCode: null, state: null, check }, checkPointers })
    expect(withPointers).toBe(baseline)
    expect(baseline).toContain('data-testid="learn-v2-start"')
    expect(baseline).not.toContain('learn-v2-today-checks')
    expect(baseline).not.toContain('Opens after your check')
    expect(baseline).not.toContain('learn-v2-check-header')
    expect(todayArgs.length).toBeGreaterThan(0)
    expect(todayArgs.every(args => JSON.stringify(args) === '{}')).toBe(true)

    const emptyBaseline = await render({ status: 'empty', nextScheduledAt: null })
    expect(await render({ status: 'empty', nextScheduledAt: null, checkPointers })).toBe(emptyBaseline)
    expect(onUpdate).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cursor: 'next' }), expect.anything(), expect.anything())
  })
})
