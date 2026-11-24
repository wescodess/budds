import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { nextTick, ref } from 'vue'
import { getFunctionName } from 'convex/server'
import { mockMatchMedia } from '../../support/match-media'

const mockCourses = ref<any[]>([])
const mockCoursesError = ref<Error | null>(null)

mockNuxtImport('useUserSession', () => {
  return () => ({
    signOut: vi.fn(),
  })
})

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: unknown) => getFunctionName(apiRef as any) === 'courses:listByFolder'
    ? { data: mockCourses, error: mockCoursesError }
    : { data: ref([]) }
})

mockNuxtImport('useFolders', () => {
  return () => ({
    allFolders: ref([]),
  })
})

mockNuxtImport('useGestureGuards', () => {
  return () => ({
    shouldStartHorizontalGesture: () => true,
  })
})

describe('FolderShellRail', () => {
  it('[P1] renders compact desktop items without requiring an outer tooltip provider', async () => {
    mockMatchMedia({ mobile: false, touch: false })
    const Rail = (await import('~/components/folder-shell/FolderShellRail.vue')).default

    const wrapper = await mountSuspended(Rail, {
      props: {
        folderId: 'folder-1' as any,
        folder: {
          _id: 'folder-1',
          name: 'Biology 101',
          color: null,
        } as any,
        activeTab: 'chat',
        activeConversationId: null,
        activeVoidId: null,
        compact: true,
        hidden: false,
        mobileExpanded: false,
        drawerSection: null,
      },
    })

    expect(wrapper.get('[data-testid="rail-item-members"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="rail-item-knowledge"]').exists()).toBe(true)
  })

  it('[P2] names an untitled V1 record Course', async () => {
    mockMatchMedia({ mobile: false, touch: false })
    mockCourses.value = [{ _id: 'course-1', title: '  ', createdAt: 1 }]
    const Rail = (await import('~/components/folder-shell/FolderShellRail.vue')).default

    const wrapper = await mountSuspended(Rail, {
      props: {
        folderId: 'folder-1' as any,
        folder: {
          _id: 'folder-1',
          name: 'Biology 101',
          color: null,
        } as any,
        activeTab: 'learn',
        activeConversationId: null,
        activeVoidId: null,
        compact: false,
        hidden: false,
        mobileExpanded: false,
        drawerSection: null,
      },
    })

    expect(wrapper.get('[data-testid="rail-void-course-course-1"]').text()).toBe('Course')
    mockCourses.value = []
  })

  it('[P2] matches dev while responses are off: course errors never replace the course list', async () => {
    mockMatchMedia({ mobile: false, touch: false })
    const Rail = (await import('~/components/folder-shell/FolderShellRail.vue')).default
    mockCoursesError.value = Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode: 'test_open' } } })
    const wrapper = await mountSuspended(Rail, {
      props: {
        folderId: 'folder-1' as any,
        folder: { _id: 'folder-1', name: 'Biology 101', color: null } as any,
        activeTab: 'learn',
        activeConversationId: null,
        activeVoidId: null,
        compact: false,
        hidden: false,
        mobileExpanded: false,
        drawerSection: null,
      },
    })
    expect(wrapper.find('[data-testid="rail-courses-read-paused"]').exists()).toBe(false)
    mockCourses.value = [{ _id: 'course-2', title: 'Cells', createdAt: 1 }]
    await nextTick()
    expect(wrapper.get('[data-testid="rail-void-course-course-2"]').text()).toBe('Cells')
    expect(wrapper.find('[data-testid="rail-courses-read-error"]').exists()).toBe(false)
    mockCourses.value = []
    mockCoursesError.value = null
  })
})
