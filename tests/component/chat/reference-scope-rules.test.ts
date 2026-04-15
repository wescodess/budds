import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useReferenceScope } from '~/composables/useReferenceScope'

const folder = {
  id: 'folder-1',
  name: 'Folder 1',
  fileCount: 2,
  descendantFileCount: 2,
  hasChildren: false,
  descendantFileIds: ['file-1', 'file-2'],
}

const file1 = {
  id: 'file-1',
  filename: 'File 1.pdf',
  fileSize: 1024,
}

const file2 = {
  id: 'file-2',
  filename: 'File 2.pdf',
  fileSize: 2048,
}

async function mountScopeHarness() {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const scope = useReferenceScope()
      expose({ scope })
      return {}
    },
    template: '<div />',
  })

  return mountSuspended(Harness)
}

describe('useReferenceScope folder coverage rules', () => {
  it('promotes a folder selection once all of its files are selected', async () => {
    const wrapper = await mountScopeHarness()
    const scope = (wrapper.vm as { scope: ReturnType<typeof useReferenceScope> }).scope

    scope.folderMeta.value.set(folder.id, folder as any)

    scope.toggleFile(file1 as any)
    expect(scope.selectionStateForFolder(folder as any)).toBe('indeterminate')

    scope.toggleFile(file2 as any)

    expect(scope.folderIds.value.has(folder.id as any)).toBe(true)
    expect(scope.fileIds.value.size).toBe(0)
    expect(scope.selectionStateForFolder(folder as any)).toBe('on')
  })

  it('demotes a selected folder when one file is unselected but keeps remaining files selected', async () => {
    const wrapper = await mountScopeHarness()
    const scope = (wrapper.vm as { scope: ReturnType<typeof useReferenceScope> }).scope

    scope.toggleFolder(folder as any)
    expect(scope.folderIds.value.has(folder.id as any)).toBe(true)
    expect(scope.isFileSelected(file1.id as any)).toBe(true)
    expect(scope.isFileSelected(file2.id as any)).toBe(true)

    scope.toggleFile(file1 as any)

    expect(scope.folderIds.value.has(folder.id as any)).toBe(false)
    expect(scope.fileIds.value.has(file1.id as any)).toBe(false)
    expect(scope.fileIds.value.has(file2.id as any)).toBe(true)
    expect(scope.isFileSelected(file2.id as any)).toBe(true)
    expect(scope.selectionStateForFolder(folder as any)).toBe('indeterminate')
  })
})
