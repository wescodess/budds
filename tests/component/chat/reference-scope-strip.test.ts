import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const path = ['~', 'components', 'chat', 'ReferenceScopeStrip.vue'].join('/')

function buildScope(options: { folderIds?: string[]; fileIds?: string[] } = {}) {
  const folderIds = ref(new Set<string>(options.folderIds ?? []))
  const fileIds = ref(new Set<string>(options.fileIds ?? []))
  const folderMeta = ref(new Map<string, any>(
    (options.folderIds ?? []).map(id => [id, { id, name: `Folder ${id}`, descendantFileCount: 2 }]),
  ))
  const fileMeta = ref(new Map<string, any>(
    (options.fileIds ?? []).map(id => [id, { id, filename: `File ${id}.pdf` }]),
  ))
  const hasSelection = computed(() => folderIds.value.size + fileIds.value.size > 0)
  const chips = computed(() => [
    ...[...folderIds.value].map(id => ({ kind: 'folder', id, label: folderMeta.value.get(id)?.name })),
    ...[...fileIds.value].map(id => ({ kind: 'file', id, label: fileMeta.value.get(id)?.filename })),
  ])
  const totalFolderCount = computed(() => folderIds.value.size)
  const totalFileCount = computed(() =>
    [...folderIds.value].reduce((n, id) => n + (folderMeta.value.get(id)?.descendantFileCount ?? 0), 0)
    + fileIds.value.size,
  )
  return {
    folderIds, fileIds, folderMeta, fileMeta, hasSelection, chips, totalFolderCount, totalFileCount,
    isFolderSelected: (id: any) => folderIds.value.has(id),
    isFileSelected: (id: any) => fileIds.value.has(id),
    folderState: () => 'off' as const,
    toggleFolder: () => {},
    toggleFile: () => {},
    removeChip: (c: any) => {
      if (c.kind === 'folder') folderIds.value.delete(c.id)
      else fileIds.value.delete(c.id)
    },
    clear: () => { folderIds.value.clear(); fileIds.value.clear() },
    toPayload: () => undefined,
  }
}

describe('ChatReferenceScopeStrip', () => {
  it('renders nothing when scope is empty', async () => {
    const Comp = await import(path)
    const wrapper = await mountSuspended(Comp.default, { props: { scope: buildScope() } })
    expect(wrapper.find('[data-testid="reference-scope-strip"]').exists()).toBe(false)
  })

  it('renders chips for folders and files', async () => {
    const Comp = await import(path)
    const wrapper = await mountSuspended(Comp.default, {
      props: { scope: buildScope({ folderIds: ['f1'], fileIds: ['doc1'] }) },
    })
    expect(wrapper.text()).toContain('Folder f1')
    expect(wrapper.text()).toContain('File doc1.pdf')
  })
})
