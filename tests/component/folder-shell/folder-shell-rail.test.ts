import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { mockMatchMedia } from '../../support/match-media'

mockNuxtImport('useUserSession', () => {
  return () => ({
    signOut: vi.fn(),
  })
})

mockNuxtImport('useConvexQuery', () => {
  return () => ({
    data: ref([]),
  })
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
})
