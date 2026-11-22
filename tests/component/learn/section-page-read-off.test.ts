import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const isOnline = ref(false)
const section = ref<Record<string, unknown> | null>(null)
const sectionError = ref<Error | null>(null)
const course = ref({ _id: 'course_1', title: 'Physics', totalSectionCount: 1 })
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
  if (name === 'courses:get') return { data: course, error: ref(null), refresh: vi.fn() }
  return { data: ref(null), error: ref(null), refresh: vi.fn() }
})
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useOfflineCache', () => () => ({ cacheSectionContent: vi.fn(), getCachedSection, forgetCachedCourse }))
mockNuxtImport('useOfflineSync', () => () => ({ isSyncing: ref(false), pendingCount: ref(0) }))
mockNuxtImport('usePreFetchSection', () => () => ({ nextSectionReady: ref(false), isPreFetching: ref(false) }))
vi.mock('~/composables/useFolderPageContext', () => ({ injectFolderContext: () => ({ folderId: computed(() => 'folder_1') }) }))

const pagePath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', '[courseId]', '[sectionId].vue'].join('/')

describe('section page while responses are off', () => {
  beforeEach(() => {
    isOnline.value = true
    section.value = null
    sectionError.value = null
    getCachedSection.mockReset().mockResolvedValue(cached)
    forgetCachedCourse.mockReset().mockResolvedValue(undefined)
  })

  it('matches dev: a stale SSR error never hides the section that later arrives', async () => {
    sectionError.value = new Error('SSR query failed')
    const Page = await import(pagePath)
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.find('[data-testid="section-page-read-error"]').exists()).toBe(false)
    section.value = { _id: 'section_1', courseId: 'course_1', title: 'Live forces', order: 0, status: 'ready', masteryLevel: 'new', contentBlocks: [{ type: 'text', content: 'Live explanation of inertia', order: 0 }] }
    await vi.waitFor(() => expect(wrapper.text()).toContain('Live explanation of inertia'))
    expect(sectionError.value).not.toBeNull()
    expect(wrapper.find('[data-testid="section-page-read-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="section-page-read-paused"]').exists()).toBe(false)
    expect(forgetCachedCourse).not.toHaveBeenCalled()
  })

  it('matches dev: the offline copy still loads when offline, even beside a denial-shaped error', async () => {
    isOnline.value = false
    sectionError.value = denied('test_open')
    const Page = await import(pagePath)
    const wrapper = await mountSuspended(Page.default)
    await vi.waitFor(() => expect(wrapper.text()).toContain('Cached explanation of inertia'))
    expect(getCachedSection).toHaveBeenCalledWith('section_1')
    expect(wrapper.find('[data-testid="section-page-read-paused"]').exists()).toBe(false)
    expect(forgetCachedCourse).not.toHaveBeenCalled()
    await flushPromises()
    expect(wrapper.text()).toContain('Cached forces')
  })
})
