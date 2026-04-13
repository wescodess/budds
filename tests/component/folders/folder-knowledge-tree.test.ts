import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'

async function mount(props: Record<string, unknown>, listeners: Record<string, unknown> = {}) {
  const Tree = (await import('~/components/folders/FolderKnowledgeTree.vue')).default
  const Wrapper = defineComponent({
    setup() {
      return () => h(Tree, { ...props, ...listeners })
    },
  })
  return mountSuspended(Wrapper)
}

const subfolders = [
  { _id: 'sf1', name: 'Foundations', parentId: 'root', color: 'amber', icon: 'book-open', userId: 'u1', documentCount: 3, _creationTime: 0 },
  { _id: 'sf2', name: 'Reaction Mechanisms', parentId: 'root', color: 'blue', icon: 'book-open', userId: 'u1', documentCount: 2, _creationTime: 0 },
]

const documents = [
  { _id: 'd1', filename: 'Bruice_CH6.pdf', fileSize: 450_000, userId: 'u1', folderId: 'root', _creationTime: 0, status: 'success' },
  { _id: 'd2', filename: 'Stereo_Basics.pdf', fileSize: 1_200_000, userId: 'u1', folderId: 'root', _creationTime: 0, status: 'success' },
]

describe('FolderKnowledgeTree', () => {
  it('[P0] renders subfolders and documents', async () => {
    const wrapper = await mount({ subfolders, documents, canCreateSubfolder: true })
    expect(wrapper.find('[data-testid="folder-knowledge-tree"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="folder-knowledge-tree-subfolder-sf1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="folder-knowledge-tree-doc-d1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Foundations')
    expect(wrapper.text()).toContain('Bruice_CH6.pdf')
  })

  it('[P0] filters both lists by search query', async () => {
    const wrapper = await mount({ subfolders, documents, canCreateSubfolder: true })
    const input = wrapper.find('[data-testid="folder-knowledge-tree-search"]')
    await input.setValue('stereo')
    expect(wrapper.find('[data-testid="folder-knowledge-tree-subfolder-sf1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="folder-knowledge-tree-doc-d2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="folder-knowledge-tree-doc-d1"]').exists()).toBe(false)
  })

  it('[P0] shows empty drop zone when no documents and no search', async () => {
    const wrapper = await mount({ subfolders: [], documents: [], canCreateSubfolder: true })
    expect(wrapper.find('[data-testid="folder-knowledge-tree-empty-drop"]').exists()).toBe(true)
  })

  it('[P0] subfolder row is clickable', async () => {
    const wrapper = await mount({ subfolders, documents, canCreateSubfolder: true })
    const row = wrapper.find('[data-testid="folder-knowledge-tree-subfolder-sf2"]')
    expect(row.exists()).toBe(true)
    await row.trigger('click')
    expect(row.exists()).toBe(true)
  })

  it('[P0] emits newSubfolder when footer button clicked', async () => {
    const wrapper = await mount({ subfolders, documents, canCreateSubfolder: true })
    expect(wrapper.find('[data-testid="folder-knowledge-tree-new-subfolder"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="folder-knowledge-tree-upload"]').exists()).toBe(true)
  })
})
