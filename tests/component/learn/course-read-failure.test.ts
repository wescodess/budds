import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const forgetCachedCourse = vi.fn()
const coursesByFolder = teachingRead('courses:listByFolder')
const course = teachingRead('courses:get')
const sections = teachingRead('courseSections:listByCourse')
const pausedCopy = 'This is paused while you have a check open. Finish the check, then come back.'

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useConvexQuery', () => () => ({ data: ref(null) }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
mockNuxtImport('useRoute', () => () => ({ params: { id: 'folder_test', courseId: 'course_1' } }))
mockNuxtImport('useOfflineCache', () => () => ({ forgetCachedCourse }))

vi.mock('~/composables/useFolderPageContext', () => ({
  injectFolderContext: () => ({ folderId: computed(() => 'folder_test'), createCourse: vi.fn() }),
}))

const folderLearnPath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', 'index.vue'].join('/')
const coursePath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', '[courseId]', 'index.vue'].join('/')

describe('course surfaces with responses on', () => {
  beforeEach(() => {
    resetTeachingReads()
    forgetCachedCourse.mockReset().mockResolvedValue(undefined)
  })

  describe('folder Learn page', () => {
    it('explains a course read paused by an open check without offering a retry', async () => {
      coursesByFolder.error.value = deniedRead('test_open')
      const Comp = await import(folderLearnPath)
      const wrapper = await mountSuspended(Comp.default)
      const paused = wrapper.get('[data-testid="folder-learn-read-paused"]')
      expect(paused.attributes('role')).toBe('status')
      expect(paused.text()).toBe(pausedCopy)
      expect(paused.find('svg').classes()).toContain('text-[var(--learn-attention)]')
      expect(wrapper.find('[data-testid="folder-learn-read-retry"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="folder-learn-empty"]').exists()).toBe(false)
    })

    it('says a course read is unavailable when disclosure is unknown', async () => {
      coursesByFolder.error.value = deniedRead('disclosure_unknown')
      const Comp = await import(folderLearnPath)
      const wrapper = await mountSuspended(Comp.default)
      expect(wrapper.get('[data-testid="folder-learn-read-paused"]').text()).toBe('This isn’t available right now.')
      expect(wrapper.find('[data-testid="folder-learn-read-retry"]').exists()).toBe(false)
    })

    it('retries a failed course read by subscribing again and recovers to the grid', async () => {
      coursesByFolder.error.value = new Error('network down')
      const Comp = await import(folderLearnPath)
      const wrapper = await mountSuspended(Comp.default)
      expect(wrapper.get('[data-testid="folder-learn-read-error"]').text()).toContain('Could not load courses.')
      expect(wrapper.find('[data-testid="folder-learn-empty"]').exists()).toBe(false)
      const before = coursesByFolder.subscriptions
      coursesByFolder.error.value = null
      await wrapper.get('[data-testid="folder-learn-read-retry"]').trigger('click')
      expect(coursesByFolder.subscriptions).toBe(before + 1)
      coursesByFolder.data.value = [{ _id: 'course_1', folderId: 'folder_test', title: 'Recovered', completedSectionCount: 0, totalSectionCount: 5, pace: 'steady', status: 'ready' }]
      await vi.waitFor(() => expect(wrapper.find('[data-testid="folder-learn-grid"]').exists()).toBe(true))
      expect(wrapper.find('[data-testid="folder-learn-read-error"]').exists()).toBe(false)
    })

    it('treats an unavailable denial as retryable', async () => {
      coursesByFolder.error.value = deniedRead('unavailable')
      const Comp = await import(folderLearnPath)
      const wrapper = await mountSuspended(Comp.default)
      expect(wrapper.find('[data-testid="folder-learn-read-retry"]').exists()).toBe(true)
    })
  })

  describe('course page', () => {
    it('pauses the course and forgets its offline sections when a check opens', async () => {
      course.data.value = { _id: 'course_1', title: 'Organic Chemistry', completedSectionCount: 0, totalSectionCount: 1, pace: 'steady', status: 'ready' }
      sections.data.value = [{ _id: 'section_1', courseId: 'course_1', title: 'Functional Groups', order: 0, status: 'ready', masteryLevel: 'new' }]
      const Comp = await import(coursePath)
      const wrapper = await mountSuspended(Comp.default)
      await vi.waitFor(() => expect(wrapper.text()).toContain('Functional Groups'))
      expect(forgetCachedCourse).not.toHaveBeenCalled()

      sections.error.value = deniedRead('test_open')
      await vi.waitFor(() => expect(wrapper.find('[data-testid="course-view-read-paused"]').exists()).toBe(true))
      expect(wrapper.get('[data-testid="course-view-read-paused"]').text()).toBe(pausedCopy)
      expect(wrapper.text()).not.toContain('Functional Groups')
      expect(wrapper.find('[data-testid="course-view-read-retry"]').exists()).toBe(false)
      expect(forgetCachedCourse).toHaveBeenCalledWith('course_1')
    })

    it('retries only the failed read and recovers', async () => {
      course.data.value = { _id: 'course_1', title: 'Organic Chemistry', completedSectionCount: 0, totalSectionCount: 1, pace: 'steady', status: 'ready' }
      sections.error.value = new Error('network down')
      const Comp = await import(coursePath)
      const wrapper = await mountSuspended(Comp.default)
      expect(wrapper.get('[data-testid="course-view-read-error"]').text()).toContain('Could not load this Void.')
      const courseBefore = course.subscriptions
      const sectionsBefore = sections.subscriptions
      sections.error.value = null
      await wrapper.get('[data-testid="course-view-read-retry"]').trigger('click')
      expect(sections.subscriptions).toBe(sectionsBefore + 1)
      expect(course.subscriptions).toBe(courseBefore)
      sections.data.value = [{ _id: 'section_1', courseId: 'course_1', title: 'Functional Groups', order: 0, status: 'ready', masteryLevel: 'new' }]
      await vi.waitFor(() => expect(wrapper.text()).toContain('Functional Groups'))
      expect(wrapper.find('[data-testid="course-view-read-error"]').exists()).toBe(false)
      expect(forgetCachedCourse).not.toHaveBeenCalled()
    })
  })
})
