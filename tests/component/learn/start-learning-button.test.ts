import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockStartCourse = vi.fn()

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('startCourse')) return { mutate: mockStartCourse, isLoading: ref(false) }
    return { mutate: vi.fn(), isLoading: ref(false) }
  }
})

const componentPath = ['~', 'components', 'learn', 'StartLearningButton.vue'].join('/')

function baseProps() {
  return {
    courseId: 'course_1' as any,
  }
}

describe('StartLearningButton', () => {
  beforeEach(() => {
    mockStartCourse.mockReset()
    mockStartCourse.mockResolvedValue('course_1')
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
        expect.objectContaining({ courseId: 'course_1' }),
      )
    })
  })

  it('shows loading state while mutation runs', async () => {
    let resolve: (v: string) => void
    mockStartCourse.mockImplementation(() => new Promise((r) => { resolve = r }))

    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps() })
    const button = wrapper.find('[data-testid="start-learning-button"]')
    await button.trigger('click')
    await nextTick()
    expect(button.text()).toContain('Starting...')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    resolve!('course_1')
  })
})
