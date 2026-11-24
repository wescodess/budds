import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const projection = ref<Record<string, unknown> | null>(null)
const user = ref({ _id: 'owner_1' })
const canvas = teachingRead('learnAdaptiveCanvas:getCanvas')
const artifact = teachingRead('learnAdaptive:getArtifactCanvas')
const reflection = teachingRead('learnAdaptive:getReflectionCanvas')

mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed: ref(true), checkingAccess: ref(false), fallbackRoute: ref({ name: 'app-learn', href: '/app/learn?legacy=v2', label: 'Open V2 learning plans' }) }))
mockNuxtImport('useRoute', () => () => ({ params: { threadId: 'thread_1' }, query: {}, hash: '' }))
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline: ref(true) }))
mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn().mockResolvedValue({ kind: 'ok' }) }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: never) => {
  const name = getFunctionName(reference)
  const data = name === 'users:getUser' ? user : name === 'learnAdaptive:getThread' ? projection
    : name === 'learnAdaptive:listThreadContributions' ? ref({ page: [], isDone: true, continueCursor: '' })
      : name === 'learnAdaptive:listThreadArtifacts' ? ref([]) : ref(null)
  return { data, pending: ref(false), error: ref(null) }
})

const path = ['~', 'pages', 'app', 'learn', 'void', '[threadId].vue'].join('/')
const pausedCopy = 'This is paused while you have a check open. Finish the check, then come back.'

describe('adaptive thread route reads with responses on', () => {
  beforeEach(() => {
    resetTeachingReads()
    for (const read of [canvas, artifact, reflection]) read.data.value = null
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain orbital motion', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: null, history: [], nextAction: { kind: 'continue', label: 'Start learning', activityId: null } }
  })

  it('explains an open check instead of the generic fallback, with no retry', async () => {
    canvas.error.value = deniedRead('test_open')
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/void/thread_1' })
    const shell = wrapper.get('[data-testid="learn-adaptive-thread-shell"]')
    expect(shell.get('[data-testid="learn-adaptive-canvas-read-paused"]').text()).toBe(pausedCopy)
    expect(shell.find('[data-testid="learn-adaptive-canvas-read-retry"]').exists()).toBe(false)
    expect(shell.find('[data-testid="learn-adaptive-canvas-fallback"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('retries other failures by subscribing again and falls back once delivered', async () => {
    canvas.error.value = new Error('Network request failed')
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/void/thread_1' })
    const shell = wrapper.get('[data-testid="learn-adaptive-thread-shell"]')
    expect(shell.get('[data-testid="learn-adaptive-canvas-read-error"]').attributes('role')).toBe('alert')
    const before = canvas.subscriptions
    canvas.data.value = undefined
    canvas.error.value = null
    await shell.get('[data-testid="learn-adaptive-canvas-read-retry"]').trigger('click')
    expect(canvas.subscriptions).toBe(before + 1)
    canvas.data.value = null
    await vi.waitFor(() => expect(shell.find('[data-testid="learn-adaptive-canvas-read-error"]').exists()).toBe(false))
    expect(shell.get('[data-testid="learn-adaptive-canvas-fallback"]').text()).toContain('unavailable')
    wrapper.unmount()
  })
})
