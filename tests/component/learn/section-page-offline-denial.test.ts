import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const isOnline = ref(false)
const section = ref<Record<string, unknown> | null>(null)
const sectionError = ref<Error | null>(null)
const getCachedSection = vi.fn()
const forgetCachedCourse = vi.fn()
const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })
const cached = {
  sectionId: 'section_1',
  courseId: 'course_1',
  title: 'Cached forces',
  cachedAt: 1,
  contentBlocks: [{ type: 'text' as const, content: 'Cached explanation of inertia', order: 0 }],
}

mockNuxtImport('useRoute', () => () => ({ params: { courseId: 'course_1', sectionId: 'section_1' } }))
mockNuxtImport('useConvexQuery', () => (apiRef: unknown) => {
  const name = getFunctionName(apiRef as never) ?? ''
  if (name === 'courseSections:get') return { data: section, error: sectionError, refresh: vi.fn() }
  return { data: ref(null), error: ref(null), refresh: vi.fn() }
})
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useOfflineCache', () => () => ({ cacheSectionContent: vi.fn(), getCachedSection, forgetCachedCourse }))
mockNuxtImport('useOfflineSync', () => () => ({ isSyncing: ref(false), pendingCount: ref(0) }))
mockNuxtImport('usePreFetchSection', () => () => ({ nextSectionReady: ref(false), isPreFetching: ref(false) }))
vi.mock('~/composables/useFolderPageContext', () => ({ injectFolderContext: () => ({ folderId: computed(() => 'folder_1') }) }))

const pagePath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', '[courseId]', '[sectionId].vue'].join('/')

describe('section page offline copy after a denial', () => {
  beforeEach(() => {
    isOnline.value = false
    section.value = null
    sectionError.value = null
    getCachedSection.mockReset().mockResolvedValue(cached)
    forgetCachedCourse.mockReset().mockResolvedValue(undefined)
  })

  it('drops the shown offline copy and forgets the course cache when a check opens', async () => {
    const Page = await import(pagePath)
    const wrapper = await mountSuspended(Page.default)
    await vi.waitFor(() => expect(wrapper.text()).toContain('Cached explanation of inertia'))

    sectionError.value = denied('test_open')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="section-page-read-paused"]').exists()).toBe(true))
    expect(wrapper.get('[data-testid="section-page-read-paused"]').text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
    expect(wrapper.text()).not.toContain('Cached explanation of inertia')
    expect(wrapper.text()).not.toContain('Cached forces')
    expect(forgetCachedCourse).toHaveBeenCalledWith('course_1')
  })

  it('never loads the offline copy while a denial stands', async () => {
    isOnline.value = true
    sectionError.value = denied('disclosure_unknown')
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
})
