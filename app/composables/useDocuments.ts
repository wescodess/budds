import { until } from '@vueuse/core'
import { api } from '#convex/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'

const MAX_FILE_SIZE = 52_428_800

export type AttachmentStatus = {
  state: 'idle' | 'uploading' | 'importing' | 'processing' | 'indexing' | 'indexed' | 'error'
  label: string
  count?: number
}

export function useDocuments(folderId: Ref<Id<'folders'>> | Id<'folders'>) {
  const id = isRef(folderId) ? folderId : ref(folderId)

  const generateUploadUrlMutation = import.meta.client
    ? useConvexMutation(api.documents.generateUploadUrl)
    : { mutate: async (_args: Record<string, never>) => '' as string, isLoading: ref(false) }

  const createDocumentMutation = import.meta.client
    ? useConvexMutation(api.documents.createDocument)
    : {
        mutate: async (_args: { folderId: Id<'folders'>; filename: string; fileId: Id<'_storage'>; fileSize: number }) => {},
        isLoading: ref(false),
      }

  const importDocumentFromUrlAction = import.meta.client
    ? useConvexAction(api.documentImports.importDocumentFromUrl)
    : {
        mutate: async (_args: { folderId: Id<'folders'>; url: string }) => undefined,
        isLoading: ref(false),
      }

  const deleteDocumentMutation = import.meta.client
    ? useConvexMutation(api.documents.deleteDocument)
    : { mutate: async (_args: { id: Id<'documents'> }) => {}, isLoading: ref(false) }

  const moveDocumentMutation = import.meta.client
    ? useConvexMutation(api.documents.moveDocument)
    : { mutate: async (_args: { id: Id<'documents'>; destinationFolderId: Id<'folders'> }) => {}, isLoading: ref(false) }

  const { data: documentsData } = useConvexQuery(
    api.documents.listDocumentsByFolder,
    computed(() => ({ folderId: id.value })),
  )

  const convexAuthReady = import.meta.client
    ? (useNuxtApp().$convexAuthReady as Ref<boolean>)
    : ref(true)

  const uploading = ref(false)
  const uploadProgress = ref(new Map<string, 'pending' | 'uploading' | 'done' | 'error'>())
  const recentDocumentIds = ref<Set<Id<'documents'>>>(new Set())
  let clearUploadProgressTimer: number | null = null
  let clearRecentDocumentsTimer: number | null = null

  function cancelClearUploadProgressTimer() {
    if (!clearUploadProgressTimer) return
    clearTimeout(clearUploadProgressTimer)
    clearUploadProgressTimer = null
  }

  function cancelClearRecentDocumentsTimer() {
    if (!clearRecentDocumentsTimer) return
    clearTimeout(clearRecentDocumentsTimer)
    clearRecentDocumentsTimer = null
  }

  function scheduleUploadProgressClear(delay = 3500) {
    if (!import.meta.client) return
    cancelClearUploadProgressTimer()
    clearUploadProgressTimer = window.setTimeout(() => {
      uploadProgress.value = new Map()
      clearUploadProgressTimer = null
    }, delay)
  }

  function scheduleRecentDocumentsClear(delay = 3500) {
    if (!import.meta.client) return
    cancelClearRecentDocumentsTimer()
    clearRecentDocumentsTimer = window.setTimeout(() => {
      recentDocumentIds.value = new Set()
      clearRecentDocumentsTimer = null
    }, delay)
  }

  function resetTrackedAttachmentState() {
    cancelClearUploadProgressTimer()
    cancelClearRecentDocumentsTimer()
    uploadProgress.value = new Map()
    recentDocumentIds.value = new Set()
  }

  function rememberRecentDocument(documentId: Id<'documents'> | undefined) {
    if (!documentId) return
    cancelClearRecentDocumentsTimer()
    const next = new Set(recentDocumentIds.value)
    next.add(documentId)
    recentDocumentIds.value = next
  }

  function pluralize(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`
  }

  const trackedDocuments = computed(() => {
    if (recentDocumentIds.value.size === 0) return [] as Doc<'documents'>[]
    const byId = new Map((documentsData.value ?? []).map((doc: Doc<'documents'>) => [doc._id, doc] as const))
    return [...recentDocumentIds.value]
      .map(docId => byId.get(docId))
      .filter((doc): doc is Doc<'documents'> => Boolean(doc))
  })

  const attachmentStatus = computed<AttachmentStatus>(() => {
    const progressStates = [...uploadProgress.value.values()]
    const pendingCount = progressStates.filter(state => state === 'pending' || state === 'uploading').length
    const uploadErrorCount = progressStates.filter(state => state === 'error').length

    if (importDocumentFromUrlAction.isLoading.value) {
      return {
        state: 'importing',
        label: 'Importing PDF from link',
      }
    }

    if (uploading.value || pendingCount > 0) {
      const count = Math.max(pendingCount, 1)
      return {
        state: 'uploading',
        count,
        label: `${pluralize(count, 'document')} uploading`,
      }
    }

    if (uploadErrorCount > 0) {
      return {
        state: 'error',
        count: uploadErrorCount,
        label: `${pluralize(uploadErrorCount, 'upload')} failed`,
      }
    }

    const trackedCount = recentDocumentIds.value.size
    if (trackedCount > 0) {
      const unseenCount = Math.max(0, trackedCount - trackedDocuments.value.length)
      const processingCount = trackedDocuments.value.filter(doc => doc.status === 'processing').length + unseenCount
      const indexingCount = trackedDocuments.value.filter(doc => doc.status === 'indexing').length
      const indexedCount = trackedDocuments.value.filter(doc => doc.status === 'success').length
      const failedCount = trackedDocuments.value.filter(doc => doc.status === 'failed').length

      if (failedCount > 0) {
        return {
          state: 'error',
          count: failedCount,
          label: `${pluralize(failedCount, 'document')} failed to process`,
        }
      }

      if (processingCount > 0) {
        return {
          state: 'processing',
          count: processingCount,
          label: `${pluralize(processingCount, 'document')} processing`,
        }
      }

      if (indexingCount > 0) {
        return {
          state: 'indexing',
          count: indexingCount,
          label: `${pluralize(indexingCount, 'document')} indexing`,
        }
      }

      if (indexedCount > 0) {
        return {
          state: 'indexed',
          count: indexedCount,
          label: `${pluralize(indexedCount, 'document')} indexed`,
        }
      }
    }

    return {
      state: 'idle',
      label: 'Add file from link or upload',
    }
  })

  watch(
    () => attachmentStatus.value.state,
    (state) => {
      if (state === 'indexed') {
        scheduleRecentDocumentsClear(3200)
        return
      }

      if (state === 'error' && recentDocumentIds.value.size > 0) {
        scheduleRecentDocumentsClear(6000)
        return
      }

      cancelClearRecentDocumentsTimer()
    },
    { immediate: true },
  )

  async function uploadFiles(files: File[], targetFolderId: Id<'folders'>) {
    await until(convexAuthReady).toBe(true, { timeout: 5000 })

    uploading.value = true
    resetTrackedAttachmentState()

    for (const file of files) {
      uploadProgress.value.set(`${file.name}-${file.size}-${file.lastModified}`, 'pending')
    }

    const results = await Promise.allSettled(
      files.map(async (file) => {
        const fileKey = `${file.name}-${file.size}-${file.lastModified}`
        if (file.type !== 'application/pdf') {
          uploadProgress.value.set(fileKey, 'error')
          throw new Error(`${file.name}: Only PDF files are supported`)
        }
        if (file.size > MAX_FILE_SIZE) {
          uploadProgress.value.set(fileKey, 'error')
          throw new Error(`${file.name}: File exceeds 50MB limit`)
        }
        uploadProgress.value.set(fileKey, 'uploading')

        const uploadUrl = (await generateUploadUrlMutation.mutate({})) as string
        if ((generateUploadUrlMutation as any).error?.value) {
          uploadProgress.value.set(fileKey, 'error')
          throw (generateUploadUrlMutation as any).error.value
        }

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        })

        if (!response.ok) {
          uploadProgress.value.set(fileKey, 'error')
          throw new Error(`${file.name}: Upload failed`)
        }

        const { storageId } = await response.json()

        const documentId = await createDocumentMutation.mutate({
          folderId: targetFolderId,
          filename: file.name,
          fileId: storageId,
          fileSize: file.size,
        }) as Id<'documents'>
        if ((createDocumentMutation as any).error?.value) {
          uploadProgress.value.set(fileKey, 'error')
          throw (createDocumentMutation as any).error.value
        }

        rememberRecentDocument(documentId)
        uploadProgress.value.set(fileKey, 'done')
      }),
    )

    uploading.value = false

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason?.message || 'Upload failed')

    scheduleUploadProgressClear(errors.length > 0 ? 6000 : 3500)

    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
  }

  async function importDocumentFromUrl(url: string, targetFolderId: Id<'folders'>) {
    resetTrackedAttachmentState()

    const result = await importDocumentFromUrlAction.mutate({
      folderId: targetFolderId,
      url,
    })

    if ((importDocumentFromUrlAction as any).error?.value) {
      const err = (importDocumentFromUrlAction as any).error.value
      ;(importDocumentFromUrlAction as any).error.value = undefined
      throw err
    }

    rememberRecentDocument(result?.documentId)
    return result
  }

  async function deleteDocument(docId: Id<'documents'>) {
    const result = await deleteDocumentMutation.mutate({ id: docId })
    if ((deleteDocumentMutation as any).error?.value) {
      const err = (deleteDocumentMutation as any).error.value
      ;(deleteDocumentMutation as any).error.value = undefined
      throw err
    }
    return result
  }

  async function moveDocument(docId: Id<'documents'>, destinationFolderId: Id<'folders'>) {
    const result = await moveDocumentMutation.mutate({ id: docId, destinationFolderId })
    if ((moveDocumentMutation as any).error?.value) {
      const err = (moveDocumentMutation as any).error.value
      ;(moveDocumentMutation as any).error.value = undefined
      throw err
    }
    return result
  }

  return {
    documents: documentsData as Ref<Doc<'documents'>[] | null>,
    attachmentStatus,
    uploading,
    importingLink: importDocumentFromUrlAction.isLoading,
    uploadProgress,
    uploadFiles,
    importDocumentFromUrl,
    deleteDocument,
    moveDocument,
  }
}
