import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, ref as vueRef, watch } from 'vue'
import { getFunctionName } from 'convex/server'

const allowed = ref(true)
const checkingAccess = ref(false)
const hub = ref({ today: null, missions: [] })
const adaptiveAllowed = ref(false)
const checkingAdaptiveAccess = ref(false)
const createDraft = vi.fn()
const prepareDecision = vi.fn()
const resolveClarification = vi.fn()
const setIntent = vi.fn()
const getInitialDecision = vi.fn()
const currentUser = ref<{ _id: string } | null>({ _id: 'owner_1' })
const folderRows = ref([{ _id: 'folder_1', name: 'Physics' }])
const resumeRows = ref([])
const routeState = reactive({ path: '/app/learn', query: { legacy: undefined as string | undefined } })

mockNuxtImport('useLearnV2Journey', () => () => ({ allowed, checkingAccess, hub }))
mockNuxtImport('useUserSession', () => () => ({ loggedIn: ref(true), ready: ref(true) }))
mockNuxtImport('useRoute', () => () => routeState)
mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed: adaptiveAllowed, checkingAccess: checkingAdaptiveAccess }))
mockNuxtImport('useConvexMutation', () => (reference: unknown) => {
  const name = getFunctionName(reference as never)
  if (name?.includes('prepareInitialDecision')) return { mutate: prepareDecision }
  if (name?.includes('resolveClarification')) return { mutate: resolveClarification }
  if (name?.includes('setIntent')) return { mutate: setIntent }
  return { mutate: createDraft }
})
mockNuxtImport('useConvexQuery', () => (reference: never) => {
  const name = getFunctionName(reference)
  return { data: name === 'folders:listAllFolders' ? folderRows : name === 'learnAdaptive:listResumeCandidates' ? resumeRows : currentUser }
})
mockNuxtImport('useConvex', () => () => ({ query: getInitialDecision }))

