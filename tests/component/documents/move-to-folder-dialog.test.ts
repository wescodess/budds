import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createFolder } from '../../support/factories/folder.factory'

describe('MoveToFolderDialog', () => {
  it('[P0] renders the full folder tree from roots and expands root folders by default', async () => {
    const MoveToFolderDialog = await import('~/components/documents/MoveToFolderDialog.vue')
    const folders = [
      createFolder({ _id: 'root-a', name: 'Root A', parentId: undefined }),
      createFolder({ _id: 'child-a1', name: 'Child A1', parentId: 'root-a' }),
      createFolder({ _id: 'child-a2', name: 'Child A2', parentId: 'root-a' }),
      createFolder({ _id: 'root-b', name: 'Root B', parentId: undefined }),
    ]

    const wrapper = await mountSuspended(MoveToFolderDialog.default, {
      props: {
        open: true,
        folders,
        currentFolderId: 'root-b',
      },
    })

    expect(wrapper.find('[data-testid="tree-node-root-a"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-node-root-b"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-node-child-a1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-node-child-a2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-node-root-a"] [title="2 subfolders"]').exists()).toBe(true)
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
    })

    await wrapper.find('[data-testid="tree-node-select-destination-folder"]').trigger('click')

    expect(wrapper.emitted('submit')).toBeFalsy()

    await wrapper.find('[data-testid="move-folder-submit"]').trigger('click')

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
    })

    const currentFolderButton = wrapper.find('[data-testid="tree-node-select-current-folder"]')
    expect(currentFolderButton.attributes('disabled')).toBeDefined()

    await currentFolderButton.trigger('click')

    expect(wrapper.find('[data-testid="move-folder-submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('submit')).toBeFalsy()
  })
})
