import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const replace = vi.fn()
const back = vi.fn()
const candidate = ref<any>(null)

mockNuxtImport('useRoute', () => () => ({ params: { learningVoidId: 'void_1', sessionId: 'session_1' } }))
mockNuxtImport('useRouter', () => () => ({ replace, back, afterEach: vi.fn(), beforeResolve: vi.fn() }))
mockNuxtImport('useLearnV2Access', () => () => ({ allowed: ref(true), checkingAccess: ref(false) }))
mockNuxtImport('useConvexQuery', () => () => ({ data: candidate, pending: ref(false) }))

const path = ['~', 'pages', 'app', 'learn', '[learningVoidId]', 'sessions', '[sessionId].vue'].join('/')

describe('Learn V2 mission session route', () => {
  beforeEach(() => {
    replace.mockReset().mockResolvedValue(undefined)
    back.mockReset()
    candidate.value = {
      status: 'ready',
      studySessionId: 'session_1',
      sessionRevision: 1,
      scheduledStartAt: 0,
      scheduledEndAt: 17 * 60_000,
      timezone: 'America/Toronto',
      objective: { title: 'Explain gravity', capability: 'Apply evidence', estimatedMinutes: 50 },
      plan: { recordRevision: 3 },
      blueprint: { recordRevision: 4 },
      content: { revision: 2 },
    }
  })

  it('leaves for the explicit plan workspace instead of relying on browser history', async () => {
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, {
      global: {
        stubs: {
          LearnV2TodaySession: {
            props: ['candidate'],
            emits: ['leave'],
            template: '<button data-testid="session-leave-stub" @click="$emit(\'leave\')">Leave</button>',
          },
        },
      },
    })

    await wrapper.get('[data-testid="session-leave-stub"]').trigger('click')
    expect(replace).toHaveBeenCalledWith('/app/learn/void_1?section=plan')
    expect(back).not.toHaveBeenCalled()
  })
})
