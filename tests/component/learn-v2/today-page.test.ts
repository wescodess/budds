import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { useNuxtApp } from '#app'

const access = ref<any>({ kind: 'denied' })
const accessPending = ref(false)
const today = ref<any>(null)
const accessQueryEnabled = ref<any>(null)

mockNuxtImport('useConvexQuery', () => (reference: any, _args: any, options?: any) => {
  const name = getFunctionName(reference) ?? ''
  if (name.includes('learnV2Access:status')) {
    accessQueryEnabled.value = options?.enabled ?? null
    return { data: access, pending: accessPending }
  }
  return { data: today, pending: ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'today.vue'].join('/')

function convexAuth() {
  const nuxtApp = useNuxtApp()
  return {
    ready: nuxtApp.$convexAuthReady as Ref<boolean>,
    authenticated: nuxtApp.$convexAuthenticated as Ref<boolean>,
  }
}

describe('Learn V2 Today route states', () => {
  beforeEach(() => {
    access.value = { kind: 'denied' }
    accessPending.value = false
    today.value = null
    convexAuth().ready.value = true
    convexAuth().authenticated.value = true
    accessQueryEnabled.value = null
  })

  it('waits for Convex authentication before checking account access', async () => {
    const auth = convexAuth()
    auth.ready.value = false
    auth.authenticated.value = false
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default)

    expect(accessQueryEnabled.value?.value).toBe(false)
    expect(wrapper.find('[data-testid="learn-v2-today-access-pending"]').exists()).toBe(true)

    auth.ready.value = true
    await wrapper.vm.$nextTick()
    expect(accessQueryEnabled.value?.value).toBe(false)

    auth.authenticated.value = true
    await wrapper.vm.$nextTick()
    expect(accessQueryEnabled.value?.value).toBe(true)
  })

  it('renders accessible access, loading, blocked, empty, and ready states', async () => {
    accessPending.value = true
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, {
      global: {
        stubs: {
          LearnV2TodaySession: {
            props: ['candidate'],
            template: '<section data-testid="learn-v2-ready-stub"><h1>{{ candidate.objectiveTitle }}</h1></section>',
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

    today.value = { status: 'blocked', reason: 'Source evidence needs attention.' }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="learn-v2-today-blocked"]').text()).toContain('Source evidence needs attention.')

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
  })
})
