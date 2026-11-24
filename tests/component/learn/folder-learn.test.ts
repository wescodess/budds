import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockCourses = ref<any[]>([])
const mockBacklog = ref<any>(null)
const mockCoursesError = ref<Error | null>(null)
const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args?: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('listByFolder')) return { data: mockCourses, error: mockCoursesError }
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
    mockCoursesError.value = null
  })

  it('renders empty state when no courses', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="folder-learn-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No courses in this folder yet.')
    expect(wrapper.find('h1 + p').text()).toBe('Courses in this folder')
  })

  it('renders create course button in empty state', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    const btn = wrapper.find('[data-testid="folder-learn-create-link"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('Create a course from this folder')
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

  it('matches dev while responses are off: a stale SSR error never hides courses that later arrive', async () => {
    mockCoursesError.value = new Error('SSR query failed')
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="folder-learn-read-error"]').exists()).toBe(false)
    mockCourses.value = [{ _id: 'course_1', folderId: 'folder_test', title: 'Organic Chemistry', completedSectionCount: 3, totalSectionCount: 10, pace: 'steady', status: 'ready' }]
    await vi.waitFor(() => expect(wrapper.find('[data-testid="folder-learn-grid"]').exists()).toBe(true))
    expect(mockCoursesError.value).not.toBeNull()
    expect(wrapper.find('[data-testid="folder-learn-read-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="folder-learn-read-paused"]').exists()).toBe(false)
  })

  it('ignores denial-shaped errors while responses are off', async () => {
    mockCoursesError.value = denied('test_open')
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="folder-learn-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="folder-learn-read-paused"]').exists()).toBe(false)
  })
})
