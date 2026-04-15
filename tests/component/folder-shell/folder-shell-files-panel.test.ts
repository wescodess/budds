import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const documents = [
  {
    _id: 'doc-1',
    filename: 'Algebra Notes.pdf',
    status: 'success',
    fileSize: 220_000,
    _creationTime: Date.now(),
  },
  {
    _id: 'doc-2',
    filename: 'Chemistry Lab.pdf',
    status: 'processing',
    fileSize: 540_000,
    _creationTime: Date.now() - 86_400_000,
  },
] as const

async function mount(props: Record<string, unknown>) {
  const Panel = (await import('~/components/folder-shell/FolderShellFilesPanel.vue')).default
  return mountSuspended(Panel, { props })
}

describe('FolderShellFilesPanel', () => {
  it('[P0] exposes bulk selection entry point when documents exist', async () => {
    const wrapper = await mount({ documents })

    expect(wrapper.find('[data-testid="files-panel-bulk-toggle"]').exists()).toBe(true)
    await wrapper.find('[data-testid="files-panel-bulk-toggle"]').trigger('click')

    expect(wrapper.emitted('toggleBulkMode')).toEqual([[true]])
  })

  it('[P0] renders bulk action controls and emits selection events in bulk mode', async () => {
    const wrapper = await mount({
      documents,
      bulkMode: true,
      selectedIds: ['doc-1'],
    })

    expect(wrapper.text()).toContain('1 selected')

    await wrapper.find('[data-testid="files-panel-bulk-move"]').trigger('click')
    await wrapper.find('[data-testid="files-panel-bulk-delete"]').trigger('click')
    await wrapper.find('[data-testid="file-row-select-doc-2"]').trigger('click')

    expect(wrapper.emitted('bulkMove')).toHaveLength(1)
    expect(wrapper.emitted('bulkDelete')).toHaveLength(1)
    expect(wrapper.emitted('toggleSelect')).toEqual([['doc-2']])
  })
})
