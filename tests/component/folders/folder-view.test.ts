import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockFolder = ref<any>({ _id: 'folder1', name: 'Biology 101', parentId: undefined, userId: 'u1', documentCount: 0 })
const mockAllFolders = ref<any[]>([
  { _id: 'folder1', name: 'Biology 101', parentId: undefined, userId: 'u1', documentCount: 0 },
])

mockNuxtImport('useFolderDetail', () => {
  return () => ({
    folder: mockFolder,
  })
})

mockNuxtImport('useFolders', () => {
  return () => ({
    folders: ref(null),
    allFolders: mockAllFolders,
    allFoldersLoading: ref(false),
    isLoading: ref(false),
    createFolder: vi.fn(),
    createSubfolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    isCreating: ref(false),
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/app/folders/folder1', params: { id: 'folder1' } })
})

const folderViewPath = ['~', 'pages', 'app', 'folders', '[id].vue'].join('/')

describe('FolderView — AC4: Folder Detail Page', () => {
  it('[P0] should render folder name as heading', async () => {
    const FolderView = await import(folderViewPath)

    const wrapper = await mountSuspended(FolderView.default)

    const heading = wrapper.find('[data-testid="folder-heading"]')
    expect(heading.exists()).toBe(true)
    expect(heading.text()).toBeTruthy()
  })

  it('[P0] should show "Documents will appear here" empty state', async () => {
    const FolderView = await import(folderViewPath)

    const wrapper = await mountSuspended(FolderView.default)

    const emptyState = wrapper.find('[data-testid="folder-empty-state"]')
    expect(emptyState.exists()).toBe(true)
    expect(emptyState.text()).toContain('Documents will appear here')
  })

  it('[P1] should show "New Subfolder" button', async () => {
    const FolderView = await import(folderViewPath)

    const wrapper = await mountSuspended(FolderView.default)

    const newSubfolderBtn = wrapper.find('[data-testid="new-subfolder-button"]')
    expect(newSubfolderBtn.exists()).toBe(true)
    expect(newSubfolderBtn.text()).toContain('New Subfolder')
  })
})
