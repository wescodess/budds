import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

mockNuxtImport('useConvexMutation', () => {
  return (_api: unknown) => ({
    mutate: vi.fn(),
    isLoading: ref(false),
  })
})

mockNuxtImport('useConvexAction', () => {
  return (_api: unknown) => ({
    mutate: vi.fn(),
    isLoading: ref(false),
  })
})

const courseViewPath = ['~', 'components', 'learn', 'CourseViewBody.vue'].join('/')

const baseCourse = {
  _id: 'course_abc',
  title: 'Organic Chemistry',
  completedSectionCount: 2,
  totalSectionCount: 4,
  pace: 'steady' as const,
  status: 'ready',
}

const sectionsWithOffline = [
  { _id: 'sec_1', title: 'Functional Groups', status: 'completed', masteryLevel: 'mastered', order: 0, offlineAvailable: true },
  { _id: 'sec_2', title: 'Reaction Mechanisms', status: 'completed', masteryLevel: 'learning', order: 1, offlineAvailable: false },
  { _id: 'sec_3', title: 'Stereochemistry', status: 'ready', masteryLevel: 'new', order: 2 },
  { _id: 'sec_4', title: 'Synthesis', status: 'locked', masteryLevel: 'new', order: 3 },
]

const baseProps = {
  course: baseCourse,
  sections: sectionsWithOffline,
  courseId: 'course_abc' as any,
  folderId: 'folder_123' as any,
  backUrl: '/app/folders/folder_123/learn/',
  backLabel: 'Back to folder courses',
  sectionUrlPrefix: '/app/folders/folder_123/learn/course_abc',
  needsStart: false,
}

describe('CourseViewBody — Offline indicators', () => {
  it('shows filled download icon for offlineAvailable sections', async () => {
    const Comp = await import(courseViewPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const sec1 = wrapper.find('[data-testid="section-item-sec_1"]')
    expect(sec1.find('[data-testid="offline-cached-icon"]').exists()).toBe(true)
    expect(sec1.find('[data-testid="offline-not-cached-icon"]').exists()).toBe(false)
  })

  it('shows outlined download icon for completed sections without offline cache', async () => {
    const Comp = await import(courseViewPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const sec2 = wrapper.find('[data-testid="section-item-sec_2"]')
    expect(sec2.find('[data-testid="offline-not-cached-icon"]').exists()).toBe(true)
    expect(sec2.find('[data-testid="offline-cached-icon"]').exists()).toBe(false)
  })

  it('does not show offline icon for non-completed sections', async () => {
    const Comp = await import(courseViewPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const sec3 = wrapper.find('[data-testid="section-item-sec_3"]')
    expect(sec3.find('[data-testid="offline-cached-icon"]').exists()).toBe(false)
    expect(sec3.find('[data-testid="offline-not-cached-icon"]').exists()).toBe(false)
  })

  it('does not show offline icon for locked sections', async () => {
    const Comp = await import(courseViewPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const sec4 = wrapper.find('[data-testid="section-item-sec_4"]')
    expect(sec4.find('[data-testid="offline-cached-icon"]').exists()).toBe(false)
    expect(sec4.find('[data-testid="offline-not-cached-icon"]').exists()).toBe(false)
  })

  it('cached icon has correct aria-label', async () => {
    const Comp = await import(courseViewPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const cachedIcon = wrapper.find('[data-testid="offline-cached-icon"]')
    expect(cachedIcon.attributes('aria-label')).toBe('Functional Groups available offline')
  })

  it('not-cached icon has correct aria-label', async () => {
    const Comp = await import(courseViewPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const notCachedIcon = wrapper.find('[data-testid="offline-not-cached-icon"]')
    expect(notCachedIcon.attributes('aria-label')).toBe('Reaction Mechanisms not cached offline')
  })
})
