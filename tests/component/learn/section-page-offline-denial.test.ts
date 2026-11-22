import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { flushPromises } from '@vue/test-utils'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const isOnline = ref(false)
const params = reactive({ courseId: 'course_1', sectionId: 'section_1' })
const completeSection = vi.fn()
const setOffline = vi.fn()
const cacheSectionContent = vi.fn()
const fetchPayload = vi.fn()
const section = teachingRead('courseSections:get')
const course = teachingRead('courses:get')
const getCachedSection = vi.fn()
const mounted: Array<{ unmount: () => void }> = []
const forgetCachedCourse = vi.fn()
const cached = {
  sectionId: 'section_1',
  courseId: 'course_1',
  title: 'Cached forces',
  cachedAt: 1,
  contentBlocks: [{ type: 'text' as const, content: 'Cached explanation of inertia', order: 0 }],
}

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('$fetch', () => (request: Parameters<typeof $fetch>[0], options: Parameters<typeof $fetch>[1]) => String(request).startsWith('/api/learn/section-cache-payload') ? fetchPayload(request, options) : globalThis.$fetch(request, options))
mockNuxtImport('useRoute', () => () => ({ params }))
mockNuxtImport('useConvexQuery', () => () => ({ data: ref(null) }))
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: getFunctionName(reference) === 'courseSections:completeSection' ? completeSection : setOffline, isLoading: ref(false) }))
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useOfflineCache', () => () => ({ cacheSectionContent, getCachedSection, forgetCachedCourse }))
mockNuxtImport('useOfflineSync', () => () => ({ isSyncing: ref(false), pendingCount: ref(0) }))
mockNuxtImport('usePreFetchSection', () => () => ({ nextSectionReady: ref(false), isPreFetching: ref(false) }))
vi.mock('~/composables/useFolderPageContext', () => ({ injectFolderContext: () => ({ folderId: computed(() => 'folder_1') }) }))

const pagePath = ['~', 'pages', 'app', 'folders', '[id]', 'learn', '[courseId]', '[sectionId].vue'].join('/')

async function mountPage() {
  const Page = await import(pagePath)
  const wrapper = await mountSuspended(Page.default, { route: '/login' })
  mounted.push(wrapper)
  return wrapper
}

