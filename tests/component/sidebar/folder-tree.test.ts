import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createFolder, createFolders } from '../../support/factories/folder.factory'

describe('FolderTree — AC4: Folder Tree Rendering', () => {
  it('[P0] should render folder names from folders prop', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
      createFolder({ _id: 'f2', name: 'Physics 201', parentId: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    expect(wrapper.text()).toContain('Math 101')
    expect(wrapper.text()).toContain('Physics 201')
  })

  it('[P0] should highlight active folder with bg-muted styling', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
      createFolder({ _id: 'f2', name: 'Physics 201', parentId: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: 'f1' },
    })

    const activeItem = wrapper.find('[data-testid="folder-tree-item-f1"]')
    expect(activeItem.exists()).toBe(true)
    expect(activeItem.classes()).toEqual(expect.arrayContaining([expect.stringContaining('bg-muted')]))
  })

  it('[P0] should have role="tree" attribute on tree root', async () => {
    const folders = createFolders(2)
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const treeRoot = wrapper.find('[role="tree"]')
    expect(treeRoot.exists()).toBe(true)
  })

  it('[P0] should have role="treeitem" on folder items', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const treeItems = wrapper.findAll('[role="treeitem"]')
    expect(treeItems.length).toBeGreaterThanOrEqual(1)
  })
})

describe('FolderTree — AC5: Depth Enforcement & Subfolder Creation', () => {
  it('[P1] should show subfolder creation "+" button on folder items (depth < 3)', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const addButton = wrapper.find('[data-testid="add-subfolder-f1"]')
    expect(addButton.exists()).toBe(true)
  })

  it('[P1] should hide "+" button on level-3 folders (depth enforcement)', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Root Folder', parentId: undefined }),
      createFolder({ _id: 'f2', name: 'Level 2', parentId: 'f1' }),
      createFolder({ _id: 'f3', name: 'Level 3', parentId: 'f2' }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const addButton = wrapper.find('[data-testid="add-subfolder-f3"]')
    expect(addButton.exists()).toBe(false)
  })

  it('[P1] should have aria-expanded attribute on expandable items', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Root Folder', parentId: undefined }),
      createFolder({ _id: 'f2', name: 'Child Folder', parentId: 'f1' }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const expandableItem = wrapper.find('[data-testid="folder-tree-item-f1"]')
    expect(expandableItem.exists()).toBe(true)
    expect(expandableItem.attributes('aria-expanded')).toBeDefined()
  })
})
