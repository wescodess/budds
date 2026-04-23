import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockAllFolders = ref<any[]>([])
const mockRoute = ref({ path: '/app', params: {} as Record<string, string> })

mockNuxtImport('useFolders', () => {
  return () => ({
    folders: ref(null),
    allFolders: mockAllFolders,
    isLoading: ref(false),
    createFolder: vi.fn(),
    createSubfolder: vi.fn(),
    isCreating: ref(false),
  })
})

mockNuxtImport('useRoute', () => {
  return () => mockRoute.value
})

describe('App Shell Layout — AC4: Folder Breadcrumb Navigation', () => {
  it('[P0] should show "Home" link on folder page', async () => {
    mockAllFolders.value = []
    mockRoute.value = { path: '/app/folders/folder123', params: { id: 'folder123' } }
    const DefaultLayout = await import('~/layouts/default.vue')

    const wrapper = await mountSuspended(DefaultLayout.default)

    const breadcrumb = wrapper.find('[data-testid="breadcrumb-nav"]')
    const homeLink = breadcrumb.find('a[href="/"]')
    expect(homeLink.exists()).toBe(true)
    expect(homeLink.text()).toContain('Home')
  })

  it('[P0] should show folder name in breadcrumb for root-level folder view', async () => {
    mockAllFolders.value = [
      { _id: 'folder123', name: 'Math 101', parentId: undefined, userId: 'u1', documentCount: 0 },
    ]
    mockRoute.value = { path: '/app/folders/folder123', params: { id: 'folder123' } }
    const DefaultLayout = await import('~/layouts/default.vue')

    const wrapper = await mountSuspended(DefaultLayout.default)

    const breadcrumb = wrapper.find('[data-testid="breadcrumb-nav"]')
    const folderSegment = breadcrumb.find('[data-testid="breadcrumb-folder-current"]')
    expect(folderSegment.exists()).toBe(true)
    expect(folderSegment.text()).toContain('Math 101')
  })

  it('[P1] should show full ancestor hierarchy in breadcrumb for nested folder', async () => {
    mockAllFolders.value = [
      { _id: 'root1', name: 'Science', parentId: undefined, userId: 'u1', documentCount: 0 },
      { _id: 'child1', name: 'Physics', parentId: 'root1', userId: 'u1', documentCount: 0 },
      { _id: 'grand1', name: 'Mechanics', parentId: 'child1', userId: 'u1', documentCount: 0 },
    ]
    mockRoute.value = { path: '/app/folders/grand1', params: { id: 'grand1' } }
    const DefaultLayout = await import('~/layouts/default.vue')

    const wrapper = await mountSuspended(DefaultLayout.default)

    const breadcrumb = wrapper.find('[data-testid="breadcrumb-nav"]')
    const segments = breadcrumb.findAll('[data-testid^="breadcrumb-folder-"]')
    expect(segments.length).toBeGreaterThanOrEqual(3)

    const breadcrumbText = breadcrumb.text()
    expect(breadcrumbText).toContain('Science')
    expect(breadcrumbText).toContain('Physics')
    expect(breadcrumbText).toContain('Mechanics')
  })
})
