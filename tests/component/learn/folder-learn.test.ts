import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockCourses = ref<any[]>([])

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args?: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('listByFolder')) return { data: mockCourses }
    return { data: ref(null) }
  }
})

const pagePath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', 'index.vue'].join('/')

describe('FolderLearnPage', () => {
  beforeEach(() => {
    mockCourses.value = []
  })

  it('renders empty state when no courses', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="folder-learn-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No courses in this folder yet.')
  })

  it('renders create course link in empty state', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    const link = wrapper.find('[data-testid="folder-learn-create-link"]')
    expect(link.exists()).toBe(true)
  })

  it('renders course grid when courses exist', async () => {
    mockCourses.value = [
      { _id: 'course_1', title: 'Organic Chemistry', completedSectionCount: 3, totalSectionCount: 10, pace: 'steady', status: 'ready' },
    ]
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="folder-learn-grid"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="folder-learn-empty"]').exists()).toBe(false)
  })

  it('renders create course card in grid', async () => {
    mockCourses.value = [
      { _id: 'course_1', title: 'Test Course', completedSectionCount: 0, totalSectionCount: 5, pace: 'steady', status: 'ready' },
    ]
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="create-course-card"]').exists()).toBe(true)
  })
})
