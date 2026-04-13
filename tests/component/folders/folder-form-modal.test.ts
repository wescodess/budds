import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createFolder } from '../../support/factories/folder.factory'

const createFolderMock = vi.fn()
const createSubfolderMock = vi.fn()
const updateFolderMock = vi.fn()
const deleteFolderMock = vi.fn()

mockNuxtImport('useFolders', () => {
  return () => ({
    folders: ref(null),
    allFolders: ref([]),
    allFoldersLoading: ref(false),
    isLoading: ref(false),
    createFolder: createFolderMock,
    createSubfolder: createSubfolderMock,
    renameFolder: vi.fn(),
    updateFolder: updateFolderMock,
    deleteFolder: deleteFolderMock,
    isCreating: ref(false),
  })
})

describe('FolderFormModal — create mode', () => {
  it('[P0] renders with "New folder" title', async () => {
    const Modal = await import('~/components/folders/FolderFormModal.vue')
    const wrapper = await mountSuspended(Modal.default, {
      props: { open: true, mode: 'create' },
      attachTo: document.body,
    })
    await flushPromises()

    const body = document.body.innerHTML
    expect(body).toContain('New folder')
  })

  it('[P0] blocks submission when name is empty', async () => {
    createFolderMock.mockClear()
    const Modal = await import('~/components/folders/FolderFormModal.vue')
    const wrapper = await mountSuspended(Modal.default, {
      props: { open: true, mode: 'create' },
      attachTo: document.body,
    })
    await flushPromises()

    const submit = document.querySelector<HTMLButtonElement>('[data-testid="folder-form-submit"]')
    submit?.click()
    await flushPromises()

    expect(createFolderMock).not.toHaveBeenCalled()
  })
})

describe('FolderFormModal — edit mode', () => {
  it('[P0] pre-fills the name from the folder prop', async () => {
    const folder = createFolder({ _id: 'f1', name: 'Physics', color: 'iris', icon: 'atom' })
    const Modal = await import('~/components/folders/FolderFormModal.vue')
    const wrapper = await mountSuspended(Modal.default, {
      props: { open: true, mode: 'edit', folder: folder as any },
      attachTo: document.body,
    })
    await flushPromises()

    const nameInput = document.querySelector<HTMLInputElement>('input[data-testid="folder-name-input"]')
    expect(nameInput).not.toBeNull()
    const formValues = (wrapper.vm as any).getFormValues()
    expect(formValues.name).toBe('Physics')
    expect(formValues.color).toBe('iris')
    expect(formValues.icon).toBe('atom')
  })

  it('[P0] renders the Danger Zone with a Delete button', async () => {
    const folder = createFolder({ _id: 'f1', name: 'Physics' })
    const Modal = await import('~/components/folders/FolderFormModal.vue')
    await mountSuspended(Modal.default, {
      props: { open: true, mode: 'edit', folder: folder as any },
      attachTo: document.body,
    })
    await flushPromises()

    const danger = document.querySelector('[data-testid="folder-danger-zone"]')
    expect(danger).not.toBeNull()
    const deleteBtn = document.querySelector('[data-testid="folder-delete-button"]')
    expect(deleteBtn).not.toBeNull()
  })
})
