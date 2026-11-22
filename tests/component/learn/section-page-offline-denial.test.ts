import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const isOnline = ref(false)
const section = teachingRead('courseSections:get')
const course = teachingRead('courses:get')
const getCachedSection = vi.fn()
const forgetCachedCourse = vi.fn()
const cached = {
  sectionId: 'section_1',
  courseId: 'course_1',
  title: 'Cached forces',
  cachedAt: 1,
  contentBlocks: [{ type: 'text' as const, content: 'Cached explanation of inertia', order: 0 }],
}

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useRoute', () => () => ({ params: { courseId: 'course_1', sectionId: 'section_1' } }))
mockNuxtImport('useConvexQuery', () => () => ({ data: ref(null) }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useOfflineCache', () => () => ({ cacheSectionContent: vi.fn(), getCachedSection, forgetCachedCourse }))
mockNuxtImport('useOfflineSync', () => () => ({ isSyncing: ref(false), pendingCount: ref(0) }))
mockNuxtImport('usePreFetchSection', () => () => ({ nextSectionReady: ref(false), isPreFetching: ref(false) }))
vi.mock('~/composables/useFolderPageContext', () => ({ injectFolderContext: () => ({ folderId: computed(() => 'folder_1') }) }))

const pagePath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', '[courseId]', '[sectionId].vue'].join('/')

describe('section page offline copy after a denial, responses on', () => {
  beforeEach(() => {
    resetTeachingReads()
    isOnline.value = false
    getCachedSection.mockReset().mockResolvedValue(cached)
    forgetCachedCourse.mockReset().mockResolvedValue(undefined)
  })

  it('drops the shown offline copy and forgets the course cache when a check opens', async () => {
    const Page = await import(pagePath)
    const wrapper = await mountSuspended(Page.default)
    await vi.waitFor(() => expect(wrapper.text()).toContain('Cached explanation of inertia'))

    section.error.value = deniedRead('test_open')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="section-page-read-paused"]').exists()).toBe(true))
    expect(wrapper.get('[data-testid="section-page-read-paused"]').text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
    expect(wrapper.text()).not.toContain('Cached explanation of inertia')
    expect(wrapper.text()).not.toContain('Cached forces')
    expect(forgetCachedCourse).toHaveBeenCalledWith('course_1')
  })

  it('never loads the offline copy while a denial stands', async () => {
    isOnline.value = true
    section.error.value = deniedRead('disclosure_unknown')
    const Page = await import(pagePath)
    const wrapper = await mountSuspended(Page.default)
    expect(forgetCachedCourse).toHaveBeenCalledWith('course_1')

    isOnline.value = false
    await nextTick()
    await flushPromises()
    expect(getCachedSection).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="section-page-read-paused"]').text()).toBe('This isn’t available right now.')
    expect(wrapper.text()).not.toContain('Cached explanation of inertia')
  })

  it('clears a stale network error once the live section arrives', async () => {
    isOnline.value = true
    section.error.value = new Error('network down')
    const Page = await import(pagePath)
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.find('[data-testid="section-page-read-error"]').exists()).toBe(true)
    course.data.value = { _id: 'course_1', title: 'Physics', totalSectionCount: 1 }
    section.error.value = null
    section.data.value = { _id: 'section_1', courseId: 'course_1', title: 'Live forces', order: 0, status: 'ready', masteryLevel: 'new', contentBlocks: [{ type: 'text', content: 'Live explanation of inertia', order: 0 }] }
    await vi.waitFor(() => expect(wrapper.text()).toContain('Live explanation of inertia'))
    expect(wrapper.find('[data-testid="section-page-read-error"]').exists()).toBe(false)
    expect(forgetCachedCourse).not.toHaveBeenCalled()
  })
})
