import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, ref as vueRef, watch } from 'vue'

const allowed = ref(true)
const checkingAccess = ref(false)
const hub = ref({ today: null, missions: [] })
const adaptiveAllowed = ref(false)
const checkingAdaptiveAccess = ref(false)
const createDraft = vi.fn()
const currentUser = ref<{ _id: string } | null>({ _id: 'owner_1' })

mockNuxtImport('useLearnV2Journey', () => () => ({ allowed, checkingAccess, hub }))
mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed: adaptiveAllowed, checkingAccess: checkingAdaptiveAccess }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: createDraft }))
mockNuxtImport('useConvexQuery', () => () => ({ data: currentUser }))

describe('Learn V2 route entry', () => {
  beforeEach(() => {
    allowed.value = true
    checkingAccess.value = false
    adaptiveAllowed.value = false
    checkingAdaptiveAccess.value = false
    createDraft.mockReset()
    currentUser.value = { _id: 'owner_1' }
  })
  it('renders the real Learn hub instead of the legacy Today-only destination', async () => {
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, {
      global: { stubs: { LearnV2LearnHub: { props: ['snapshot'], template: '<section data-testid="hub" />' } } },
    })
    expect(wrapper.find('[data-testid="hub"]').exists()).toBe(true)
  })

  it('shows the need-first composer only through exact adaptive access and reuses one key across a failed retry', async () => {
    adaptiveAllowed.value = true
    createDraft.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ kind: 'created', thread: { id: 'thread_1', originalNeed: 'Understand this system', outcome: 'Explain the system safely' } })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, {
      global: {
        stubs: {
          LearnAdaptiveLearningHome: { props: ['serverError', 'acknowledgedRequestKey'], emits: ['start'], template: '<section data-testid="adaptive-home"><p data-testid="draft-error">{{ serverError }}</p><p data-testid="draft-ack">{{ acknowledgedRequestKey }}</p><button data-testid="emit-start" @click="$emit(\'start\', { clientDraftId: \'draft-token-01\', need: \'Understand this system\', outcome: \'Explain the system safely\', intent: \'understand\', availableTime: \'15\', sourceScope: { kind: \'none\' } })">Start</button></section>' },
          LearnV2LearnHub: { template: '<section data-testid="hub" />' },
        },
      },
    })
    expect(wrapper.find('[data-testid="adaptive-home"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hub"]').exists()).toBe(false)
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="draft-error"]').text()).toContain('temporary failure')
    const retryKey = createDraft.mock.calls[0]![0].idempotencyKey
    expect(retryKey).toBe('need-draft-draft-token-01')
    expect(retryKey).toMatch(/^[A-Za-z0-9._~-]+$/)
    expect(createDraft.mock.calls[0]![0]).not.toHaveProperty('clientDraftId')
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    expect(createDraft.mock.calls[1]![0].idempotencyKey).toBe(retryKey)
    expect(wrapper.get('[data-testid="learn-adaptive-created"]').text()).toContain('saved in this draft')
    expect(wrapper.get('[data-testid="learn-adaptive-created"]').text()).not.toContain('Understand this system')
    expect(wrapper.get('[data-testid="draft-ack"]').text()).toBe(retryKey)
    currentUser.value = { _id: 'owner_2' }
    await flushPromises()
    expect(wrapper.find('[data-testid="learn-adaptive-created"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="draft-ack"]').text()).toBe('')
  })

  it.each(['success', 'failure'] as const)('ignores an old owner mutation %s after an account switch', async settlement => {
    adaptiveAllowed.value = true
    let resolve!: (value: unknown) => void
    let reject!: (cause: Error) => void
    createDraft.mockImplementationOnce(() => new Promise((res, rej) => { resolve = res; reject = rej }))
    const HomeStub = defineComponent({
      props: { serverError: String, acknowledgedRequestKey: String },
      emits: ['start'],
      setup(props, { emit }) {
        const text = vueRef('')
        watch(() => props.acknowledgedRequestKey, value => { if (value) text.value = '' })
        const start = () => emit('start', { clientDraftId: 'owner-a-draft-01', need: 'Owner A private need', intent: 'understand', availableTime: '15', sourceScope: { kind: 'none' } })
        return { text, start }
      },
      template: '<section><input v-model="text" data-testid="owner-draft"><p data-testid="draft-error">{{ serverError }}</p><p data-testid="draft-ack">{{ acknowledgedRequestKey }}</p><button data-testid="emit-start" @click="start">Start</button></section>',
    })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: HomeStub, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    currentUser.value = { _id: 'owner_2' }
    await wrapper.get('[data-testid="owner-draft"]').setValue('Owner B must keep this draft')
    if (settlement === 'success') resolve({ kind: 'created', thread: { id: 'thread_a', originalNeed: 'Owner A private need', outcome: 'Owner A private need' } })
    else reject(new Error('stale owner A error'))
    await flushPromises()
    expect((wrapper.get('[data-testid="owner-draft"]').element as HTMLInputElement).value).toBe('Owner B must keep this draft')
    expect(wrapper.get('[data-testid="draft-ack"]').text()).toBe('')
    expect(wrapper.get('[data-testid="draft-error"]').text()).toBe('')
    expect(wrapper.find('[data-testid="learn-adaptive-created"]').exists()).toBe(false)
  })
})
