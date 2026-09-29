import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const quizzes = ref<Record<string, unknown>[]>([])
const inspect = vi.fn()
const record = vi.fn()

mockNuxtImport('useConvexQuery', () => (reference: never) => ({
  data: getFunctionName(reference) === 'quizzes:listByFolder' ? quizzes : ref(null), pending: ref(false),
}))
mockNuxtImport('useConvex', () => () => ({ query: inspect }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: record }))

const path = ['~', 'components', 'learn-adaptive', 'QuizContributionPicker.vue'].join('/')
const props = { threadId: 'thread_1', ownerId: 'owner_1', folderId: 'folder_1', expectedRevision: 7, lifecycle: 'active' }

describe('quiz contribution picker', () => {
  beforeEach(() => {
    quizzes.value = [
      { _id: 'quiz_ready', folderId: 'folder_1', title: 'Ready quiz', status: 'ready' },
      { _id: 'quiz_processing', folderId: 'folder_1', title: 'Unready quiz', status: 'processing' },
      { _id: 'quiz_other', folderId: 'folder_2', title: 'Other folder quiz', status: 'ready' },
    ]
    inspect.mockReset().mockResolvedValue({ status: 'available', revision: `sha256:${'a'.repeat(64)}` })
    record.mockReset().mockResolvedValue({ kind: 'recorded', contributionId: 'contribution_1' })
  })

  it('records only a ready quiz from the pinned folder as non-factual practice context', async () => {
    const Component = await import(path)
    const wrapper = await mountSuspended(Component.default, { props })
    expect(wrapper.get('[data-testid="learn-quiz-select"]').findAll('option')).toHaveLength(2)
    await wrapper.get('[data-testid="learn-quiz-select"]').setValue('quiz_ready')
    await wrapper.get('[data-testid="learn-record-quiz"]').trigger('click')
    await flushPromises()

    expect(inspect).toHaveBeenCalledWith(expect.anything(), { source: { feature: 'quiz', id: 'quiz_ready' } })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread_1', source: { feature: 'quiz', id: 'quiz_ready', revision: `sha256:${'a'.repeat(64)}` },
      contributionKind: 'question', classification: 'non_factual', metadata: { role: 'practice' }, expectedRevision: 7 }))
    expect(wrapper.get('[data-testid="learn-quiz-record-notice"]').text()).toContain('unscored')
    expect(wrapper.text()).not.toContain(`sha256:${'a'.repeat(64)}`)
    wrapper.unmount()
  })

  it('retries an uncertain record with the original key and clears it when ownership changes', async () => {
    record.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ kind: 'recorded', contributionId: 'contribution_1', replayed: true })
    const Component = await import(path)
    const wrapper = await mountSuspended(Component.default, { props })
    await wrapper.get('[data-testid="learn-quiz-select"]').setValue('quiz_ready')
    await wrapper.get('[data-testid="learn-record-quiz"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-quiz-record-error"]').text()).toContain('outcome could not be confirmed')
    await wrapper.get('[data-testid="learn-quiz-record-retry"]').trigger('click')
    await flushPromises()
    expect(record.mock.calls[1]![0]).toEqual(record.mock.calls[0]![0])
    expect(inspect).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ ownerId: 'owner_2' })
    expect(wrapper.find('[data-testid="learn-quiz-record-retry"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not record a quiz if the thread changes during source inspection', async () => {
    let finishInspection!: (value: { status: string, revision: string }) => void
    inspect.mockReturnValueOnce(new Promise(resolve => { finishInspection = resolve }))
    const Component = await import(path)
    const wrapper = await mountSuspended(Component.default, { props })
    await wrapper.get('[data-testid="learn-quiz-select"]').setValue('quiz_ready')
    await wrapper.get('[data-testid="learn-record-quiz"]').trigger('click')
    await wrapper.setProps({ threadId: 'thread_2' })
    finishInspection({ status: 'available', revision: `sha256:${'a'.repeat(64)}` })
    await flushPromises()
    expect(record).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
