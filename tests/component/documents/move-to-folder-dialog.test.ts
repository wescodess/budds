import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createFolder } from '../../support/factories/folder.factory'

describe('MoveToFolderDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('[P0] renders the full folder tree from roots and expands root folders by default', async () => {
    const MoveToFolderDialog = await import('~/components/documents/MoveToFolderDialog.vue')
    const folders = [
      createFolder({ _id: 'root-a', name: 'Root A', parentId: undefined }),
      createFolder({ _id: 'child-a1', name: 'Child A1', parentId: 'root-a' }),
      createFolder({ _id: 'child-a2', name: 'Child A2', parentId: 'root-a' }),
      createFolder({ _id: 'root-b', name: 'Root B', parentId: undefined }),
    ]

    await mountSuspended(MoveToFolderDialog.default, {
      props: {
        open: true,
        folders,
        currentFolderId: 'root-b',
      },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.querySelector('[data-testid="tree-node-root-a"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="tree-node-root-b"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="tree-node-child-a1"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="tree-node-child-a2"]')).not.toBeNull()
  })

  it('[P0] waits for submit before emitting the move event', async () => {
    const MoveToFolderDialog = await import('~/components/documents/MoveToFolderDialog.vue')
    const folders = [
      createFolder({ _id: 'current-folder', name: 'Current folder', parentId: undefined }),
      createFolder({ _id: 'destination-folder', name: 'Destination folder', parentId: undefined }),
    ]

    const wrapper = await mountSuspended(MoveToFolderDialog.default, {
      props: {
        open: true,
        folders,
        currentFolderId: 'current-folder',
      },
      attachTo: document.body,
    })
    await flushPromises()

    const selectBtn = document.querySelector<HTMLElement>('[data-testid="tree-node-select-destination-folder"]')
    selectBtn?.click()
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeFalsy()

    const submitBtn = document.querySelector<HTMLElement>('[data-testid="move-folder-submit"]')
    submitBtn?.click()
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([['destination-folder']])
  })

  it('[P1] disables the current folder so it cannot be selected as the destination', async () => {
    const MoveToFolderDialog = await import('~/components/documents/MoveToFolderDialog.vue')
    const folders = [
      createFolder({ _id: 'current-folder', name: 'Current folder', parentId: undefined }),
      createFolder({ _id: 'destination-folder', name: 'Destination folder', parentId: undefined }),
    ]

    const wrapper = await mountSuspended(MoveToFolderDialog.default, {
      props: {
        open: true,
        folders,
        currentFolderId: 'current-folder',
      },
      attachTo: document.body,
    })
    await flushPromises()

    const currentFolderButton = document.querySelector<HTMLElement>('[data-testid="tree-node-select-current-folder"]')
    expect(currentFolderButton?.hasAttribute('disabled') || currentFolderButton?.getAttribute('aria-disabled') === 'true').toBe(true)

    currentFolderButton?.click()
    await flushPromises()

    const submitBtn = document.querySelector<HTMLElement>('[data-testid="move-folder-submit"]')
    expect(submitBtn?.hasAttribute('disabled')).toBe(true)
    expect(wrapper.emitted('submit')).toBeFalsy()
  })
})
