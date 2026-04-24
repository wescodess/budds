import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockCourses = ref<any[]>([])
const mockBacklog = ref<any>(null)

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args?: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('listByFolder')) return { data: mockCourses }
    if (name.includes('getReviewBacklogCount')) return { data: mockBacklog }
    return { data: ref(null) }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return () => ({ mutate: vi.fn().mockResolvedValue({ courseId: 'c1', taskId: 't1' }), isLoading: ref(false) })
})

const mockCreateCourse = vi.fn().mockResolvedValue({ courseId: 'c1', taskId: 't1' })

vi.mock('~/composables/useFolderPageContext', () => ({
  injectFolderContext: () => ({
    folderId: computed(() => 'folder_test'),
    createCourse: mockCreateCourse,
  }),
}))

const pagePath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', 'index.vue'].join('/')

describe('FolderLearnPage', () => {
  beforeEach(() => {
    mockCourses.value = []
    mockBacklog.value = null
  })

  it('renders empty state when no courses', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="folder-learn-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No courses in this folder yet.')
  })

  it('renders create course button in empty state', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    const btn = wrapper.find('[data-testid="folder-learn-create-link"]')
    expect(btn.exists()).toBe(true)
  })

  it('renders course grid when courses exist', async () => {
    mockCourses.value = [
      { _id: 'course_1', folderId: 'folder_test', title: 'Organic Chemistry', completedSectionCount: 3, totalSectionCount: 10, pace: 'steady', status: 'ready' },
    ]
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="folder-learn-grid"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="folder-learn-empty"]').exists()).toBe(false)
  })

  it('renders create course card in grid', async () => {
    mockCourses.value = [
      { _id: 'course_1', folderId: 'folder_test', title: 'Test Course', completedSectionCount: 0, totalSectionCount: 5, pace: 'steady', status: 'ready' },
    ]
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="create-course-card"]').exists()).toBe(true)
  })
})