describe('section page offline copy after a denial, responses on', () => {
  beforeAll(async () => { await import(pagePath) })
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    resetTeachingReads()
    params.courseId = 'course_1'
    params.sectionId = 'section_1'
    completeSection.mockReset().mockResolvedValue({ practiceScore: 100, masteryLevel: 'learning', conceptsForReview: 0, feedbackText: '' })
    setOffline.mockReset().mockResolvedValue(undefined)
    cacheSectionContent.mockReset().mockResolvedValue(undefined)
    fetchPayload.mockReset().mockResolvedValue(null)
    isOnline.value = false
    getCachedSection.mockReset().mockResolvedValue(cached)
    forgetCachedCourse.mockReset().mockResolvedValue(undefined)
  })

  it('drops the shown offline copy and forgets the course cache when a check opens', async () => {
    const wrapper = await mountPage()
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
    const wrapper = await mountPage()
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
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="section-page-read-error"]').exists()).toBe(true)
    course.data.value = { _id: 'course_1', title: 'Physics', totalSectionCount: 1 }
    section.error.value = null
    section.data.value = { _id: 'section_1', courseId: 'course_1', title: 'Live forces', order: 0, status: 'ready', masteryLevel: 'new', contentBlocks: [{ type: 'text', content: 'Live explanation of inertia', order: 0 }] }
    await vi.waitFor(() => expect(wrapper.text()).toContain('Live explanation of inertia'))
    expect(wrapper.find('[data-testid="section-page-read-error"]').exists()).toBe(false)
    expect(forgetCachedCourse).not.toHaveBeenCalled()
  })
  it('drops an offline copy after an unavailable denial on reconnect, and keeps retry', async () => {
    const wrapper = await mountPage()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Cached explanation of inertia'))
    isOnline.value = true
    section.error.value = deniedRead('unavailable')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Cached explanation of inertia')
    expect(forgetCachedCourse).toHaveBeenCalledWith('course_1')
    expect(wrapper.find('[data-testid="section-page-read-retry"]').exists()).toBe(true)
  })

  it('retains the offline explanation on a transport error when reconnecting', async () => {
    const wrapper = await mountPage()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Cached explanation of inertia'))
    isOnline.value = true
    section.error.value = new Error('Network down')
    await flushPromises()
    expect(wrapper.text()).toContain('Cached explanation of inertia')
    expect(forgetCachedCourse).not.toHaveBeenCalled()
  })

  it('rejects a cache load started before revocation even after retry clears the failure', async () => {
    const load = Promise.withResolvers<typeof cached>()
    getCachedSection.mockReturnValue(load.promise)
    const wrapper = await mountPage()
    await vi.waitFor(() => expect(getCachedSection).toHaveBeenCalledTimes(1))
    section.error.value = deniedRead('unavailable')
    await nextTick()
    section.error.value = null
    await wrapper.get('[data-testid="section-page-read-retry"]').trigger('click')
    load.resolve(cached)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Cached explanation of inertia')
    expect(getCachedSection).toHaveBeenCalledTimes(1)
  })

  it('rejects a cache load for the previous route and clears a shown cached section on navigation', async () => {
    const load = Promise.withResolvers<typeof cached>()
    getCachedSection.mockReturnValueOnce(load.promise).mockResolvedValue(null)
    const wrapper = await mountPage()
    params.sectionId = 'section_2'
    await nextTick()
    load.resolve(cached)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Cached explanation of inertia')
    expect(getCachedSection).toHaveBeenLastCalledWith('section_2')
  })

  it.each(['revocation', 'route', 'dispose'] as const)('does not write a cache payload that finishes after %s', async (change) => {
    isOnline.value = true
    course.data.value = { _id: 'course_1', title: 'Physics', totalSectionCount: 1 }
    section.data.value = { _id: 'section_1', courseId: 'course_1', title: 'Live forces', order: 0, status: 'ready', masteryLevel: 'new', contentBlocks: [] }
    const payload = Promise.withResolvers<typeof cached>()
    fetchPayload.mockReturnValue(payload.promise)
    const wrapper = await mountPage()
    await wrapper.get('[data-testid="complete-section-button"]').trigger('click')
    expect(completeSection).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(fetchPayload).toHaveBeenCalledTimes(1))
    if (change === 'revocation') {
      section.error.value = deniedRead('unavailable')
      await nextTick()
      section.error.value = null
    } else if (change === 'route') params.sectionId = 'section_2'
    else wrapper.unmount()
    await nextTick()
    payload.resolve(cached)
    await flushPromises()
    expect(cacheSectionContent).not.toHaveBeenCalled()
    expect(setOffline).not.toHaveBeenCalled()
  })

  it.each(['denial', 'transport'] as const)('handles a cache payload %s without confusing retry with revocation', async (kind) => {
    isOnline.value = true
    course.data.value = { _id: 'course_1', title: 'Physics', totalSectionCount: 1 }
    section.data.value = { _id: 'section_1', courseId: 'course_1', title: 'Live forces', order: 0, status: 'ready', masteryLevel: 'new', contentBlocks: [] }
    const cause = kind === 'denial' ? Object.assign(new Error('HTTP 409'), { data: { data: { admission: { status: 'denied', reasonCode: 'unavailable' } } } }) : new Error('Network down')
    fetchPayload.mockRejectedValue(cause)
    const wrapper = await mountPage()
    await wrapper.get('[data-testid="complete-section-button"]').trigger('click')
    await flushPromises()
    expect(fetchPayload).toHaveBeenCalledTimes(1)
    expect(cacheSectionContent).not.toHaveBeenCalled()
    expect(setOffline).not.toHaveBeenCalled()
    if (kind === 'denial') {
      expect(forgetCachedCourse).toHaveBeenCalledWith('course_1')
      expect(wrapper.find('[data-testid="section-page-read-retry"]').exists()).toBe(true)
      const before = section.subscriptions
      await wrapper.get('[data-testid="section-page-read-retry"]').trigger('click')
      expect(section.subscriptions).toBe(before + 1)
    } else {
      expect(forgetCachedCourse).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="section-page-read-error"]').exists()).toBe(false)
    }
  })

  it('does not mark a section offline when its cache write finishes after revocation', async () => {
    isOnline.value = true
    course.data.value = { _id: 'course_1', title: 'Physics', totalSectionCount: 1 }
    section.data.value = { _id: 'section_1', courseId: 'course_1', title: 'Live forces', order: 0, status: 'ready', masteryLevel: 'new', contentBlocks: [] }
    const write = Promise.withResolvers<undefined>()
    fetchPayload.mockResolvedValue(cached)
    cacheSectionContent.mockReturnValue(write.promise)
    const wrapper = await mountPage()
    await wrapper.get('[data-testid="complete-section-button"]').trigger('click')
    await vi.waitFor(() => expect(cacheSectionContent).toHaveBeenCalledTimes(1))
    section.error.value = deniedRead('unavailable')
    await nextTick()
    section.error.value = null
    await nextTick()
    write.resolve(undefined)
    await flushPromises()
    expect(setOffline).not.toHaveBeenCalled()
    expect(forgetCachedCourse).toHaveBeenCalledWith('course_1')
  })

})
