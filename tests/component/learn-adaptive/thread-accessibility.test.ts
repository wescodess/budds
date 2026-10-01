import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useNuxtApp } from '#app'
import { getFunctionName } from 'convex/server'
import { nextTick, ref } from 'vue'
import type { RouteRecordNormalized } from 'vue-router'

// Transport responses and Nuxt's auth fixture are the only substituted boundaries.
// The route, access decision, Canvas, drawers, and online status remain real.
const status = ref({ kind: 'allowed' })
const accessPending = ref(false)
const activityPending = ref(false)
const user = ref({ _id: 'owner_1' })
const initialProjection = {
  ownerId: 'owner_1',
  thread: { id: 'thread_1', outcome: 'Check my understanding', intent: 'refresh', evidenceState: 'preparing', lifecycle: 'active', revision: 2, authorityKind: 'standalone' },
  currentActivity: { id: 'diagnostic:thread_1', status: 'eligible', activityClass: 'non_factual', purpose: 'Record your starting point.' },
  history: [{ id: 'older_activity', status: 'replaced', activityClass: 'non_factual', purpose: 'Earlier reflection.' }],
  nextAction: { kind: 'submit_response', label: 'Save response', activityId: 'diagnostic:thread_1' },
}
const projection = ref(initialProjection)
const initialDiagnostic = {
  ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my understanding', intent: 'refresh', revision: 2 },
  status: 'eligible', evidenceState: 'preparing', decisionPending: false,
  recovery: { title: 'Your material is preparing', body: 'Record what you know.', action: 'Back to Learn' },
  activity: { id: 'diagnostic:thread_1', status: 'eligible', planRevision: 1, primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'diagnostic_prompt', action: 'submit_response', testId: 'learn-primitive-diagnostic-prompt', props: { prompt: 'What do you already know?', responseFormat: 'short_text', assistance: 'none' } }, response: null,
    requiredAction: { kind: 'submit_response', label: 'Save response' } },
}
const diagnostic = ref<typeof initialDiagnostic | null>(initialDiagnostic)
const initialEvidence = { ownerId: 'owner_1', threadId: 'thread_1', activityId: 'diagnostic:thread_1', kind: 'non_factual', eligibility: 'eligible', readOnly: false, integrityState: 'accepted', claims: [] }
const initialMemory = { ownerId: 'owner_1', threadId: 'thread_1', threadRevision: 2, lifecycle: 'active', unresolvedPoint: 'Review my starting point', nextAction: { label: 'Save response' }, evidenceState: 'preparing', preferences: [], artifacts: [], history: [] }
const evidence = ref(initialEvidence)
const memory = ref(initialMemory)

mockNuxtImport('useConvexQuery', () => (reference: never) => {
  const name = getFunctionName(reference)
  const data = name === 'learnAdaptiveAccess:adaptiveStatus' || name === 'learnV2Access:status' ? status
    : name === 'users:getUser' ? user
      : name === 'learnAdaptive:getThread' ? projection
        : name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnostic
          : name === 'learnAdaptiveEvidence:getThreadActivityEvidence' ? evidence
            : name === 'learnAdaptive:getMemory' ? memory
              : name === 'learnAdaptive:listThreadContributions' ? ref({ page: [], isDone: true, continueCursor: '' })
                : ref(null)
  return { data, pending: name === 'learnAdaptiveAccess:adaptiveStatus' ? accessPending : name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? activityPending : ref(false) }
})
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: vi.fn().mockResolvedValue(getFunctionName(reference) === 'learnAdaptiveRecovery:recordDiagnosticRendered' ? { status: 'recorded' } : { kind: 'ok' }) }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvex', () => () => ({ query: vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: '' }), onUpdate: vi.fn().mockReturnValue(vi.fn()) }))

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined
let previousAuth: { ready: boolean, authenticated: boolean }
let routeRecord: RouteRecordNormalized | undefined
let previousRouteAuth: RouteRecordNormalized['meta']['auth']
let applicationMain: HTMLElement | undefined
const path = ['~', 'pages', 'app', 'learn', 'thread', '[threadId].vue'].join('/')

async function mountLearningRoute(home = false) {
  const app = useNuxtApp()
  const route = home ? '/app/learn' : '/app/learn/thread/thread_1'
  routeRecord = app.$router.resolve(route).matched.at(-1)!
  previousRouteAuth = routeRecord.meta.auth
  routeRecord.meta.auth = false
  const Page = await import(home ? ['~', 'pages', 'app', 'learn', 'index.vue'].join('/') : path)
  // A public layout context fixture: the application's main landmark already
  // exists. The real default layout is exercised by the browser journey.
  applicationMain = document.createElement('main')
  document.body.append(applicationMain)
  wrapper = await mountSuspended(Page.default, { route, attachTo: applicationMain })
  return wrapper
}

