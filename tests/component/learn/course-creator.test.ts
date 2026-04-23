import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockCreate = vi.fn()
const mockCourseData = ref<any>(null)
const mockSectionsData = ref<any[]>([])
const mockFolders = ref([
  { _id: 'folder_1', name: 'Organic Chemistry', userId: 'u1' },
])
const mockDocCounts = ref([{ folderId: 'folder_1', count: 18 }])

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args?: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('courses:get') || name.includes('courses.get')) return { data: mockCourseData }
    if (name.includes('listByCourse')) return { data: mockSectionsData }
    if (name.includes('listAllFolders')) return { data: mockFolders }
    if (name.includes('countsByFolder')) return { data: mockDocCounts }
    return { data: ref(null) }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('courses:create') || name.includes('courses.create')) return { mutate: mockCreate, isLoading: ref(false) }
    return { mutate: vi.fn(), isLoading: ref(false) }
  }
})

const componentPath = ['~', 'components', 'learn', 'CourseCreator.vue'].join('/')

describe('CourseCreator', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCourseData.value = null
    mockSectionsData.value = []
    mockCreate.mockResolvedValue({ courseId: 'course_1', taskId: 'task_1' })
  })

  it('renders source selection step initially', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="course-creator"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="source-selector"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="generating-skeleton"]').exists()).toBe(false)
  })

  it('shows error state with try again button', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)

    mockCreate.mockRejectedValue(new Error('Generation failed'))
    const input = wrapper.find('[data-testid="topic-input"]')
    await input.setValue('React hooks')
    await wrapper.find('[data-testid="generate-outline-button"]').trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="error-state"]').exists()).toBe(true)
    })
    expect(wrapper.text()).toContain("couldn't generate an outline")
    expect(wrapper.find('[data-testid="try-again-button"]').exists()).toBe(true)
  })

  it('try again returns to source selection', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)

    mockCreate.mockRejectedValue(new Error('fail'))
    await wrapper.find('[data-testid="topic-input"]').setValue('React hooks')
    await wrapper.find('[data-testid="generate-outline-button"]').trigger('click')

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="error-state"]').exists()).toBe(true)
    })

    await wrapper.find('[data-testid="try-again-button"]').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="source-selector"]').exists()).toBe(true)
    })
  })
})
