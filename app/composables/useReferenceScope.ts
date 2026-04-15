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
  descendantFileIds?: Id<'documents'>[]
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
  const coveredFileIds = computed(() => {
    const covered = new Set<string>()
    for (const id of folderIds.value) {
      const meta = folderMeta.value.get(id as unknown as string)
      for (const fileId of meta?.descendantFileIds ?? []) {
        covered.add(fileId as unknown as string)
      }
    }
    for (const id of fileIds.value) {
      covered.add(id as unknown as string)
    }
    return covered
  })

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
    const key = folder.id as unknown as string
    const current = folderMeta.value.get(key)
    folderMeta.value.set(key, {
      ...current,
      ...folder,
      descendantFileIds: folder.descendantFileIds ?? current?.descendantFileIds,
    })
  }

  function rememberFile(file: ScopeFileSummary) {
    fileMeta.value.set(file.id as unknown as string, file)
  }

  function isFolderSelected(id: Id<'folders'>): boolean {
    return folderIds.value.has(id)
  }

  function isFileSelected(id: Id<'documents'>): boolean {
    return coveredFileIds.value.has(id as unknown as string)
  }

  function selectionStateForFolder(folder: ScopeFolderSummary): TriState {
    const remembered = folderMeta.value.get(folder.id as unknown as string)
    const descendantIds = (folder.descendantFileIds ?? remembered?.descendantFileIds ?? [])
      .map(id => id as unknown as string)

    if (descendantIds.length === 0) {
      return folderIds.value.has(folder.id) ? 'on' : 'off'
    }

    let selectedCount = 0
    for (const fileId of descendantIds) {
      if (coveredFileIds.value.has(fileId)) selectedCount++
    }

    if (selectedCount === 0) return 'off'
    if (selectedCount === descendantIds.length) return 'on'
    return 'indeterminate'
  }

  function normalizeCoverage(coverage: Set<string>) {
    const nextFolderIds = new Set<Id<'folders'>>()
    const remainingFileIds = new Set<string>(coverage)
    const folders = [...folderMeta.value.values()]
      .filter(folder => (folder.descendantFileIds?.length ?? 0) > 0)
      .sort((a, b) => (b.descendantFileIds?.length ?? 0) - (a.descendantFileIds?.length ?? 0))

    for (const folder of folders) {
      const descendantIds = (folder.descendantFileIds ?? []).map(id => id as unknown as string)
      if (descendantIds.length === 0) continue
      if (!descendantIds.every(id => remainingFileIds.has(id))) continue

      nextFolderIds.add(folder.id)
      for (const fileId of descendantIds) {
        remainingFileIds.delete(fileId)
      }
    }

    folderIds.value = nextFolderIds
    fileIds.value = new Set([...remainingFileIds].map(id => id as unknown as Id<'documents'>))
  }

  function toggleFolder(folder: ScopeFolderSummary) {
    rememberFolder(folder)
    const descendantIds = (folder.descendantFileIds ?? []).map(id => id as unknown as string)
    if (descendantIds.length === 0) return false

    const nextCoverage = new Set(coveredFileIds.value)
    const isFullySelected = descendantIds.every(id => nextCoverage.has(id))

    for (const fileId of descendantIds) {
      if (isFullySelected) nextCoverage.delete(fileId)
      else nextCoverage.add(fileId)
    }

    normalizeCoverage(nextCoverage)
    return !isFullySelected
  }

  function toggleFile(file: ScopeFileSummary) {
    rememberFile(file)
    const fileKey = file.id as unknown as string
    const nextCoverage = new Set(coveredFileIds.value)
    const isSelected = nextCoverage.has(fileKey)
    if (isSelected) nextCoverage.delete(fileKey)
    else nextCoverage.add(fileKey)
    normalizeCoverage(nextCoverage)
    return !isSelected
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
      const folder = folderMeta.value.get(chip.id)
      const nextCoverage = new Set(coveredFileIds.value)
      for (const fileId of folder?.descendantFileIds ?? []) {
        nextCoverage.delete(fileId as unknown as string)
      }
      normalizeCoverage(nextCoverage)
    } else {
      const nextCoverage = new Set(coveredFileIds.value)
      nextCoverage.delete(chip.id)
      normalizeCoverage(nextCoverage)
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
    selectionStateForFolder,
    toggleFolder,
    toggleFile,
    selectFolder,
    selectFile,
    removeChip,
    clear,
    toPayload,
  }
}
