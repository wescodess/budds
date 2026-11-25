import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { flushPromises } from '@vue/test-utils'
import { learnTodayCheckRoute, type LearnTodayCheckPointer } from '#shared/learn-v2-today-check'

const V2 = 'learn-v2.today-check-pointer.v2'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true, todayCanvasChecks: true } }
})

type Subscription = { name: string, args: Record<string, unknown>, onValue: (value: unknown) => void, active: boolean }
const subscriptions: Subscription[] = []
const served = new Map<string, unknown>()
const start = vi.fn()
const isOnline = ref(true)
const today = ref<any>(null)
const todayArgs: unknown[] = []

function key(name: string, args: Record<string, unknown>) { return `${name}:${JSON.stringify(args)}` }
function serve(input: Record<string, unknown>, value: unknown) {
  const args = { ...input, pointerVersion: V2 }
  served.set(key('learnV2Today:getCheckPointers', args), value)
  for (const subscription of subscriptions) {
    if (subscription.active && subscription.name === 'learnV2Today:getCheckPointers' && JSON.stringify(subscription.args) === JSON.stringify(args)) subscription.onValue(value)
  }
}
const client = {
  onUpdate: vi.fn((query: never, args: Record<string, unknown>, onValue: (value: unknown) => void) => {
    const subscription = { name: getFunctionName(query), args, onValue, active: true }
    subscriptions.push(subscription)
    const value = served.get(key(subscription.name, args))
    if (value !== undefined) onValue(value)
    return () => { subscription.active = false }
  }),
  mutation: vi.fn(),
  query: vi.fn(),
}
const pointerArgs = () => subscriptions.filter(item => item.name === 'learnV2Today:getCheckPointers').map(({ args: { pointerVersion, ...rest } }) => {
  expect(pointerVersion).toBe(V2)
  return rest
})

mockNuxtImport('useConvex', () => () => client)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useLearnV2Access', () => () => ({ allowed: computed(() => true), checkingAccess: computed(() => false) }))
mockNuxtImport('useConvexQuery', () => (reference: any, args: unknown) => {
  if (!getFunctionName(reference)?.includes('getToday')) return { data: ref(null) }
  todayArgs.push(args)
  return { data: today }
})
mockNuxtImport('useConvexMutation', () => (reference: any) => {
  const name = getFunctionName(reference) ?? ''
  if (name.includes('startStudySession')) return { mutate: start }
  return { mutate: vi.fn().mockResolvedValue({ status: 'recorded' }) }
})
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))

const sessionPath = ['~', 'components', 'learn-v2', 'TodaySession.vue'].join('/')
const checksPath = ['~', 'components', 'learn-v2', 'measurement', 'TodayChecks.vue'].join('/')
const pagePath = ['~', 'pages', 'app', 'learn', 'today.vue'].join('/')
const candidate = { studySessionId: 'session_1', sessionRevision: 1, contentRevision: 2, planRecordRevision: 3, blueprintRecordRevision: 4, objectiveTitle: 'Explain enzymes', estimatedMinutes: 12, scheduledStartAt: 0, timezone: 'UTC', reason: 'today', progress: { retained: 0, independent: 0, total: 0 } }
const blocks = ['retrieval', 'cold_attempt', 'explanation', 'independent_application', 'confidence_teach_back'].map((kind, order) => ({ kind, order, content: `${kind} content` }))

type Timing = 'this_session' | 'about_a_week' | 'about_a_month' | 'earlier' | 'retained'
function pointer(reference: string, state: LearnTodayCheckPointer['state'], more: { timing?: Timing, topic?: string } = {}): LearnTodayCheckPointer {
  const threadId = `thread_${reference}`
  return { version: V2, reference, state, destination: { kind: 'canvas', threadId: threadId as never, route: learnTodayCheckRoute(threadId, reference) }, timing: more.timing ?? 'about_a_week', ...(more.topic === undefined ? {} : { topic: more.topic }) } as LearnTodayCheckPointer
}
function legacy(reference: string): LearnTodayCheckPointer {
  const threadId = `thread_${reference}`
  return { version: 'learn-v2.today-check-pointer.v1', reference, state: 'ready', destination: { kind: 'canvas', threadId: threadId as never, route: learnTodayCheckRoute(threadId, reference) } }
}
function envelope(checks: LearnTodayCheckPointer[], more: Partial<{ status: string, reasonCode: string | null, isDone: boolean, continueCursor: string | null }> = {}) {
  return { status: 'available' as const, reasonCode: null, checks, isDone: true, continueCursor: null, ...more } as any
}
function rows(wrapper: any) { return wrapper.findAll('[data-check-reference]') }
async function mountSession(props: Record<string, unknown>) {
  const Comp = await import(sessionPath)
  return await mountSuspended(Comp.default, { props: { candidate, ...props } })
}
async function mountChecks(props: Record<string, unknown>) {
  const Comp = await import(checksPath)
  return await mountSuspended(Comp.default, { props })
}

