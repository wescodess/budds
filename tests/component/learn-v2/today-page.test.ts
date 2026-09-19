import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const access = ref<any>({ kind: 'denied' })
const accessPending = ref(false)
const today = ref<any>(null)
const convexAuthReady = ref(false)
const convexAuthenticated = ref(false)
const retryGeneration = vi.fn(async () => ({ status: 'pending', sessionRevision: 3 }))

mockNuxtImport('useLearnV2Access', () => () => ({
  allowed: computed(() => convexAuthReady.value && convexAuthenticated.value && access.value.kind === 'allowed'),
  checkingAccess: computed(() => !convexAuthReady.value || (convexAuthenticated.value && accessPending.value)),
}))

mockNuxtImport('useConvexQuery', () => () => ({ data: today, pending: ref(false) }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: retryGeneration }))

const path = ['~', 'pages', 'app', 'learn', 'today.vue'].join('/')

function convexAuth() {
  return {
    ready: convexAuthReady,
    authenticated: convexAuthenticated,
  }
}

describe('Learn V2 Today route states', () => {
  beforeEach(() => {
    access.value = { kind: 'denied' }
    accessPending.value = false
    today.value = null
    convexAuth().ready.value = true
    convexAuth().authenticated.value = true
    retryGeneration.mockClear()
  })

  it('keeps Today pending until Convex authentication is usable', async () => {
    const auth = convexAuth()
    auth.ready.value = false
    auth.authenticated.value = false
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default)

    expect(wrapper.find('[data-testid="learn-v2-today-access-pending"]').exists()).toBe(true)

    auth.ready.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="learn-v2-today-denied"]').exists()).toBe(true)

    auth.authenticated.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="learn-v2-today-denied"]').exists()).toBe(true)
  })

  it('renders accessible access, loading, blocked, empty, and ready states', async () => {
    accessPending.value = true
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, {
      global: {
        stubs: {
          LearnV2TodaySession: {
            props: ['candidate'],
            emits: ['started', 'completed'],
            template: '<section data-testid="learn-v2-ready-stub"><h1>{{ candidate.objectiveTitle }}</h1><button data-testid="learn-v2-started-stub" @click="$emit(\'started\')">Started</button><button data-testid="learn-v2-completed-stub" @click="$emit(\'completed\')">Completed</button></section>',
          },
          LearnV2CalendarProjectionCard: {
            props: ['studySessionId', 'scheduledStartAt'],
            template: '<section data-testid="learn-v2-calendar-stub">{{ studySessionId }}</section>',
          },
        },
      },
    })

    expect(wrapper.get('[data-testid="learn-v2-today-access-pending"]').attributes('aria-live')).toBe('polite')
    accessPending.value = false
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="learn-v2-today-denied"] h1').text()).toBe('Today')

    access.value = { kind: 'allowed' }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="learn-v2-today-pending"]').text()).toContain('Preparing your study session')

    today.value = { status: 'blocked', reason: 'provider_outcome_unknown', sessionId: 'session_1', sessionRevision: 2, canRetryGeneration: true }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="learn-v2-today-blocked"]').text()).toContain('could not safely publish')
    await wrapper.get('[data-testid="learn-v2-retry-generation"]').trigger('click')
    await flushPromises()
    expect(retryGeneration).toHaveBeenCalledWith(expect.objectContaining({ studySessionId: 'session_1', expectedSessionRevision: 2 }))

    const firstRetryKey = retryGeneration.mock.calls[0]![0].idempotencyKey
    today.value = { status: 'pending' }
    await wrapper.vm.$nextTick()
    today.value = { status: 'blocked', reason: 'provider_output_invalid', sessionId: 'session_1', sessionRevision: 4, canRetryGeneration: true }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="learn-v2-retry-generation"]').trigger('click')
    await flushPromises()
    expect(retryGeneration).toHaveBeenCalledTimes(2)
    expect(retryGeneration.mock.calls[1]![0]).toMatchObject({ studySessionId: 'session_1', expectedSessionRevision: 4 })
    expect(retryGeneration.mock.calls[1]![0].idempotencyKey).not.toBe(firstRetryKey)

    today.value = { status: 'empty' }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="learn-v2-today-empty"]').text()).toContain('Nothing is scheduled for today.')

    today.value = {
      status: 'ready',
      sessionId: 'session_1',
      sessionRevision: 1,
      content: { revision: 2 },
      plan: { recordRevision: 3, blueprintRecordRevision: 4 },
      objective: { title: 'Explain gravity', estimatedMinutes: 12 },
      scheduledStartAt: 0,
      timezone: 'America/Toronto',
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="learn-v2-ready-stub"] h1').text()).toBe('Explain gravity')
    expect(wrapper.get('[data-testid="learn-v2-calendar-stub"]').text()).toBe('session_1')

    await wrapper.get('[data-testid="learn-v2-started-stub"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-completed-stub"]').trigger('click')
    today.value = {
      status: 'ready',
      sessionId: 'session_2',
      sessionRevision: 1,
      content: { revision: 1 },
      plan: { recordRevision: 3, blueprintRecordRevision: 4 },
      objective: { title: 'A different session', estimatedMinutes: 15 },
      scheduledStartAt: 0,
      timezone: 'America/Toronto',
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="learn-v2-ready-stub"] h1').text()).toBe('Explain gravity')
    expect(wrapper.get('[data-testid="learn-v2-calendar-stub"]').text()).toBe('session_1')
  })
})
