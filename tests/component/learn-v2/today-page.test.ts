import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const access = ref<any>({ kind: 'denied' })
const accessPending = ref(false)
const today = ref<any>(null)

mockNuxtImport('useConvexQuery', () => (reference: any) => {
  const name = getFunctionName(reference) ?? ''
  return name.includes('learnV2Access:status')
    ? { data: access, pending: accessPending }
    : { data: today, pending: ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'today.vue'].join('/')

describe('Learn V2 Today route states', () => {
  beforeEach(() => {
    access.value = { kind: 'denied' }
    accessPending.value = false
    today.value = null
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
  })
})
