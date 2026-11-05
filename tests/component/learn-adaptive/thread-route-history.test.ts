import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { useNuxtApp } from '#app'

const allowed = ref(true)
const user = ref({ _id: 'owner_1' })
const projection = ref({ ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my understanding', intent: 'refresh', evidenceState: 'preparing', lifecycle: 'active', revision: 2, authorityKind: 'standalone' },
  currentActivity: { id: 'diagnostic:thread_1', status: 'eligible', activityClass: 'non_factual', purpose: 'Record your starting point.' },
  history: [{ id: 'older_activity', status: 'replaced', activityClass: 'non_factual', purpose: 'Earlier reflection.' }],
  nextAction: { kind: 'submit_response', label: 'Save response', activityId: 'diagnostic:thread_1' } })
const diagnostic = ref({ ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my understanding', intent: 'refresh', revision: 2 },
  status: 'eligible', evidenceState: 'preparing', decisionPending: false,
  recovery: { title: 'Your material is preparing', body: 'Record what you know.', action: 'Back to Learn' },
  activity: { id: 'diagnostic:thread_1', status: 'eligible', planRevision: 1, primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'diagnostic_prompt', action: 'submit_response', testId: 'learn-primitive-diagnostic-prompt', props: { prompt: 'What do you already know?', responseFormat: 'short_text', assistance: 'none' } }, response: null,
    requiredAction: { kind: 'submit_response', label: 'Save response' } } })
const commands = vi.fn()

mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed, checkingAccess: ref(false) }))
mockNuxtImport('useUserSession', () => () => ({ loggedIn: ref(true), ready: ref(true) }))
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline: ref(true) }))
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: (args: unknown) => commands(getFunctionName(reference), args) }))
mockNuxtImport('useConvex', () => () => ({ query: vi.fn() }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: never) => {
  const name = getFunctionName(reference)
  return { data: name === 'users:getUser' ? user : name === 'learnAdaptive:getThread' ? projection : name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnostic : ref(null), pending: ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'void', '[threadId].vue'].join('/')
const legacyQuery = '?activity=older_activity&utm_source=mail&empty=&flag&repeat=1&repeat=2&q=a%2Fb%3F%26'

const mounted: Array<{ unmount: () => void }> = []

async function mountVoid(route: string) {
  const Page = await import(path)
  const record = useNuxtApp().$router.getRoutes().find(entry => entry.path === '/app/learn/void/:threadId()')
  expect(record).toBeDefined()
  record!.meta.auth = false
  const wrapper = await mountSuspended(Page.default, { route, attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}
function legacyRecord() {
  return useNuxtApp().$router.getRoutes().find(entry => entry.path === '/app/learn/thread/:threadId()')!
}
function voidRecord() {
  return useNuxtApp().$router.getRoutes().find(entry => entry.path === '/app/learn/void/:threadId()')!
}
function responseValue(wrapper: Awaited<ReturnType<typeof mountVoid>>) {
  return (wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value
}
function learnerCommands() {
  return commands.mock.calls.map(([name]) => name).filter(name => name !== 'learnAdaptiveRecovery:recordDiagnosticRendered')
}

describe('adaptive Void browser history', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.body.innerHTML = ''
    allowed.value = true
    commands.mockReset().mockResolvedValue({ kind: 'ok' })
  })
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
  })

  it('restores a selected activity through real Back/Forward and refresh without losing the current unsent response', async () => {
    const wrapper = await mountVoid('/app/learn/void/thread_1')
    const router = wrapper.vm.$router
    expect(router.currentRoute.value).toMatchObject({ fullPath: '/app/learn/void/thread_1', params: { threadId: 'thread_1' } })
    await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('My unsent answer.')
    expect(wrapper.get('a[href="/app/learn/void/thread_1?activity=older_activity"]').exists()).toBe(true)
    await router.push('/app/learn/void/thread_1?activity=older_activity')
    await vi.waitFor(() => expect(router.currentRoute.value.query.activity).toBe('older_activity'))
    expect(wrapper.get('[data-testid="learn-selected-history"]').text()).toContain('Earlier reflection.')
    expect(responseValue(wrapper)).toBe('My unsent answer.')

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.query.activity).toBeUndefined())
    expect(wrapper.find('[data-testid="learn-selected-history"]').exists()).toBe(false)
    expect(responseValue(wrapper)).toBe('My unsent answer.')

    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.query.activity).toBe('older_activity'))
    mounted.splice(mounted.indexOf(wrapper), 1)
    wrapper.unmount()
    const refreshed = await mountVoid('/app/learn/void/thread_1?activity=older_activity')
    expect(refreshed.get('[data-testid="learn-selected-history"]').text()).toContain('Earlier reflection.')
    expect(responseValue(refreshed)).toBe('My unsent answer.')
    expect(learnerCommands()).toEqual([])
  })

  it('canonicalizes a legacy push once without replacing the prior entry or loading the legacy page', async () => {
    const wrapper = await mountVoid('/app/learn/void/thread_1')
    const router = wrapper.vm.$router
    await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('Keep this answer.')
    const entries = window.history.length

    await router.push(`/app/learn/thread/thread_1${legacyQuery}#learn-thread-history-title`)
    expect(router.currentRoute.value).toMatchObject({
      name: 'app-learn-void-threadId',
      params: { threadId: 'thread_1' },
      query: { activity: 'older_activity', utm_source: 'mail', empty: '', flag: null, repeat: ['1', '2'], q: 'a/b?&' },
      hash: '#learn-thread-history-title',
      redirectedFrom: { name: 'app-learn-thread-threadId' },
    })
    expect(window.location.pathname).toBe('/app/learn/void/thread_1')
    expect(window.location.hash).toBe('#learn-thread-history-title')
    expect(window.history.length).toBe(entries + 1)
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-selected-history"]').text()).toContain('Earlier reflection.'))
    expect(responseValue(wrapper)).toBe('Keep this answer.')

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/app/learn/void/thread_1'))
    expect(wrapper.find('[data-testid="learn-selected-history"]').exists()).toBe(false)
    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.query.activity).toBe('older_activity'))
    expect(window.location.pathname).toBe('/app/learn/void/thread_1')

    await router.replace('/app/learn/thread/thread_1')
    expect(router.currentRoute.value.fullPath).toBe('/app/learn/void/thread_1')
    expect(window.history.length).toBe(entries + 1)
    expect(responseValue(wrapper)).toBe('Keep this answer.')
    expect(typeof legacyRecord().components?.default).toBe('function')
    expect(typeof voidRecord().components?.default).toBe('object')
    expect(learnerCommands()).toEqual([])
  })

  it('keeps Home behind one canonical entry for a legacy link so Back returns to Home', async () => {
    const wrapper = await mountVoid('/app/learn/void/thread_1')
    const router = wrapper.vm.$router
    const home = router.getRoutes().find(entry => entry.name === 'app-learn')!
    const homeAuth = home.meta.auth
    home.meta.auth = false
    try {
      await router.push('/app/learn')
      const homeEntries = window.history.length
      await router.push(`/app/learn/thread/thread_1${legacyQuery}`)
      expect(router.currentRoute.value).toMatchObject({ name: 'app-learn-void-threadId', redirectedFrom: { name: 'app-learn-thread-threadId' } })
      expect(window.history.length).toBe(homeEntries + 1)
      router.back()
      await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/app/learn'))
      expect(window.location.pathname).toBe('/app/learn')
      router.forward()
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('app-learn-void-threadId'))
      expect(window.location.pathname).toBe('/app/learn/void/thread_1')
      expect(window.history.length).toBe(homeEntries + 1)
    }
    finally { home.meta.auth = homeAuth }
  })

  it('replaces a legacy history entry in place when Forward reaches it', async () => {
    const wrapper = await mountVoid('/app/learn/void/thread_1')
    const router = wrapper.vm.$router
    await router.push('/app/learn/void/thread_1?activity=older_activity')
    const legacyEntry = `/app/learn/thread/thread_1${legacyQuery}#learn-thread-history-title`
    window.history.replaceState({ ...window.history.state, current: legacyEntry }, '', legacyEntry)
    const entries = window.history.length

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/app/learn/void/thread_1'))
    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.redirectedFrom?.name).toBe('app-learn-thread-threadId'))
    expect(router.currentRoute.value).toMatchObject({ name: 'app-learn-void-threadId', query: { activity: 'older_activity', flag: null, repeat: ['1', '2'] }, hash: '#learn-thread-history-title' })
    expect(window.location.pathname).toBe('/app/learn/void/thread_1')
    expect(window.history.length).toBe(entries)

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/app/learn/void/thread_1'))
    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.hash).toBe('#learn-thread-history-title'))
    expect(router.currentRoute.value.redirectedFrom).toBeUndefined()
    expect(window.location.pathname).toBe('/app/learn/void/thread_1')
    expect(window.history.length).toBe(entries)
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-selected-history"]').text()).toContain('Earlier reflection.'))
    expect(learnerCommands()).toEqual([])
  })

  it('keeps the encoded ID identity for path and named legacy entries', async () => {
    const wrapper = await mountVoid('/app/learn/void/thread_1')
    const router = wrapper.vm.$router
    await router.push('/app/learn/thread/thread%2F%C3%A4%20%252F?activity=older_activity')
    expect(router.currentRoute.value).toMatchObject({ name: 'app-learn-void-threadId', params: { threadId: 'thread/ä %2F' }, query: { activity: 'older_activity' } })
    expect(router.currentRoute.value.path).toBe('/app/learn/void/thread%2F%C3%A4%20%252F')

    await router.push({ name: 'app-learn-thread-threadId', params: { threadId: 'thread_1' }, query: { activity: 'older_activity', repeat: ['1', '2'] }, hash: '#learn-thread-history-title' })
    expect(router.currentRoute.value.fullPath).toBe('/app/learn/void/thread_1?activity=older_activity&repeat=1&repeat=2#learn-thread-history-title')
    expect(learnerCommands()).toEqual([])
  })

  it('keeps unrelated query and fragment state on activity links and removes only the activity on return', async () => {
    const wrapper = await mountVoid('/app/learn/void/thread_1?utm_source=mail&repeat=1&repeat=2&empty=#learn-thread-history-title')
    const router = wrapper.vm.$router
    await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('Unsent while browsing history.')
    const historyLink = wrapper.get('section[aria-labelledby="learn-thread-history-title"] a')
    expect(historyLink.attributes('href')).toBe('/app/learn/void/thread_1?utm_source=mail&repeat=1&repeat=2&empty=&activity=older_activity#learn-thread-history-title')

    await router.push(historyLink.attributes('href')!)
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ utm_source: 'mail', repeat: ['1', '2'], empty: '', activity: 'older_activity' }))
    expect(router.currentRoute.value.hash).toBe('#learn-thread-history-title')
    expect(wrapper.get('[data-testid="learn-selected-history"]').text()).toContain('This past activity is read-only.')
    const current = wrapper.get('[data-testid="learn-current-activity-link"]')
    expect(current.attributes('href')).toBe('/app/learn/void/thread_1?utm_source=mail&repeat=1&repeat=2&empty=#learn-thread-history-title')

    await router.push(current.attributes('href')!)
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ utm_source: 'mail', repeat: ['1', '2'], empty: '' }))
    expect(router.currentRoute.value.hash).toBe('#learn-thread-history-title')
    expect(wrapper.find('[data-testid="learn-selected-history"]').exists()).toBe(false)
    expect(responseValue(wrapper)).toBe('Unsent while browsing history.')
    expect(learnerCommands()).toEqual([])
  })
})
