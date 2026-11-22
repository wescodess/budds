import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { nextTick, ref } from 'vue'
import { mockMatchMedia } from '../../support/match-media'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const courses = teachingRead('courses:listByFolder')

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useUserSession', () => () => ({ signOut: vi.fn() }))
mockNuxtImport('useConvexQuery', () => () => ({ data: ref([]) }))
mockNuxtImport('useFolders', () => () => ({ allFolders: ref([]) }))
mockNuxtImport('useGestureGuards', () => () => ({ shouldStartHorizontalGesture: () => true }))

const props = {
  folderId: 'folder-1' as any,
  folder: { _id: 'folder-1', name: 'Biology 101', color: null } as any,
  activeTab: 'learn' as const,
  activeConversationId: null,
  activeVoidId: null,
  compact: false,
  hidden: false,
  mobileExpanded: false,
  drawerSection: null,
}

describe('FolderShellRail with responses on', () => {
  beforeEach(() => resetTeachingReads())

  it('[P2] shows a small paused row and a retryable course error under Learn', async () => {
    mockMatchMedia({ mobile: false, touch: false })
    const Rail = (await import('~/components/folder-shell/FolderShellRail.vue')).default
    courses.error.value = deniedRead('test_open')
    const wrapper = await mountSuspended(Rail, { props })
    expect(wrapper.get('[data-testid="rail-courses-read-paused"]').text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
    expect(wrapper.find('[data-testid="rail-courses-read-retry"]').exists()).toBe(false)

    courses.error.value = new Error('network down')
    await nextTick()
    const before = courses.subscriptions
    courses.error.value = null
    await wrapper.get('[data-testid="rail-courses-read-retry"]').trigger('click')
    expect(courses.subscriptions).toBe(before + 1)
    courses.data.value = [{ _id: 'course-1', title: 'Cells', createdAt: 1 }]
    await vi.waitFor(() => expect(wrapper.get('[data-testid="rail-void-course-course-1"]').text()).toBe('Cells'))
    expect(wrapper.find('[data-testid="rail-courses-read-error"]').exists()).toBe(false)
  })
})
