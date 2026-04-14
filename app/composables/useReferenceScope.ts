import type { Id } from '../../convex/_generated/dataModel'

export type TriState = 'off' | 'on' | 'indeterminate'

export interface ScopeFolderSummary {
  id: Id<'folders'>
  name: string
  color?: string
  icon?: string
  fileCount: number
  descendantFileCount: number
  hasChildren: boolean
}

export interface ScopeFileSummary {
  id: Id<'documents'>
  filename: string
  fileSize: number
}

export interface ScopeChip {
  kind: 'folder' | 'file'
  id: string
  label: string
}

export function useReferenceScope() {
  const folderIds = ref<Set<Id<'folders'>>>(new Set())
  const fileIds = ref<Set<Id<'documents'>>>(new Set())
  const folderMeta = ref<Map<string, ScopeFolderSummary>>(new Map())
  const fileMeta = ref<Map<string, ScopeFileSummary>>(new Map())

  const hasSelection = computed(() => folderIds.value.size > 0 || fileIds.value.size > 0)
  const totalFolderCount = computed(() => folderIds.value.size)

  const totalFileCount = computed(() => {
    let count = 0
    for (const id of folderIds.value) {
      const meta = folderMeta.value.get(id as unknown as string)
      count += meta?.descendantFileCount ?? 0
    }
    count += fileIds.value.size
    return count
  })

  const chips = computed<ScopeChip[]>(() => {
    const out: ScopeChip[] = []
    for (const id of folderIds.value) {
      const meta = folderMeta.value.get(id as unknown as string)
      out.push({ kind: 'folder', id: id as unknown as string, label: meta?.name ?? 'Folder' })
    }
    for (const id of fileIds.value) {
      const meta = fileMeta.value.get(id as unknown as string)
      out.push({ kind: 'file', id: id as unknown as string, label: meta?.filename ?? 'File' })
    }
    return out
  })

  function rememberFolder(folder: ScopeFolderSummary) {
    folderMeta.value.set(folder.id as unknown as string, folder)
  }

  function rememberFile(file: ScopeFileSummary) {
    fileMeta.value.set(file.id as unknown as string, file)
  }

  function isFolderSelected(id: Id<'folders'>): boolean {
    return folderIds.value.has(id)
  }

  function isFileSelected(id: Id<'documents'>): boolean {
    return fileIds.value.has(id)
  }

  function folderState(
    id: Id<'folders'>,
    children: { subfolders: Id<'folders'>[]; files: Id<'documents'>[] },
  ): TriState {
    if (folderIds.value.has(id)) return 'on'
    const total = children.subfolders.length + children.files.length
    if (total === 0) return 'off'
    let selected = 0
    let partial = 0
    for (const sid of children.subfolders) {
      if (folderIds.value.has(sid)) selected++
    }
    for (const fid of children.files) {
      if (fileIds.value.has(fid)) selected++
    }
    if (selected === 0 && partial === 0) return 'off'
    if (selected === total) return 'indeterminate'
    return 'indeterminate'
  }

  function toggleFolder(folder: ScopeFolderSummary) {
    rememberFolder(folder)
    if (folderIds.value.has(folder.id)) {
      folderIds.value.delete(folder.id)
    } else {
      folderIds.value.add(folder.id)
    }
    folderIds.value = new Set(folderIds.value)
  }

  function toggleFile(file: ScopeFileSummary) {
    rememberFile(file)
    if (fileIds.value.has(file.id)) {
      fileIds.value.delete(file.id)
    } else {
      fileIds.value.add(file.id)
    }
    fileIds.value = new Set(fileIds.value)
  }

  function selectFolder(folder: ScopeFolderSummary) {
    rememberFolder(folder)
    if (folderIds.value.has(folder.id)) return false
    folderIds.value.add(folder.id)
    folderIds.value = new Set(folderIds.value)
    return true
  }

  function selectFile(file: ScopeFileSummary) {
    rememberFile(file)
    if (fileIds.value.has(file.id)) return false
    fileIds.value.add(file.id)
    fileIds.value = new Set(fileIds.value)
    return true
  }

  function removeChip(chip: ScopeChip) {
    if (chip.kind === 'folder') {
      folderIds.value.delete(chip.id as unknown as Id<'folders'>)
      folderIds.value = new Set(folderIds.value)
    } else {
      fileIds.value.delete(chip.id as unknown as Id<'documents'>)
      fileIds.value = new Set(fileIds.value)
    }
  }

  function clear() {
    folderIds.value = new Set()
    fileIds.value = new Set()
  }

  function toPayload(): { folderIds?: Id<'folders'>[]; fileIds?: Id<'documents'>[] } | undefined {
    if (!hasSelection.value) return undefined
    const payload: { folderIds?: Id<'folders'>[]; fileIds?: Id<'documents'>[] } = {}
    if (folderIds.value.size > 0) payload.folderIds = [...folderIds.value]
    if (fileIds.value.size > 0) payload.fileIds = [...fileIds.value]
    return payload
  }

  return {
    folderIds,
    fileIds,
    folderMeta,
    fileMeta,
    hasSelection,
    totalFolderCount,
    totalFileCount,
    chips,
    isFolderSelected,
    isFileSelected,
    folderState,
    toggleFolder,
    toggleFile,
    selectFolder,
    selectFile,
    removeChip,
    clear,
    toPayload,
  }
}