describe('Learn V2 route entry', () => {
  beforeEach(() => {
    allowed.value = true
    checkingAccess.value = false
    adaptiveAllowed.value = false
    checkingAdaptiveAccess.value = false
    createDraft.mockReset()
    prepareDecision.mockReset().mockResolvedValue({ kind: 'ok', revision: 2, value: { status: 'not_required', reasonCode: 'declared_inputs_sufficient', continuationKind: 'standalone_non_factual' } })
    resolveClarification.mockReset()
    setIntent.mockReset()
    getInitialDecision.mockReset().mockResolvedValue({ status: 'not_required', reasonCode: 'declared_inputs_sufficient', continuationKind: 'standalone_non_factual', originalNeed: 'Understand this system', outcome: 'Explain the system safely', revision: 2 })
    currentUser.value = { _id: 'owner_1' }
    routeState.query.legacy = undefined
    sessionStorage.clear()
  })
  it('renders the real Learn hub instead of the legacy Today-only destination', async () => {
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, {
      global: { stubs: { LearnV2LearnHub: { props: ['snapshot'], template: '<section data-testid="hub" />' } } },
    })
    expect(wrapper.find('[data-testid="hub"]').exists()).toBe(true)
  })

  it('offers named V1/V2 handoffs while adaptive is on, and keeps the V2 hub when adaptive is off', async () => {
    adaptiveAllowed.value = true
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const adaptive = await mountSuspended(Page.default, { route: '/app/learn' })
    expect(adaptive.get('[data-testid="learn-legacy-v1-home"]').attributes('href')).toBe('/')
    expect(adaptive.vm.$router.resolve('/').matched.at(-1)?.path).toBe('/')
    expect(adaptive.text()).not.toContain('Physics')
    expect(adaptive.get('[data-testid="learn-legacy-handoffs"]').text()).not.toContain('Physics')
    expect(adaptive.get('[data-testid="learn-legacy-v2-hub"]').attributes('href')).toBe('/app/learn?legacy=v2')
    expect(adaptive.get('[data-testid="learn-legacy-v2-today"]').attributes('href')).toBe('/app/learn/today')
    expect(adaptive.get('[data-testid="learn-legacy-v2-review"]').attributes('href')).toBe('/app/learn/review')
    routeState.query.legacy = 'v2'
    await nextTick()
    expect(adaptive.find('[data-testid="learn-v2-hub"]').exists()).toBe(true)
    adaptive.unmount()
    adaptiveAllowed.value = false
    const rolledBack = await mountSuspended(Page.default, { route: '/app/learn' })
    expect(rolledBack.find('[data-testid="learn-v2-hub"]').exists()).toBe(true)
    expect(rolledBack.find('[data-testid="learn-adaptive-learning-home"]').exists()).toBe(false)
    expect(rolledBack.vm.$router.resolve('/app/folders/folder_1/learn').matched.at(-1)?.path).toContain('/learn')
    expect(rolledBack.vm.$router.resolve('/app/learn/void_1').matched.at(-1)?.path).toContain('learningVoidId')
    rolledBack.unmount()
  })

  it('saves a selected thread intent and keeps the local chip selected across a stale conflict', async () => {
    adaptiveAllowed.value = true
    createDraft.mockResolvedValue({ kind: 'created', thread: { id: 'thread_1', originalNeed: 'Understand this system', outcome: 'Understand this system', revision: 1 } })
    getInitialDecision.mockResolvedValueOnce({ status: 'not_required', continuationKind: 'standalone_non_factual', originalNeed: 'Understand this system', outcome: 'Understand this system', intent: 'understand', revision: 2 })
      .mockResolvedValueOnce({ status: 'not_required', continuationKind: 'standalone_non_factual', originalNeed: 'Understand this system', outcome: 'Understand this system', intent: 'master', revision: 3 })
      .mockResolvedValue({ status: 'not_required', continuationKind: 'standalone_non_factual', originalNeed: 'Understand this system', outcome: 'Understand this system', intent: 'explore', revision: 4 })
    setIntent.mockResolvedValueOnce({ kind: 'conflict', code: 'stale_revision', actualRevision: 3 })
      .mockResolvedValueOnce({ kind: 'ok', value: { intent: 'explore' }, revision: 4 })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: { emits: ['start'], template: '<button data-testid="emit-start" @click="$emit(\'start\', { clientDraftId: \'intent-draft-01\', need: \'Understand this system\', intent: \'understand\', availableTime: \'15\', sourceScope: { kind: \'none\' } })">Start</button>' }, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="learn-intent-chip-explore"]').trigger('click')
    await flushPromises()
    expect(setIntent.mock.calls[0]?.[0]).toMatchObject({ threadId: 'thread_1', expectedRevision: 2, intent: 'explore' })
    expect(wrapper.get('[data-testid="learn-intent-chip-explore"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="learn-intent-save-error"]').text()).toContain('another session')
    await wrapper.get('[data-testid="learn-intent-retry"]').trigger('click')
    await flushPromises()
    expect(setIntent.mock.calls[1]?.[0]).toMatchObject({ threadId: 'thread_1', expectedRevision: 3, intent: 'explore' })
    expect(wrapper.get('[data-testid="learn-intent-chip-explore"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="learn-intent-saved"]').text()).toBe('Intent saved.')
  })

  it('retains the selected intent for retry when another tab changes authority after the save returns', async () => {
    adaptiveAllowed.value = true
    createDraft.mockResolvedValue({ kind: 'created', thread: { id: 'thread_1', originalNeed: 'Understand this system', outcome: 'Understand this system', revision: 1 } })
    let returnAuthority!: (projection: unknown) => void
    getInitialDecision.mockResolvedValueOnce({ status: 'not_required', continuationKind: 'standalone_non_factual', originalNeed: 'Understand this system', outcome: 'Understand this system', intent: 'understand', revision: 2 })
      .mockImplementationOnce(() => new Promise(resolve => { returnAuthority = resolve }))
      .mockResolvedValue({ status: 'not_required', continuationKind: 'standalone_non_factual', originalNeed: 'Understand this system', outcome: 'Understand this system', intent: 'explore', revision: 4 })
    setIntent.mockResolvedValueOnce({ kind: 'ok', value: { intent: 'explore' }, revision: 3 })
      .mockResolvedValueOnce({ kind: 'ok', value: { intent: 'explore' }, revision: 4 })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: { emits: ['start'], template: '<button data-testid="emit-start" @click="$emit(\'start\', { clientDraftId: \'intent-race-01\', need: \'Understand this system\', intent: \'understand\', availableTime: \'15\', sourceScope: { kind: \'none\' } })">Start</button>' }, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="learn-intent-chip-explore"]').trigger('click')
    await vi.waitFor(() => expect(getInitialDecision).toHaveBeenCalledTimes(2))
    returnAuthority({ status: 'not_required', continuationKind: 'standalone_non_factual', originalNeed: 'Understand this system', outcome: 'Understand this system', intent: 'master', revision: 4 })
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-intent-chip-explore"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="learn-intent-saved"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-intent-save-error"]').text()).toContain('another session')
    await wrapper.get('[data-testid="learn-intent-retry"]').trigger('click')
    await flushPromises()
    expect(setIntent.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 4, intent: 'explore' })
    expect(wrapper.get('[data-testid="learn-intent-saved"]').text()).toBe('Intent saved.')
  })

  it('discards a late intent save response after the signed-in owner changes', async () => {
    adaptiveAllowed.value = true
    createDraft.mockResolvedValue({ kind: 'created', thread: { id: 'thread_1', originalNeed: 'Understand this system', outcome: 'Understand this system', revision: 1 } })
    getInitialDecision.mockResolvedValue({ status: 'not_required', continuationKind: 'standalone_non_factual', originalNeed: 'Understand this system', outcome: 'Understand this system', intent: 'understand', revision: 2 })
    let settle!: (result: unknown) => void
    setIntent.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: { emits: ['start'], template: '<button data-testid="emit-start" @click="$emit(\'start\', { clientDraftId: \'intent-switch-01\', need: \'Understand this system\', intent: \'understand\', availableTime: \'15\', sourceScope: { kind: \'none\' } })">Start</button>' }, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="learn-intent-chip-master"]').trigger('click')
    currentUser.value = { _id: 'owner_2' }
    await flushPromises()
    settle({ kind: 'ok', revision: 3, value: { intent: 'master' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="learn-initial-decision"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learn-intent-saved"]').exists()).toBe(false)
  })

  it('shows the need-first composer only through exact adaptive access and reuses one key across a failed retry', async () => {
    adaptiveAllowed.value = true
    createDraft.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ kind: 'created', thread: { id: 'thread_1', originalNeed: 'Understand this system', outcome: 'Explain the system safely', revision: 1 } })
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
    expect(prepareDecision).toHaveBeenCalledWith({ threadId: 'thread_1', expectedRevision: 1, idempotencyKey: 'prepare-draft-token-01' })
    expect(wrapper.get('[data-testid="learn-continuation-ready"]').text()).toContain('next step is ready')
    expect(wrapper.get('[data-testid="learn-clarification-original-need"]').text()).toContain('Understand this system')
    currentUser.value = { _id: 'owner_2' }
    await flushPromises()
    expect(wrapper.find('[data-testid="learn-initial-decision"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="adaptive-home"]').exists()).toBe(true)
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
    expect(wrapper.find('[data-testid="learn-initial-decision"]').exists()).toBe(false)
  })

  it.each(['success', 'failure'] as const)('ignores stale preparation %s after an account switch', async settlement => {
    adaptiveAllowed.value = true
    createDraft.mockResolvedValue({ kind: 'created', thread: { id: 'thread_owner_a', originalNeed: 'Owner A private need', outcome: 'Owner A private need', revision: 1 } })
    let resolve!: (value: unknown) => void
    let reject!: (cause: Error) => void
    prepareDecision.mockImplementationOnce(() => new Promise((res, rej) => { resolve = res; reject = rej }))
    const HomeStub = defineComponent({
      props: { serverError: String, acknowledgedRequestKey: String },
      emits: ['start'],
      setup(props, { emit }) {
        const text = vueRef('')
        watch(() => props.acknowledgedRequestKey, value => { if (value) text.value = '' })
        const start = () => emit('start', { clientDraftId: 'owner-a-prepare-01', need: 'Owner A private need', intent: 'prepare', availableTime: '15', sourceScope: { kind: 'none' } })
        return { text, start }
      },
      template: '<section><input v-model="text" data-testid="owner-draft"><p data-testid="draft-error">{{ serverError }}</p><p data-testid="draft-ack">{{ acknowledgedRequestKey }}</p><button data-testid="emit-start" @click="start">Start</button></section>',
    })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: HomeStub, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    currentUser.value = { _id: 'owner_2' }
    await wrapper.get('[data-testid="owner-draft"]').setValue('Owner B must keep this draft')
    if (settlement === 'success') resolve({ kind: 'ok', revision: 2, value: { status: 'pending', continuationKind: 'standalone_non_factual' } })
    else reject(new Error('stale preparation error'))
    await flushPromises()
    expect((wrapper.get('[data-testid="owner-draft"]').element as HTMLInputElement).value).toBe('Owner B must keep this draft')
    expect(wrapper.get('[data-testid="draft-ack"]').text()).toBe('')
    expect(wrapper.get('[data-testid="draft-error"]').text()).toBe('')
    expect(wrapper.find('[data-testid="learn-initial-decision"]').exists()).toBe(false)
  })

  it('renders one clarification and reuses the resolution key across a failed retry', async () => {
    adaptiveAllowed.value = true
    createDraft.mockResolvedValue({ kind: 'created', thread: { id: 'thread_2', originalNeed: 'Prepare me for an interview', outcome: 'Prepare me for an interview', revision: 1 } })
    prepareDecision.mockResolvedValue({ kind: 'ok', revision: 2, value: { status: 'pending', reasonCode: 'outcome_needed_for_first_move', continuationKind: 'standalone_non_factual', question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one concrete result.' } } })
    const pendingProjection = { status: 'pending', reasonCode: 'outcome_needed_for_first_move', continuationKind: 'standalone_non_factual', originalNeed: 'Prepare me for an interview', outcome: 'Prepare me for an interview', revision: 2, question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one concrete result.' } }
    getInitialDecision.mockResolvedValueOnce(pendingProjection).mockResolvedValueOnce(pendingProjection)
      .mockResolvedValue({ status: 'answered', reasonCode: 'outcome_needed_for_first_move', continuationKind: 'standalone_non_factual', originalNeed: 'Prepare me for an interview', outcome: 'Rehearse one concise interview answer.', revision: 3, question: pendingProjection.question })
    resolveClarification.mockRejectedValueOnce(new Error('temporary resolve failure')).mockResolvedValueOnce({ kind: 'ok', revision: 3, value: { status: 'answered', reasonCode: 'outcome_needed_for_first_move', continuationKind: 'standalone_non_factual', question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one concrete result.' } } })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: { emits: ['start'], template: '<button data-testid="emit-start" @click="$emit(\'start\', { clientDraftId: \'clarify-token-01\', need: \'Prepare me for an interview\', intent: \'prepare\', availableTime: \'15\', sourceScope: { kind: \'none\' } })">Start</button>' }, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-clarification-original-need"]').text()).toContain('Prepare me for an interview')
    await wrapper.get('[data-testid="learn-clarification-answer"]').setValue('Rehearse one concise interview answer.')
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('temporary resolve failure')
    const resolutionKey = resolveClarification.mock.calls[0]![0].idempotencyKey
    expect(wrapper.get('[data-testid="learn-clarification-answer"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    await flushPromises()
    expect(resolveClarification.mock.calls[1]![0].idempotencyKey).toBe(resolutionKey)
    expect(resolveClarification.mock.calls[1]![0].resolution).toEqual({ kind: 'answer', answer: 'Rehearse one concise interview answer.' })
    expect(wrapper.get('[data-testid="learn-continuation-ready"]').text()).toContain('next step is ready')
  })

  it.each(['success', 'failure'] as const)('ignores stale clarification %s after an account switch', async settlement => {
    adaptiveAllowed.value = true
    createDraft.mockResolvedValue({ kind: 'created', thread: { id: 'thread_owner_a', originalNeed: 'Owner A prepare need', outcome: 'Owner A prepare need', revision: 1 } })
    prepareDecision.mockResolvedValue({ kind: 'ok', revision: 2, value: { status: 'pending', continuationKind: 'standalone_non_factual', question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one result.' } } })
    getInitialDecision.mockResolvedValue({ status: 'pending', continuationKind: 'standalone_non_factual', originalNeed: 'Owner A prepare need', outcome: 'Owner A prepare need', revision: 2, question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one result.' } })
    let resolve!: (value: unknown) => void
    let reject!: (cause: Error) => void
    resolveClarification.mockImplementationOnce(() => new Promise((res, rej) => { resolve = res; reject = rej }))
    const HomeStub = defineComponent({
      props: { serverError: String },
      emits: ['start'],
      setup(_, { emit }) {
        const text = vueRef('')
        const start = () => emit('start', { clientDraftId: 'owner-a-clarify-01', need: 'Owner A prepare need', intent: 'prepare', availableTime: '15', sourceScope: { kind: 'none' } })
        return { text, start }
      },
      template: '<section><input v-model="text" data-testid="owner-draft"><p data-testid="draft-error">{{ serverError }}</p><button data-testid="emit-start" @click="start">Start</button></section>',
    })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: HomeStub, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="learn-clarification-answer"]').setValue('Owner A private clarification')
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    currentUser.value = { _id: 'owner_2' }
    await flushPromises()
    await wrapper.get('[data-testid="owner-draft"]').setValue('Owner B draft survives')
    if (settlement === 'success') resolve({ kind: 'ok', revision: 3, value: { status: 'answered', continuationKind: 'standalone_non_factual' } })
    else reject(new Error('stale resolution error'))
    await flushPromises()
    expect((wrapper.get('[data-testid="owner-draft"]').element as HTMLInputElement).value).toBe('Owner B draft survives')
    expect(wrapper.get('[data-testid="draft-error"]').text()).toBe('')
    expect(wrapper.find('[data-testid="learn-initial-decision"]').exists()).toBe(false)
  })

  it('hydrates a pending decision and retained local answer after remount without crossing owners', async () => {
    adaptiveAllowed.value = true
    sessionStorage.setItem('budds.learn.adaptive-initial-decision.v1:owner_1', JSON.stringify({ threadId: 'thread_resume', savedAt: Date.now() }))
    sessionStorage.setItem('budds.learn.adaptive-initial-decision.v1:answer:owner_1:thread_resume', JSON.stringify({ answer: 'My retained local answer', savedAt: Date.now() }))
    getInitialDecision.mockResolvedValue({ status: 'pending', reasonCode: 'outcome_needed_for_first_move', continuationKind: 'standalone_non_factual', originalNeed: 'Prepare for a careful review', outcome: 'Prepare for a careful review', revision: 2, question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one result.' } })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnV2LearnHub: { template: '<section />' } } } })
    await flushPromises()
    expect((wrapper.get('[data-testid="learn-clarification-answer"]').element as HTMLTextAreaElement).value).toBe('My retained local answer')
    currentUser.value = { _id: 'owner_2' }
    await flushPromises()
    expect(wrapper.find('[data-testid="learn-initial-decision"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learn-adaptive-home"]').exists()).toBe(true)
  })

  it('withholds the composer while restoring and requires an explicit retry after a query failure', async () => {
    adaptiveAllowed.value = true
    sessionStorage.setItem('budds.learn.adaptive-initial-decision.v1:owner_1', JSON.stringify({ threadId: 'thread_slow', savedAt: Date.now() }))
    let reject!: (cause: Error) => void
    getInitialDecision.mockImplementationOnce(() => new Promise((_, rej) => { reject = rej }))
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnV2LearnHub: { template: '<section />' } } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-clarification-restore"]').text()).toContain('Restoring')
    expect(wrapper.find('[data-testid="learn-adaptive-home"]').exists()).toBe(false)
    expect(createDraft).not.toHaveBeenCalled()
    reject(new Error('temporary restore failure'))
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-clarification-restore"]').text()).toContain('temporary restore failure')
    expect(wrapper.find('[data-testid="learn-adaptive-home"]').exists()).toBe(false)
    getInitialDecision.mockResolvedValueOnce({ status: 'pending', continuationKind: 'standalone_non_factual', originalNeed: 'Resume safely', outcome: 'Resume safely', revision: 2, question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one result.' } })
    await wrapper.get('[data-testid="learn-clarification-restore-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-clarification-answer"]').exists()).toBe(true)
  })

  it('retains the route to terminal authority while removing the raw answer', async () => {
    adaptiveAllowed.value = true
    const pointerKey = 'budds.learn.adaptive-initial-decision.v1:owner_1'
    const answerKey = 'budds.learn.adaptive-initial-decision.v1:answer:owner_1:thread_terminal'
    sessionStorage.setItem(pointerKey, JSON.stringify({ threadId: 'thread_terminal', savedAt: Date.now() }))
    sessionStorage.setItem(answerKey, JSON.stringify({ answer: 'Stale local answer', savedAt: Date.now() }))
    getInitialDecision.mockResolvedValue({ status: 'answered', continuationKind: 'standalone_non_factual', originalNeed: 'Prepare safely', outcome: 'Authoritative outcome', revision: 3, question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one result.' } })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnV2LearnHub: { template: '<section />' } } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-continuation-ready"]').exists()).toBe(true)
    expect(JSON.parse(sessionStorage.getItem(pointerKey) ?? '{}')).toMatchObject({ threadId: 'thread_terminal' })
    expect(sessionStorage.getItem(answerKey)).toBeNull()
    await wrapper.get('[data-testid="learn-adaptive-open-diagnostic"]').trigger('click')
    expect(JSON.parse(sessionStorage.getItem(pointerKey) ?? '{}')).toMatchObject({ threadId: 'thread_terminal' })
  })

  it.each(['expired_pointer', 'missing_authority'] as const)('removes unreachable raw answers for %s', async state => {
    adaptiveAllowed.value = true
    const threadId = state === 'expired_pointer' ? 'thread_expired' : 'thread_missing'
    const pointerKey = 'budds.learn.adaptive-initial-decision.v1:owner_1'
    const answerKey = `budds.learn.adaptive-initial-decision.v1:answer:owner_1:${threadId}`
    sessionStorage.setItem(pointerKey, JSON.stringify({ threadId, savedAt: state === 'expired_pointer' ? Date.now() - 25 * 60 * 60 * 1_000 : Date.now() }))
    sessionStorage.setItem(answerKey, JSON.stringify({ answer: 'Unreachable raw answer', savedAt: Date.now() - 25 * 60 * 60 * 1_000 }))
    if (state === 'missing_authority') getInitialDecision.mockResolvedValue(null)
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnV2LearnHub: { template: '<section />' } } } })
    await flushPromises()
    expect(wrapper.find('[data-testid="learn-adaptive-home"]').exists()).toBe(true)
    expect(sessionStorage.getItem(pointerKey)).toBeNull()
    expect(sessionStorage.getItem(answerKey)).toBeNull()
  })

  it('refreshes a pending revision conflict and retries the frozen answer with a new key', async () => {
    adaptiveAllowed.value = true
    createDraft.mockResolvedValue({ kind: 'created', thread: { id: 'thread_pending_conflict', originalNeed: 'Prepare for review', outcome: 'Prepare for review', revision: 1 } })
    prepareDecision.mockResolvedValue({ kind: 'ok', revision: 2, value: { status: 'pending', continuationKind: 'standalone_non_factual' } })
    const pending = { status: 'pending', continuationKind: 'standalone_non_factual', originalNeed: 'Prepare for review', outcome: 'Prepare for review', question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one result.' } }
    getInitialDecision.mockResolvedValueOnce({ ...pending, revision: 2 }).mockResolvedValueOnce({ ...pending, revision: 3 }).mockResolvedValue({ ...pending, status: 'answered', outcome: 'One frozen outcome', revision: 4 })
    resolveClarification.mockResolvedValueOnce({ kind: 'conflict', code: 'stale_revision', actualRevision: 3, expectedRevision: 2 }).mockResolvedValueOnce({ kind: 'ok', revision: 4, value: { status: 'answered', continuationKind: 'standalone_non_factual' } })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: { emits: ['start'], template: '<button data-testid="emit-start" @click="$emit(\'start\', { clientDraftId: \'pending-conflict-01\', need: \'Prepare for review\', intent: \'prepare\', availableTime: \'15\', sourceScope: { kind: \'none\' } })">Start</button>' }, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="learn-clarification-answer"]').setValue('One frozen outcome')
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    await flushPromises()
    const firstKey = resolveClarification.mock.calls[0]![0].idempotencyKey
    expect(wrapper.get('[role="alert"]').text()).toContain('original answer is retained')
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    await flushPromises()
    expect(resolveClarification.mock.calls[1]![0]).toMatchObject({ expectedRevision: 3, resolution: { kind: 'answer', answer: 'One frozen outcome' } })
    expect(resolveClarification.mock.calls[1]![0].idempotencyKey).not.toBe(firstKey)
    expect(wrapper.get('[data-testid="learn-continuation-ready"]').exists()).toBe(true)
  })

  it('adopts the authoritative terminal decision when another tab wins resolution', async () => {
    adaptiveAllowed.value = true
    createDraft.mockResolvedValue({ kind: 'created', thread: { id: 'thread_two_tab', originalNeed: 'Prepare for review', outcome: 'Prepare for review', revision: 1 } })
    prepareDecision.mockResolvedValue({ kind: 'ok', revision: 2, value: { status: 'pending', continuationKind: 'standalone_non_factual', question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one result.' } } })
    const pendingProjection = { status: 'pending', continuationKind: 'standalone_non_factual', originalNeed: 'Prepare for review', outcome: 'Prepare for review', revision: 2, question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one result.' } }
    getInitialDecision.mockResolvedValueOnce(pendingProjection).mockResolvedValue({ ...pendingProjection, status: 'skipped', revision: 3 })
    resolveClarification.mockResolvedValue({ kind: 'conflict', code: 'stale_revision', actualRevision: 3, expectedRevision: 2 })
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, { global: { stubs: { LearnAdaptiveLearningHome: { emits: ['start'], template: '<button data-testid="emit-start" @click="$emit(\'start\', { clientDraftId: \'two-tab-01\', need: \'Prepare for review\', intent: \'prepare\', availableTime: \'15\', sourceScope: { kind: \'none\' } })">Start</button>' }, LearnV2LearnHub: { template: '<section />' } } } })
    await wrapper.get('[data-testid="emit-start"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="learn-clarification-answer"]').setValue('My local answer remains private')
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-clarification-conflict"]').text()).toContain('another session')
    await wrapper.get('[data-testid="learn-clarification-keep-local"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-clarification-conflict"]').text()).toContain('remains only in this browser session')
    expect((wrapper.get('[data-testid="learn-clarification-answer"]').element as HTMLTextAreaElement).value).toBe('My local answer remains private')
    await wrapper.get('[data-testid="learn-clarification-use-authority"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-continuation-ready"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(JSON.parse(sessionStorage.getItem('budds.learn.adaptive-initial-decision.v1:owner_1') ?? '{}')).toMatchObject({ threadId: 'thread_two_tab' })
  })
})
