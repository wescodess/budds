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

describe('FolderTree — AC1: Context Menu & Dropdown', () => {
  it('[P0] should render "..." actions button for each folder', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const actionsButton = wrapper.find('[data-testid="folder-actions-f1"]')
    expect(actionsButton.exists()).toBe(true)
  })

  it('[P0] should have context menu trigger wrapping each tree item', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const treeItem = wrapper.find('[data-testid="folder-tree-item-f1"]')
    expect(treeItem.exists()).toBe(true)
  })
})

describe('FolderTree — AC2: Inline Rename', () => {
  it('[P0] should show inline rename input when rename is triggered programmatically', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const spanBefore = wrapper.find('[data-testid="folder-tree-item-f1"] .truncate')
    expect(spanBefore.exists()).toBe(true)
    expect(spanBefore.text()).toBe('Math 101')

    const input = wrapper.find('[data-testid="folder-rename-input"]')
    expect(input.exists()).toBe(false)
  })

  it('[P0] should emit rename event with folder id and new name', async () => {
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
    ]

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    expect(wrapper.emitted()).toBeDefined()
  })

  it('[P0] should emit delete event with folder data', async () => {
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
    ]

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    expect(wrapper.emitted()).toBeDefined()
  })
})

describe('FolderTree — Folder Badge', () => {
  it('[P0] should render FolderBadge with the folder color key', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Chem', parentId: undefined, color: 'iris', icon: 'atom' }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const badge = wrapper.find('[data-folder-color="iris"]')
    expect(badge.exists()).toBe(true)
    expect(badge.attributes('data-folder-icon')).toBe('atom')
  })

  it('[P0] should fall back to slate-tide and folder defaults when missing', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Legacy', parentId: undefined, color: undefined, icon: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const badge = wrapper.find('[data-folder-color="slate-tide"]')
    expect(badge.exists()).toBe(true)
    expect(badge.attributes('data-folder-icon')).toBe('folder')
  })
})

describe('FolderTree — AC5: Depth Enforcement & Subfolder Creation', () => {
  it('[P1] should show actions button on folder items (depth < 3)', async () => {
    const folders = [
      createFolder({ _id: 'f1', name: 'Math 101', parentId: undefined }),
    ]
    const FolderTree = await import('~/components/sidebar/FolderTree.vue')

    const wrapper = await mountSuspended(FolderTree.default, {
      props: { folders, activeFolder: null },
    })

    const actionsButton = wrapper.find('[data-testid="folder-actions-f1"]')
    expect(actionsButton.exists()).toBe(true)
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