function accessibleReference(element: Element, attribute: string) {
  const ids = element.getAttribute(attribute)?.split(/\s+/) ?? []
  return ids.map(id => document.getElementById(id)?.textContent?.trim()).join(' ')
}

describe('mounted Home and Thread accessibility', () => {
  beforeEach(() => {
    sessionStorage.clear()
    accessPending.value = false
    status.value = { kind: 'allowed' }
    user.value = { _id: 'owner_1' }
    projection.value = structuredClone(initialProjection)
    memory.value = structuredClone(initialMemory)
    activityPending.value = false
    diagnostic.value = structuredClone(initialDiagnostic)
    evidence.value = structuredClone(initialEvidence)
    const app = useNuxtApp()
    previousAuth = { ready: app.$convexAuthReady.value, authenticated: app.$convexAuthenticated.value }
    app.$convexAuthReady.value = true
    app.$convexAuthenticated.value = true
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    applicationMain?.remove()
    applicationMain = undefined
    if (routeRecord) {
      if (previousRouteAuth === undefined) delete routeRecord.meta.auth
      else routeRecord.meta.auth = previousRouteAuth
      routeRecord = undefined
    }
    const app = useNuxtApp()
    app.$convexAuthReady.value = previousAuth.ready
    app.$convexAuthenticated.value = previousAuth.authenticated
  })

  it('provides a named Thread region inside the application landmark and live lifecycle and loading announcements', async () => {
    diagnostic.value = null
    activityPending.value = true
    const page = await mountLearningRoute()
    // The application layout owns main#main-content. Route content supplies a
    // named region, so the routed application does not nest main landmarks.
    expect(applicationMain!.querySelectorAll('main')).toHaveLength(0)
    expect(page.get('section[aria-label="Learning thread"]').exists()).toBe(true)
    expect(page.get('h1').text()).toBe('Check my understanding')
    expect(page.get('section[aria-label="Current learning activity"]').exists()).toBe(true)
    expect(accessibleReference(page.get('section[aria-labelledby="learn-thread-next-title"]').element, 'aria-labelledby')).toBe('Your next move')
    expect(accessibleReference(page.get('section[aria-labelledby="learn-thread-history-title"]').element, 'aria-labelledby')).toBe('Recent activity')
    expect(page.get('header [role="status"][aria-live="polite"]').text()).toBe('active · Evidence preparing')
    const loading = page.get('[data-testid="learn-adaptive-canvas-loading"]')
    expect(loading.attributes('role')).toBe('status')
    expect(loading.attributes('aria-live')).toBe('polite')
    diagnostic.value = initialDiagnostic
    activityPending.value = false
    await nextTick()
    expect(page.find('[data-testid="learn-adaptive-canvas-loading"]').exists()).toBe(false)
    expect(page.get('[data-testid="learn-diagnostic-response"]').attributes('aria-label')).toBe('Your response')
  })

  it('keeps Home content inside the existing application main landmark', async () => {
    const page = await mountLearningRoute(true)
    expect(page.get('[data-testid="learn-adaptive-home"]').exists()).toBe(true)
    expect(applicationMain!.querySelectorAll('main')).toHaveLength(0)
    expect(page.get('form').attributes('aria-label')).toBe('Start a learning thread')
  })

  it('announces access checks while the real access decision awaits the external status', async () => {
    accessPending.value = true
    const page = await mountLearningRoute()
    expect(page.get('section[aria-live="polite"]').text()).toBe('Checking learning access…')
    expect(page.find('[data-testid="learn-adaptive-thread-shell"]').exists()).toBe(false)
    accessPending.value = false
    await nextTick()
    expect(page.get('h1').text()).toBe('Check my understanding')
  })

  it.each([
    ['evidence', 'Evidence', 'Sources currently supporting this activity.'],
    ['memory', 'Learning memory', 'Review and change what you explicitly asked Budds to remember.'],
  ])('names the %s dialog and restores its keyboard focus after an activity selection changes', async (kind, name, description) => {
    const page = await mountLearningRoute()
    const trigger = page.get(`[data-testid="learn-${kind}-open"]`)
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('click')
    const drawer = document.querySelector(`[data-testid="learn-${kind}-drawer"]`)!
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(accessibleReference(drawer, 'aria-labelledby')).toBe(name)
    expect(accessibleReference(drawer, 'aria-describedby')).toContain(description)
    await vi.waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true))
    await useNuxtApp().$router.push('/app/learn/thread/thread_1?activity=older_activity')
    evidence.value = { ...evidence.value, activityId: 'older_activity', readOnly: true }
    await nextTick()
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector(`[data-testid="learn-${kind}-drawer"]`)).toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element))
    expect(page.get('[data-testid="learn-selected-history"]').text()).toContain('Earlier reflection.')
  })
})
