import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { buildV1CoursePath } from '../../../shared/learn-v1-routes'

const courseId = '0000000000000000000010001courses' as Id<'courses'>
const folderId = '0000000000000000000010000folders' as Id<'folders'>
const staleFolderId = '0000000000000000000019999folders' as Id<'folders'>
const sectionId = '000000000000010006courseSections' as Id<'courseSections'>
const taskId = '00000000000000000000000010007tasks' as Id<'tasks'>
const startResult = { courseId, folderId, sectionId, taskId }

const mockStartCourse = vi.fn()
const mockFetch = vi.fn(() => Promise.resolve())
const mockNavigateTo = vi.fn()
const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))

vi.stubGlobal('$fetch', mockFetch)

vi.mock('vue-sonner', () => ({ toast: { error: mockToastError } }))

mockNuxtImport('navigateTo', () => (...args: unknown[]) => mockNavigateTo(...args))

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('startCourse')) return { mutate: mockStartCourse, isLoading: ref(false) }
    return { mutate: vi.fn(), isLoading: ref(false) }
  }
})

const componentPath = ['~', 'components', 'learn', 'StartLearningButton.vue'].join('/')

function baseProps() {
  return { courseId }
}

describe('StartLearningButton', () => {
  beforeEach(() => {
    mockStartCourse.mockReset()
    mockStartCourse.mockResolvedValue(startResult)
    mockFetch.mockClear()
    mockNavigateTo.mockReset()
    mockToastError.mockReset()
  })

  it('renders the button with correct text', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })
    const button = wrapper.find('[data-testid="start-learning-button"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Start Learning')
  })

  it('calls startCourse mutation on click', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })
    const button = wrapper.find('[data-testid="start-learning-button"]')
    await button.trigger('click')
    await vi.waitFor(() => {
      expect(mockStartCourse).toHaveBeenCalledWith(
        expect.objectContaining({ courseId }),
      )
    })
  })

  it('starts exactly one V1 section-generation request from the returned task', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps(), folderId },
    })

    await wrapper.find('[data-testid="start-learning-button"]').trigger('click')
    await flushPromises()

    expect(mockStartCourse).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('/api/course/generate-section', {
      method: 'POST',
      body: { courseId, sectionId, taskId },
    })
  })

  it.each([
    ['absent', undefined],
    ['stale', staleFolderId],
  ])('opens the owned V1 overview from the returned folder when the prop is %s', async (_label, prop) => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps(), folderId: prop },
    })

    await wrapper.find('[data-testid="start-learning-button"]').trigger('click')
    await flushPromises()

    const expected = buildV1CoursePath({ folderId, courseId })
    expect(mockNavigateTo).toHaveBeenCalledTimes(1)
    expect(mockNavigateTo).toHaveBeenCalledWith(expected)
    const route = wrapper.vm.$router.resolve(mockNavigateTo.mock.calls[0]![0] as string)
    expect(route.name).toBe('app-folders-id-learn-courseId')
    expect(route.params).toEqual({ id: folderId, courseId })
  })

  it.each([
    ['a bare string', courseId],
    ['no result', undefined],
    ['no course', { folderId, sectionId, taskId }],
    ['no folder', { courseId }],
  ])('neither navigates nor retries start when the result is %s', async (_label, result) => {
    mockStartCourse.mockResolvedValue(result)
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps(), folderId: staleFolderId },
    })

    await wrapper.find('[data-testid="start-learning-button"]').trigger('click')
    await flushPromises()

    expect(mockStartCourse).toHaveBeenCalledTimes(1)
    expect(mockNavigateTo).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('Failed to start Void')
  })

  it('still generates the committed section when only the folder is missing', async () => {
    mockStartCourse.mockResolvedValue({ courseId, sectionId, taskId })
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })

    await wrapper.find('[data-testid="start-learning-button"]').trigger('click')
    await flushPromises()

    expect(mockStartCourse).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('names the Void when the start command fails', async () => {
    mockStartCourse.mockRejectedValue({})
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })

    await wrapper.find('[data-testid="start-learning-button"]').trigger('click')
    await flushPromises()

    expect(mockToastError).toHaveBeenCalledWith('Failed to start Void')
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('shows loading state while mutation runs', async () => {
    let resolve: (v: typeof startResult) => void
    mockStartCourse.mockImplementation(() => new Promise((r) => { resolve = r }))

    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })
    const button = wrapper.find('[data-testid="start-learning-button"]')
    await button.trigger('click')
    await nextTick()
    expect(button.text()).toContain('Starting...')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    resolve!(startResult)
  })
})
