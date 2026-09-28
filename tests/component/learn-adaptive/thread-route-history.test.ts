import { beforeEach, describe, expect, it, vi } from 'vitest'
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

mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed, checkingAccess: ref(false) }))
mockNuxtImport('useUserSession', () => () => ({ loggedIn: ref(true), ready: ref(true) }))
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline: ref(true) }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn().mockResolvedValue({ kind: 'ok' }) }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: never) => {
  const name = getFunctionName(reference)
  return { data: name === 'users:getUser' ? user : name === 'learnAdaptive:getThread' ? projection : name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnostic : ref(null), pending: ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'thread', '[threadId].vue'].join('/')

describe('adaptive thread browser history', () => {
  beforeEach(() => { sessionStorage.clear(); document.body.innerHTML = ''; allowed.value = true })

  it('restores a selected activity through real Back/Forward and refresh without losing the current unsent response', async () => {
    const Page = await import(path)
    const routeRecord = useNuxtApp().$router.getRoutes().find(route => route.path === '/app/learn/thread/:threadId()')
    expect(routeRecord).toBeDefined()
    routeRecord!.meta.auth = false
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    const router = wrapper.vm.$router
    expect(router.currentRoute.value).toMatchObject({ fullPath: '/app/learn/thread/thread_1', params: { threadId: 'thread_1' } })
    await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('My unsent answer.')
    expect(wrapper.get('a[href="/app/learn/thread/thread_1?activity=older_activity"]').exists()).toBe(true)
    await router.push('/app/learn/thread/thread_1?activity=older_activity')
    await vi.waitFor(() => expect(router.currentRoute.value.query.activity).toBe('older_activity'))
    expect(wrapper.get('[data-testid="learn-selected-history"]').text()).toContain('Earlier reflection.')
    expect((wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('My unsent answer.')

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.query.activity).toBeUndefined())
    expect(wrapper.find('[data-testid="learn-selected-history"]').exists()).toBe(false)
    expect((wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('My unsent answer.')

    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.query.activity).toBe('older_activity'))
    wrapper.unmount()
    const refreshed = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1?activity=older_activity', attachTo: document.body })
    expect(refreshed.get('[data-testid="learn-selected-history"]').text()).toContain('Earlier reflection.')
    expect((refreshed.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('My unsent answer.')
    refreshed.unmount()
  })
})
