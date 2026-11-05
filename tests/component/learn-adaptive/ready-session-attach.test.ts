import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { prepareAdaptiveCommand } from '~~/shared/adaptive-command-authority'

const attach = vi.fn()

vi.mock('~/composables/useLearnV2Journey', () => ({ useLearnV2Journey: () => ({ allowed: ref(true), checkingAccess: ref(false), hub: ref(null) }) }))
vi.mock('~/composables/useLearnAdaptiveAccess', () => ({ useLearnAdaptiveAccess: () => ({ allowed: ref(true), checkingAccess: ref(false) }) }))
mockNuxtImport('useConvex', () => () => ({ query: vi.fn() }))
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: getFunctionName(reference) === 'learnAdaptiveCanvas:attachReadySession' ? attach : vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: never) => ({ data: getFunctionName(reference) === 'users:getUser'
  ? ref({ _id: 'owner_1' })
  : ref({ status: 'ready', sessionId: 'session_1', sessionRevision: 3, objective: { title: 'Gravity' } }) }))

const path = ['~', 'pages', 'app', 'learn', 'index.vue'].join('/')
const prepareAttach = (idempotencyKey: string) => prepareAdaptiveCommand({ userId: 'owner_1', commandName: 'attachReadySession', targetId: 'session_1',
  expectedRevision: 3, idempotencyKey, payload: {} })
let Page: { default: Parameters<typeof mountSuspended>[0] }
const mountPage = () => mountSuspended(Page.default, { route: '/app/learn', global: { stubs: { LearnAdaptiveLearningHome: true } } })

describe('ready session attachment', () => {
  beforeAll(async () => { Page = await import(path) })
  beforeEach(() => {
    attach.mockReset().mockResolvedValue({ kind: 'attached', threadId: 'thread_1' })
    vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined)
    sessionStorage.clear()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it.each([['randomUUID', false], ['the fallback generator', true]])('sends a key the command validator accepts using %s', async (_generator, fallback) => {
    if (fallback) vi.stubGlobal('crypto', { subtle: crypto.subtle })
    const wrapper = await mountPage()
    await wrapper.get('[data-testid="learn-adaptive-continue-ready"]').trigger('click')
    await vi.waitFor(() => expect(useRouter().push).toHaveBeenCalledWith('/app/learn/thread/thread_1'))
    const idempotencyKey = attach.mock.calls[0]?.[0].idempotencyKey
    expect(idempotencyKey).toMatch(fallback ? /^adaptive-ready-\d+$/ : /^adaptive-ready-[0-9a-f-]{36}$/)
    await expect(prepareAttach(idempotencyKey)).resolves.toMatchObject({ idempotencyKeyHash: expect.stringMatching(/^sha256:/) })
    wrapper.unmount()
  })

  it('retries an unconfirmed attachment with the same key', async () => {
    attach.mockResolvedValueOnce(undefined)
    const wrapper = await mountPage()
    await wrapper.get('[data-testid="learn-adaptive-continue-ready"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-adaptive-attach-error"]').exists()).toBe(true))
    expect(useRouter().push).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="learn-adaptive-continue-ready"]').trigger('click')
    await vi.waitFor(() => expect(useRouter().push).toHaveBeenCalledWith('/app/learn/thread/thread_1'))
    expect(attach.mock.calls[1]?.[0].idempotencyKey).toBe(attach.mock.calls[0]?.[0].idempotencyKey)
    wrapper.unmount()
  })
})