describe('Today check rows', () => {
  beforeEach(() => {
    subscriptions.length = 0
    served.clear()
    client.onUpdate.mockClear()
    served.set(key('learnV2SessionContent:getSessionContent', { studySessionId: 'session_1' }), { revision: 2, blocks })
    start.mockReset().mockResolvedValue({ sessionContentRevision: 2 })
    isOnline.value = true
    today.value = null
    todayArgs.length = 0
  })

  it('renders every approved row state with its link to the Canvas and no result', async () => {
    const states = ['ready', 'saved_scoring', 'result_unconfirmed', 'result_ready', 'closed'] as const
    const wrapper = await mountChecks({ envelope: envelope(states.map(state => pointer(`ref_${state}`, state, { topic: 'Enzymes and temperature' }))) })
    const expected = {
      ready: ['Check on last week’s topic', 'Enzymes and temperature', 'One question, on your own. No time limit.', 'Start check'],
      saved_scoring: ['Check saved', 'Getting your result.', 'Open'],
      result_unconfirmed: ['Check saved, result not confirmed', 'Nothing to do. It will update here.', 'Open'],
      result_ready: ['Your check result is ready', 'Read it with your answer.', 'Read it'],
      closed: ['This check won’t count', 'It won’t count for or against you.', 'Open'],
    }
    expect(wrapper.get('[data-testid="learn-v2-today-checks"]').attributes('aria-label')).toBe('Your checks')
    expect(rows(wrapper)).toHaveLength(5)
    for (const state of states) {
      const row = wrapper.get(`[data-testid="learn-v2-check-row-${state}"]`)
      const copy = expected[state]
      const action = copy.at(-1)
      const text = row.findAll('p').map((item: any) => item.text())
      expect(text).toEqual(copy.slice(0, -1))
      const link = row.get('[data-testid="learn-v2-check-row-link"]')
      expect(link.text()).toBe(action)
      expect(link.attributes('href')).toBe(`/app/learn/void/thread_ref_${state}?check=ref_${state}`)
      expect(link.attributes('aria-describedby')).toBe(row.findAll('p').slice(0, state === 'ready' ? 2 : 1).map((item: any) => item.attributes('id')).join(' '))
      expect(row.get('[role]').attributes('role')).toBe(state === 'ready' ? 'none' : 'status')
    }
    expect(wrapper.get('[data-testid="learn-v2-check-row-saved_scoring"] svg').classes()).toEqual(expect.arrayContaining(['animate-spin', 'motion-reduce:animate-none', 'text-[var(--learn-attention)]']))
    expect(wrapper.get('[data-testid="learn-v2-check-row-result_unconfirmed"] svg').classes()).toContain('text-[var(--learn-attention)]')
    expect(wrapper.get('[data-testid="learn-v2-check-row-closed"] svg').classes()).toContain('text-[var(--learn-attention)]')
    expect(wrapper.get('[data-testid="learn-v2-check-row-result_ready"] svg').classes()).toEqual(expect.arrayContaining(['text-green-700', 'dark:text-green-400']))
    expect(wrapper.get('[data-testid="learn-v2-check-row-ready"] [data-testid="learn-v2-check-row-link"]').classes()).toContain('bg-primary')
    expect(wrapper.text()).not.toMatch(/passed|not yet|score|feedback|delayed|retain|mastery|rubric|criteri|undefined/i)
    expect(wrapper.findAll('[data-testid="learn-v2-check-row-topic"]')).toHaveLength(1)
  })

  it.each([
    ['this_session', 'Check on this topic', 'Start with a quick check on this topic.'],
    ['about_a_week', 'Check on last week’s topic', 'Start with a quick check on last week’s topic.'],
    ['about_a_month', 'Check on a topic from about a month ago', 'Start with a quick check on a topic from about a month ago.'],
    ['earlier', 'Check on an earlier topic', 'Start with a quick check on an earlier topic.'],
    ['retained', 'Check on an earlier topic', 'Start with a quick check on an earlier topic.'],
  ] as const)('renders the %s row and header copy the contract authorizes', async (timing, title, header) => {
    const listed = pointer('ref_t', 'ready', { timing, topic: 'Enzymes and temperature' })
    const wrapper = await mountSession({ checkPointers: envelope([listed]), checkLock: legacy('ref_t') })
    const row = wrapper.get('[data-testid="learn-v2-check-row-ready"]')
    expect(row.findAll('p').map((item: any) => item.text())).toEqual([title, 'Enzymes and temperature', 'One question, on your own. No time limit.'])
    expect(wrapper.get('[data-testid="learn-v2-check-header"]').text()).toBe(header)
    expect(wrapper.findAll('[data-testid="learn-v2-check-row-ready"]')).toHaveLength(1)
  })

  it('omits the topic when the server has none and never invents one', async () => {
    const wrapper = await mountSession({ checkPointers: envelope([pointer('ref_n', 'ready', { timing: 'about_a_month' })]), checkLock: legacy('ref_n') })
    const row = wrapper.get('[data-testid="learn-v2-check-row-ready"]')
    expect(row.findAll('p').map((item: any) => item.text())).toEqual(['Check on a topic from about a month ago', 'One question, on your own. No time limit.'])
    expect(row.find('[data-testid="learn-v2-check-row-topic"]').exists()).toBe(false)
    expect(row.get('a').attributes('aria-describedby')).toBe(row.get('p').attributes('id'))
    expect(wrapper.text()).not.toMatch(/undefined|null/)
    const blank = await mountChecks({ envelope: envelope([{ ...pointer('ref_b', 'ready'), topic: '   ' } as never, pointer('ref_c', 'ready')]) })
    expect(rows(blank).map((item: any) => item.attributes('data-check-reference'))).toEqual(['ref_c'])
  })

  it('uses the generic copy when only a v1 pointer is known', async () => {
    const wrapper = await mountSession({ checkPointers: { status: 'unavailable', reasonCode: 'pointer_page_budget', checks: [], isDone: false, continueCursor: null }, checkLock: legacy('ref_v1') })
    expect(wrapper.get('[data-testid="learn-v2-check-row-ready"] p').text()).toBe('Check on an earlier topic')
    expect(wrapper.get('[data-testid="learn-v2-check-header"]').text()).toBe('Start with a quick check on an earlier topic.')
    serve({}, envelope([pointer('ref_v1', 'ready', { timing: 'this_session', topic: 'Gravity' })]))
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-v2-check-row-ready"] p').text()).toBe('Check on this topic')
    expect(wrapper.get('[data-testid="learn-v2-check-row-topic"]').text()).toBe('Gravity')
    expect(wrapper.get('[data-testid="learn-v2-check-header"]').text()).toBe('Start with a quick check on this topic.')
    await wrapper.setProps({ checkPointers: envelope([pointer('ref_v1', 'saved_scoring')]), checkLock: null })
    expect(wrapper.find('[data-testid="learn-v2-check-header"]').exists()).toBe(false)
  })

  it('shows no row without a check, and drops malformed or foreign-route pointers', async () => {
    const empty = await mountChecks({ envelope: envelope([]) })
    expect(empty.find('[data-testid="learn-v2-today-checks"]').exists()).toBe(false)
    const forged = { ...pointer('ref_x', 'ready'), destination: { kind: 'canvas', threadId: 'thread_x', route: '/elsewhere' } }
    const leaking = { ...pointer('ref_y', 'result_ready'), result: { passed: true } }
    const wrapper = await mountChecks({ envelope: envelope([forged, leaking, pointer('ref_ok', 'closed')] as never) })
    expect(rows(wrapper).map((row: any) => row.attributes('data-check-reference'))).toEqual(['ref_ok'])
  })

  it('keeps the planned lesson locked behind a playable check and opens it with normal teaching once the answer is saved', async () => {
    const check = pointer('ref_lock', 'ready')
    const wrapper = await mountSession({ checkPointers: envelope([check]), checkLock: check })
    expect(wrapper.find('[data-testid="learn-v2-start"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-session-locked"]').text()).toBe('Opens after your check')
    const link = wrapper.get('[data-testid="learn-v2-check-row-ready"] [data-testid="learn-v2-check-row-link"]')
    expect(link.text()).toBe('Start check')
    expect(link.attributes('href')).toBe('/app/learn/void/thread_ref_lock?check=ref_lock')
    expect(wrapper.find('[data-testid="learn-v2-phase-retrieval"]').exists()).toBe(false)
    expect(start).not.toHaveBeenCalled()

    await wrapper.setProps({ checkPointers: envelope([pointer('ref_lock', 'saved_scoring')]), checkLock: null })
    expect(wrapper.find('[data-testid="learn-v2-session-locked"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-check-row-saved_scoring"]').text()).toContain('Getting your result.')
    await wrapper.get('[data-testid="learn-v2-start"]').trigger('click')
    await flushPromises()
    expect(start).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-v2-phase-retrieval"]').exists()).toBe(true))
    expect(wrapper.text()).toContain('retrieval content')
    expect(wrapper.get('[data-testid="learn-v2-check-row-saved_scoring"]').exists()).toBe(true)
  })

  it('keeps the lesson locked when the start finds a check Today had not shown, then retries with a fresh key after saving', async () => {
    const check = legacy('ref_due')
    start.mockResolvedValueOnce({ status: 'assessment', sessionContentId: 'content_1', sessionContentRevision: 2, assessment: { kind: 'check', reasonCode: null, state: null, check }, deliveryGrant: null })
    const wrapper = await mountSession({ checkPointers: envelope([]), checkLock: null })
    await wrapper.get('[data-testid="learn-v2-start"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="learn-v2-phase-retrieval"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-session-locked"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="learn-v2-check-row-ready"] a').attributes('href')).toBe('/app/learn/void/thread_ref_due?check=ref_due')
    expect(wrapper.get('[data-testid="learn-v2-live"]').text()).toBe('Your check comes first. Today’s session opens after your check.')

    await wrapper.setProps({ checkPointers: envelope([pointer('ref_due', 'saved_scoring')]), checkLock: null })
    await wrapper.get('[data-testid="learn-v2-start"]').trigger('click')
    await flushPromises()
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[1]![0].idempotencyKey).not.toBe(start.mock.calls[0]![0].idempotencyKey)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-v2-phase-retrieval"]').exists()).toBe(true))
  })

  it('retries a start whose receipt was lost with the same key, and never opens the lesson on its own', async () => {
    start.mockRejectedValueOnce(new Error('Network connection lost'))
    const wrapper = await mountSession({ checkPointers: envelope([pointer('ref_saved', 'saved_scoring')]), checkLock: null })
    await wrapper.get('[data-testid="learn-v2-start"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="learn-v2-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="learn-v2-phase-retrieval"]').exists()).toBe(false)
    await wrapper.get('[data-testid="learn-v2-start"]').trigger('click')
    await flushPromises()
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[1]![0].idempotencyKey).toBe(start.mock.calls[0]![0].idempotencyKey)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-v2-phase-retrieval"]').exists()).toBe(true))
  })

  it('restores the server’s state after a refresh without trusting anything local', async () => {
    const lockedOnce = await mountSession({ checkPointers: envelope([pointer('ref_r', 'ready')]), checkLock: pointer('ref_r', 'ready') })
    expect(lockedOnce.get('[data-testid="learn-v2-session-locked"]').exists()).toBe(true)
    lockedOnce.unmount()
    const stillLocked = await mountSession({ checkPointers: envelope([pointer('ref_r', 'ready')]), checkLock: pointer('ref_r', 'ready') })
    expect(stillLocked.get('[data-testid="learn-v2-session-locked"]').exists()).toBe(true)
    stillLocked.unmount()
    const saved = await mountSession({ checkPointers: envelope([pointer('ref_r', 'result_unconfirmed')]), checkLock: null })
    expect(saved.find('[data-testid="learn-v2-session-locked"]').exists()).toBe(false)
    expect(saved.get('[data-testid="learn-v2-check-row-result_unconfirmed"]').text()).toContain('Check saved, result not confirmed')
    expect(saved.get('[data-testid="learn-v2-start"]').exists()).toBe(true)
  })

  it('discards collected pages and requests page one again on restart_required', async () => {
    serve({ cursor: 'stale' }, { status: 'restart_required', reasonCode: 'cursor_expired', checks: [], isDone: false, continueCursor: null })
    const first = envelope(['a', 'b', 'c', 'd'].map(reference => pointer(reference, 'saved_scoring')), { isDone: false, continueCursor: 'stale' })
    const wrapper = await mountChecks({ envelope: first })
    await flushPromises()
    expect(pointerArgs()).toEqual([{ cursor: 'stale' }, {}])
    expect(rows(wrapper)).toHaveLength(0)

    serve({}, envelope(['a', 'b', 'c', 'e'].map(reference => pointer(reference, 'result_ready')), { isDone: false, continueCursor: 'fresh' }))
    await flushPromises()
    expect(pointerArgs()).toEqual([{ cursor: 'stale' }, {}, { cursor: 'fresh' }])
    serve({ cursor: 'fresh' }, envelope([pointer('f', 'closed')]))
    await flushPromises()
    expect(rows(wrapper).map((row: any) => `${row.attributes('data-check-reference')}:${row.attributes('data-testid').replace('learn-v2-check-row-', '')}`))
      .toEqual(['a:result_ready', 'b:result_ready', 'c:result_ready', 'e:result_ready', 'f:closed'])
    expect(pointerArgs().filter(args => args.cursor === 'stale')).toHaveLength(1)
    expect(subscriptions.find(item => item.args.cursor === 'stale')!.active).toBe(false)
  })

  it('requests its own first page when Today ran out of read budget', async () => {
    const wrapper = await mountChecks({ envelope: { status: 'unavailable', reasonCode: 'pointer_page_budget', checks: [], isDone: false, continueCursor: null } })
    expect(pointerArgs()).toEqual([{}])
    serve({}, envelope([pointer('budget', 'ready')]))
    await flushPromises()
    expect(rows(wrapper).map((row: any) => row.attributes('data-check-reference'))).toEqual(['budget'])
  })

  it('lists multiple checks across pages once each, with one filled Start check', async () => {
    const lock = pointer('r1', 'ready')
    serve({ cursor: 'next' }, envelope([pointer('r4', 'closed'), pointer('r5', 'ready'), pointer('r2', 'saved_scoring')]))
    const wrapper = await mountSession({ checkPointers: envelope([pointer('r0', 'result_ready'), lock, pointer('r2', 'saved_scoring'), pointer('r3', 'ready')], { isDone: false, continueCursor: 'next' }), checkLock: lock })
    await flushPromises()
    const listed = rows(wrapper)
    expect(listed.map((row: any) => row.attributes('data-check-reference'))).toEqual(['r1', 'r0', 'r2', 'r3', 'r4', 'r5'])
    const starts = wrapper.findAll('[data-testid="learn-v2-check-row-ready"] a')
    expect(starts.map((link: any) => link.text())).toEqual(['Start check', 'Start check', 'Start check'])
    expect(starts.filter((link: any) => link.classes().includes('bg-primary'))).toHaveLength(1)
    expect(starts[0]!.attributes('href')).toBe('/app/learn/void/thread_r1?check=r1')
    expect(wrapper.get('[data-testid="learn-v2-session-locked"]').exists()).toBe(true)
  })

  it('passes Today pointers and the lesson lock through the page, including on an empty Today', async () => {
    const Page = await import(pagePath)
    const check = legacy('page_lock')
    today.value = { status: 'ready', sessionId: 'session_1', sessionRevision: 1, content: { revision: 2 }, plan: { recordRevision: 3, blueprintRecordRevision: 4 }, objective: { title: 'Explain enzymes', estimatedMinutes: 12 }, scheduledStartAt: 0, timezone: 'UTC',
      assessment: { kind: 'check', reasonCode: null, state: null, check }, checkPointers: envelope([pointer('page_lock', 'ready', { timing: 'this_session', topic: 'Enzymes' })]) }
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnV2CalendarProjectionCard: true } } })
    expect(todayArgs).toEqual([{ pointerVersion: V2 }])
    expect(wrapper.get('[data-testid="learn-v2-session-locked"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="learn-v2-start"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-check-header"]').text()).toBe('Start with a quick check on this topic.')
    expect(wrapper.get('[data-testid="learn-v2-check-row-topic"]').text()).toBe('Enzymes')

    today.value = { ...today.value, assessment: { kind: 'teach', reasonCode: null, state: null }, checkPointers: envelope([pointer('page_lock', 'saved_scoring')]) }
    await flushPromises()
    expect(wrapper.find('[data-testid="learn-v2-session-locked"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-start"]').exists()).toBe(true)

    today.value = { status: 'empty', nextScheduledAt: null, checkPointers: envelope([pointer('page_lock', 'result_ready')]) }
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-v2-today-empty"]').text()).toContain('Nothing is scheduled for today.')
    expect(wrapper.get('[data-testid="learn-v2-today-empty"] [data-testid="learn-v2-check-row-result_ready"] a').attributes('href')).toBe('/app/learn/void/thread_page_lock?check=page_lock')
  })
})
