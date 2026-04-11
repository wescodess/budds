import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { createDocument } from '../../support/factories/document.factory'

const mockFolder = ref<any>({
  _id: 'folder1',
  name: 'Biology 101',
  parentId: undefined,
  userId: 'u1',
  documentCount: 2,
})

const mockAllFolders = ref<any[]>([
  { _id: 'folder1', name: 'Biology 101', parentId: undefined, userId: 'u1', documentCount: 2 },
])

const mockDocuments = ref<any[]>([
  createDocument({ _id: 'doc1', filename: 'lecture-1.pdf', status: 'success', fileSize: 2_097_152 }),
  createDocument({ _id: 'doc2', filename: 'notes.pdf', status: 'processing', fileSize: 512_000 }),
])

const mockUploadFiles = vi.fn()

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

mockNuxtImport('useDocuments', () => {
  return () => ({
    documents: mockDocuments,
    uploading: ref(false),
    uploadProgress: ref(new Map()),
    uploadFiles: mockUploadFiles,
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/app/folders/folder1', params: { id: 'folder1' } })
})

const folderViewPath = ['~', 'pages', 'app', 'folders', '[id].vue'].join('/')

describe('Folder Detail Page — Document Integration (AC #1, #3, #7)', () => {
  it('[P0] should render FileUploadZone component', async () => {
    const FolderView = await import(folderViewPath)

    const wrapper = await mountSuspended(FolderView.default)

    const uploadZone = wrapper.findComponent({ name: 'FileUploadZone' })
    expect(uploadZone.exists()).toBe(true)
  })

  it('[P0] should render document list with FileStatusItem components', async () => {
    const FolderView = await import(folderViewPath)

    const wrapper = await mountSuspended(FolderView.default)

    expect(wrapper.text()).toContain('lecture-1.pdf')
    expect(wrapper.text()).toContain('notes.pdf')
  })

  it('[P0] should show empty state with upload zone when no documents', async () => {
    mockDocuments.value = []
    mockFolder.value = { ...mockFolder.value, documentCount: 0 }

    const FolderView = await import(folderViewPath)
    const wrapper = await mountSuspended(FolderView.default)

    const uploadZone = wrapper.findComponent({ name: 'FileUploadZone' })
    expect(uploadZone.exists()).toBe(true)

    mockDocuments.value = [
      createDocument({ _id: 'doc1', filename: 'lecture-1.pdf', status: 'success', fileSize: 2_097_152 }),
      createDocument({ _id: 'doc2', filename: 'notes.pdf', status: 'processing', fileSize: 512_000 }),
    ]
    mockFolder.value = { ...mockFolder.value, documentCount: 2 }
  })
})
