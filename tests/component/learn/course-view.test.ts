import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockCourse = ref<any>(null)
const mockSections = ref<any[]>([])
let queryCallCount = 0

mockNuxtImport('useConvexQuery', () => {
  return (_apiRef: any, _args?: any) => {
    queryCallCount++
    if (queryCallCount % 2 === 1) return { data: mockCourse }
    return { data: mockSections }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return (_api: unknown) => ({
    mutate: vi.fn(),
    isLoading: ref(false),
  })
})

const pagePath = ['~', 'pages', 'app', 'learn', '[courseId]', 'index.vue'].join('/')

const baseCourse = {
  _id: 'course_abc',
  title: 'Organic Chemistry',
  completedSectionCount: 3,
  totalSectionCount: 5,
  pace: 'steady' as const,
  status: 'ready',
}

const baseSections = [
  { _id: 'sec_1', title: 'Functional Groups', status: 'completed', masteryLevel: 'mastered', order: 0 },
  { _id: 'sec_2', title: 'Reaction Mechanisms', status: 'completed', masteryLevel: 'learning', order: 1 },
  { _id: 'sec_3', title: 'Stereochemistry', status: 'completed', masteryLevel: 'new', order: 2 },
  { _id: 'sec_4', title: 'Spectroscopy', status: 'ready', masteryLevel: 'new', order: 3 },
  { _id: 'sec_5', title: 'Synthesis', status: 'locked', masteryLevel: 'new', order: 4 },
]

describe('CourseView — Progress & Mastery Dashboard', () => {
  beforeEach(() => {
    queryCallCount = 0
    mockCourse.value = { ...baseCourse }
    mockSections.value = [...baseSections]
  })

  it('renders progress bar with correct percentage', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const progressBar = wrapper.find('[data-testid="progress-bar"]')
    expect(progressBar.exists()).toBe(true)
    expect(progressBar.attributes('aria-valuenow')).toBe('60')
    expect(progressBar.attributes('aria-label')).toContain('60%')
  })

  it('displays section count and percentage text', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    expect(wrapper.text()).toContain('3/5 sections')
    expect(wrapper.text()).toContain('60% complete')
  })

  it('renders mastery badges on completed sections', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const badges = wrapper.findAll('[data-testid="mastery-badge-desktop"]')
    expect(badges.length).toBe(3)
  })

  it('renders compact mastery badges for mobile', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const mobileBadges = wrapper.findAll('[data-testid="mastery-badge-mobile"]')
    expect(mobileBadges.length).toBe(3)
  })

  it('applies amber left border to current (ready) section', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const currentSection = wrapper.find('[data-testid="section-item-sec_4"]')
    expect(currentSection.exists()).toBe(true)
    expect(currentSection.classes()).toEqual(expect.arrayContaining(['border-l-amber-500']))
  })

  it('renders completed sections as clickable links', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const completedLink = wrapper.find('[data-testid="section-item-sec_1"]')
    expect(completedLink.element.tagName.toLowerCase()).toBe('a')
  })

  it('renders locked sections as non-clickable', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const lockedSection = wrapper.find('[data-testid="section-item-sec_5"]')
    expect(lockedSection.element.tagName.toLowerCase()).not.toBe('a')
  })

  it('renders desktop action buttons', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const actionsDesktop = wrapper.find('[data-testid="actions-desktop"]')
    expect(actionsDesktop.exists()).toBe(true)
    expect(actionsDesktop.find('[data-testid="edit-outline-btn"]').exists()).toBe(true)
    expect(actionsDesktop.find('[data-testid="change-pace-btn"]').exists()).toBe(true)
    expect(actionsDesktop.find('[data-testid="delete-course-trigger"]').exists()).toBe(true)
  })

  it('renders mobile three-dot menu', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const actionsMobile = wrapper.find('[data-testid="actions-mobile"]')
    expect(actionsMobile.exists()).toBe(true)
    expect(actionsMobile.find('[data-testid="mobile-menu-trigger"]').exists()).toBe(true)
  })

  it('toggles pace selector on Change Pace click', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    expect(wrapper.find('[data-testid="pace-selector-panel"]').exists()).toBe(false)
    await wrapper.find('[data-testid="change-pace-btn"]').trigger('click')
    expect(wrapper.find('[data-testid="pace-selector-panel"]').exists()).toBe(true)
  })

  it('does not show mastery badges on locked sections', async () => {
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const lockedSection = wrapper.find('[data-testid="section-item-sec_5"]')
    expect(lockedSection.exists()).toBe(true)
    const badges = lockedSection.findAll('[data-testid="mastery-badge"]')
    expect(badges.length).toBe(0)
  })

  it('handles 0% progress correctly', async () => {
    mockCourse.value = { ...baseCourse, completedSectionCount: 0 }
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const progressBar = wrapper.find('[data-testid="progress-bar"]')
    expect(progressBar.exists()).toBe(true)
    expect(progressBar.attributes('aria-valuenow')).toBe('0')
  })

  it('handles 100% progress correctly', async () => {
    mockCourse.value = { ...baseCourse, completedSectionCount: 5 }
    mockSections.value = baseSections.map(s => ({ ...s, status: 'completed', masteryLevel: 'mastered' }))
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      route: '/app/learn/course_abc',
    })
    const progressBar = wrapper.find('[data-testid="progress-bar"]')
    expect(progressBar.exists()).toBe(true)
    expect(progressBar.attributes('aria-valuenow')).toBe('100')
  })
})
