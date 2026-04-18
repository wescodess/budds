import { ref, computed, watch, type Ref } from 'vue'
import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  useReferenceScope,
  type ScopeFolderSummary,
  type ScopeFileSummary,
} from '~/composables/useReferenceScope'

interface PersistedScope {
  folderIds?: Id<'folders'>[]
  fileIds?: Id<'documents'>[]
}

interface UseFolderReferenceScopeOptions {
  folderId: Ref<Id<'folders'> | null | undefined>
}

const WRITE_DEBOUNCE_MS = 400

export function useFolderReferenceScope(options: UseFolderReferenceScopeOptions) {
  const scope = useReferenceScope()

  const folderArgs = computed(() => {
    const fid = options.folderId.value
    return fid ? { id: fid } : undefined
  })

  const { data: folderData } = useConvexQuery(api.folders.getFolder, folderArgs as any)

  const persistedScope = computed<PersistedScope | null>(() => {
    const row = folderData.value as any
    if (!row?.referenceScope) return null
    return {
      folderIds: row.referenceScope.folderIds ?? undefined,
      fileIds: row.referenceScope.fileIds ?? undefined,
    }
  })

  const setMutation = import.meta.client
    ? useConvexMutation(api.folders.setReferenceScope)
    : { mutate: async () => ({ cleared: true }) } as any

  const hydrated = ref(false)
  let pendingWriteTimer: ReturnType<typeof setTimeout> | null = null
  let suppressWrite = false

  watch(
    folderData,
    (row) => {
      if (!row || hydrated.value) return
      const persisted = (row as any).referenceScope as PersistedScope | undefined
      suppressWrite = true
      scope.clear()
      if (persisted?.folderIds?.length || persisted?.fileIds?.length) {
        for (const fid of persisted.folderIds ?? []) {
          scope.selectFolder({ id: fid, name: '', fileCount: 0, descendantFileCount: 0, hasChildren: false })
        }
        for (const did of persisted.fileIds ?? []) {
          scope.selectFile({ id: did, filename: '', fileSize: 0 })
        }
      }
      hydrated.value = true
      void nextTick(() => { suppressWrite = false })
    },
    { immediate: true },
  )

  function schedulePersist() {
    if (!hydrated.value) return
    if (suppressWrite) return
    if (!import.meta.client) return
    if (pendingWriteTimer) clearTimeout(pendingWriteTimer)
    pendingWriteTimer = setTimeout(() => {
      pendingWriteTimer = null
      const fid = options.folderId.value
      if (!fid) return
      const payload = scope.toPayload()
      void setMutation.mutate({ folderId: fid, scope: payload } as any).catch(() => { /* best-effort */ })
    }, WRITE_DEBOUNCE_MS)
  }

  watch(
    [() => scope.folderIds.value, () => scope.fileIds.value],
    () => { schedulePersist() },
    { deep: true },
  )

  function clearAndPersist() {
    suppressWrite = true
    scope.clear()
    void nextTick(() => { suppressWrite = false; schedulePersist() })
  }

  function rememberFolder(folder: ScopeFolderSummary) {
    scope.folderMeta.value.set(folder.id as unknown as string, {
      ...scope.folderMeta.value.get(folder.id as unknown as string),
      ...folder,
    })
  }

  function rememberFile(file: ScopeFileSummary) {
    scope.fileMeta.value.set(file.id as unknown as string, file)
  }

  return {
    ...scope,
    persistedScope,
    hydrated,
    clearAndPersist,
    rememberFolder,
    rememberFile,
  }
}
