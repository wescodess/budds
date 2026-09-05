/**
 * ATDD — Story 2-3 Course Deletion
 * AC1: Delete button on course view
 * AC2: Confirmation dialog
 * AC4: Navigation after delete
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import type { Id } from '../../../convex/_generated/dataModel'

const mockMutate = vi.fn()
const { mockToast, mockToastError } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('vue-sonner', () => ({
  toast: Object.assign(mockToast, { error: mockToastError }),
}))

mockNuxtImport('useConvexAction', () => {
  return (_api: unknown) => ({
    mutate: mockMutate,
    isLoading: ref(false),
  })
})

const componentPath = ['~', 'components', 'learn', 'DeleteCourseDialog.vue'].join('/')

describe('DeleteCourseDialog — AC1, AC2', () => {
  beforeEach(() => {
    mockMutate.mockReset()
    mockToast.mockReset()
    mockToastError.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders delete button with destructive styling', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { courseId: 'course_123' as Id<'courses'>, courseTitle: 'Test Course' },
    })
    const trigger = wrapper.find('[data-testid="delete-course-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toContain('Delete')
  })

  it('shows confirmation dialog with warning text on click', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { courseId: 'course_123' as Id<'courses'>, courseTitle: 'Test Course' },
    })
    await wrapper.find('[data-testid="delete-course-trigger"]').trigger('click')
    await flushPromises()
    await nextTick()

    const dialog = document.querySelector('[data-testid="delete-course-dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('permanently delete')
    expect(dialog!.textContent).toContain('sections')
    expect(dialog!.textContent).toContain('quizzes')
  })

  it('cancel closes dialog without calling mutation', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { courseId: 'course_123' as Id<'courses'>, courseTitle: 'Test Course' },
    })
    await wrapper.find('[data-testid="delete-course-trigger"]').trigger('click')
    await flushPromises()
    await nextTick()

    const cancel = document.querySelector('[data-testid="delete-course-cancel"]') as HTMLElement
    expect(cancel).not.toBeNull()
    cancel.click()
    await flushPromises()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('reports durable pending deletion without claiming the course is already gone', async () => {
    mockMutate.mockResolvedValue({ deleted: false, pending: true })
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { courseId: 'course_123' as Id<'courses'>, courseTitle: 'Test Course' },
    })
    await wrapper.find('[data-testid="delete-course-trigger"]').trigger('click')
    await flushPromises()
    await nextTick()

    const confirm = document.querySelector('[data-testid="delete-course-confirm"]') as HTMLElement
    expect(confirm).not.toBeNull()
    confirm.click()
    await flushPromises()

    expect(mockToast).toHaveBeenCalledWith('Course deletion started')
    expect(wrapper.emitted('deleted')).toHaveLength(1)
  })
})
