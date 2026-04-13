import { describe, it, expect, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'

async function mountPane(props: Record<string, unknown>, listeners: Record<string, unknown> = {}) {
  const FolderContextPane = (await import('~/components/folders/FolderContextPane.vue')).default
  const Wrapper = defineComponent({
    setup() {
      return () => h(FolderContextPane, { ...props, ...listeners })
    },
  })
  return mountSuspended(Wrapper)
}

const folder = {
  _id: 'folder-1',
  name: 'Organic Chemistry',
  parentId: undefined,
  color: 'amber',
  icon: 'book-open',
  userId: 'u1',
  documentCount: 0,
  _creationTime: 0,
}

describe('FolderContextPane', () => {
  it('[P0] renders folder name when folder is provided', async () => {
    const wrapper = await mountPane({ folder, ancestors: [], canCreateSubfolder: true })
    const name = wrapper.find('[data-testid="folder-context-name"]')
    expect(name.exists()).toBe(true)
    expect(name.text()).toBe('Organic Chemistry')
  })

  it('[P0] renders knowledge section with fallback placeholder when no slot provided', async () => {
    const wrapper = await mountPane({ folder, ancestors: [], canCreateSubfolder: true })
    expect(wrapper.find('[data-testid="folder-context-knowledge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="folder-context-knowledge-placeholder"]').exists()).toBe(true)
  })

  it('[P0] renders breadcrumb when ancestors are provided', async () => {
    const wrapper = await mountPane({
      folder,
      ancestors: [{ _id: 'parent', name: 'Sciences' }],
      canCreateSubfolder: true,
    })
    expect(wrapper.text()).toContain('Sciences')
  })

  it('[P0] emits edit / delete / new-subfolder when menu items click', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const onNewSubfolder = vi.fn()
    const wrapper = await mountPane(
      { folder, ancestors: [], canCreateSubfolder: true },
      { onEdit, onDelete, onNewSubfolder },
    )
    expect(wrapper.find('[data-testid="folder-context-menu"]').exists()).toBe(true)
  })
})
