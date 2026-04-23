import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const mockCourses = ref<any[]>([])
const mockProfile = ref<any>(null)
const mockBacklog = ref<any>(null)

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args?: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('listByUser')) return { data: mockCourses }
    if (name.includes('getProfile')) return { data: mockProfile }
    if (name.includes('getReviewBacklogCount')) return { data: mockBacklog }
    return { data: ref(null) }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return () => vi.fn().mockResolvedValue(undefined)
})

const pagePath = ['~', 'pages', 'app', 'learn', 'index.vue'].join('/')

describe('Learn Home Page', () => {
  beforeEach(() => {
    mockCourses.value = []
    mockProfile.value = null
    mockBacklog.value = null
  })

  it('renders empty state when no courses', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('What do you want to learn?')
  })

  it('renders topic input in empty state', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="topic-input"]').exists()).toBe(true)
  })

  it('renders create from folders link in empty state', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="create-from-folders-link"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Create from your folders')
  })

  it('renders active state when courses exist', async () => {
    mockCourses.value = [
      {
        _id: 'course_1',
        title: 'Organic Chemistry',
        completedSectionCount: 3,
        totalSectionCount: 12,
        pace: 'intensive',
        status: 'ready',
      },
    ]
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="active-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false)
  })

  it('renders create course card in active state', async () => {
    mockCourses.value = [
      {
        _id: 'course_1',
        title: 'Test Course',
        completedSectionCount: 0,
        totalSectionCount: 5,
        pace: 'steady',
        status: 'ready',
      },
    ]
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="create-course-card"]').exists()).toBe(true)
  })

  it('renders streak display when profile has streak', async () => {
    mockProfile.value = { streakCurrent: 7, streakFreezeAvailable: true }
    mockCourses.value = [
      {
        _id: 'course_1',
        title: 'Test',
        completedSectionCount: 1,
        totalSectionCount: 5,
        pace: 'steady',
        status: 'ready',
      },
    ]
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="streak-display"]').exists()).toBe(true)
  })

  it('does not render streak display when no profile', async () => {
    mockCourses.value = [
      {
        _id: 'course_1',
        title: 'Test',
        completedSectionCount: 0,
        totalSectionCount: 5,
        pace: 'steady',
        status: 'ready',
      },
    ]
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="streak-display"]').exists()).toBe(false)
  })

  it('renders daily review CTA when items are due', async () => {
    mockCourses.value = [
      {
        _id: 'course_1',
        title: 'Test',
        completedSectionCount: 1,
        totalSectionCount: 5,
        pace: 'steady',
        status: 'ready',
      },
    ]
    mockBacklog.value = { dueCount: 12, dailyCap: 50 }

    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="daily-review-cta"]').exists()).toBe(true)
  })

  it('hides daily review CTA when no items due', async () => {
    mockCourses.value = [
      {
        _id: 'course_1',
        title: 'Test',
        completedSectionCount: 1,
        totalSectionCount: 5,
        pace: 'steady',
        status: 'ready',
      },
    ]
    mockBacklog.value = { dueCount: 0, dailyCap: 50 }

    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="daily-review-cta"]').exists()).toBe(false)
  })

  it('hides daily review CTA when backlog is not loaded', async () => {
    mockCourses.value = [
      {
        _id: 'course_1',
        title: 'Test',
        completedSectionCount: 1,
        totalSectionCount: 5,
        pace: 'steady',
        status: 'ready',
      },
    ]

    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="daily-review-cta"]').exists()).toBe(false)
  })
})
