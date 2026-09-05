import { until } from '@vueuse/core'
import { api } from '#convex/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'

const MAX_FILE_SIZE = 52_428_800
const DOCUMENT_TERMINAL_TIMEOUT_MS = 180_000

export type AttachmentStatus = {
  state: 'idle' | 'uploading' | 'importing' | 'processing' | 'indexing' | 'indexed' | 'error'
  label: string
  count?: number
}

export type DisplayDocument = {
  _id: Id<'documents'> | string
  filename: string
  status: 'pending' | 'processing' | 'indexing' | 'success' | 'failed'
  fileSize: number
  _creationTime: number
  failureReason?: string
}

type PendingUpload = {
  clientId: string
  filename: string
  fileSize: number
  createdAt: number
  status: 'pending' | 'failed'
  failureReason?: string
  documentId?: Id<'documents'>
}

export function useDocuments(folderId: Ref<Id<'folders'>> | Id<'folders'>) {
  const id = isRef(folderId) ? folderId : ref(folderId)
  const nuxtApp = import.meta.client ? useNuxtApp() : null
  const convexAuthReady = import.meta.client
    ? ((nuxtApp!.$convexAuthReady as Ref<boolean> | undefined) ?? ref(false))
    : ref(true)
  const convexAuthenticated = import.meta.client
    ? ((nuxtApp!.$convexAuthenticated as Ref<boolean> | undefined) ?? ref(false))
    : ref(true)
  const convexAuthUsable = computed(
    () => convexAuthReady.value && convexAuthenticated.value,
  )

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
    { enabled: convexAuthUsable },
  )

  const uploading = ref(false)
  const uploadProgress = ref(new Map<string, 'pending' | 'uploading' | 'done' | 'error'>())
  const recentDocumentIds = ref<Set<Id<'documents'>>>(new Set())
  const pendingUploads = ref<PendingUpload[]>([])
  const dismissedDisplayIds = ref<Set<string>>(new Set())
  let clearUploadProgressTimer: number | null = null
  let clearRecentDocumentsTimer: number | null = null
  const displayDismissTimers = new Map<string, number>()

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
    pendingUploads.value = []
  }

  function clearDisplayDismissTimer(id: string) {
    const timer = displayDismissTimers.get(id)
    if (!timer || !import.meta.client) return
    clearTimeout(timer)
    displayDismissTimers.delete(id)
  }

  function dismissDisplayDocument(id: string) {
    clearDisplayDismissTimer(id)
    pendingUploads.value = pendingUploads.value.filter(
      upload => upload.clientId !== id && String(upload.documentId ?? '') !== id,
    )
    const next = new Set(dismissedDisplayIds.value)
    next.add(id)
    dismissedDisplayIds.value = next
  }

  function scheduleDisplayDismiss(id: string, delay = 10_000) {
    if (!import.meta.client || displayDismissTimers.has(id) || dismissedDisplayIds.value.has(id)) return
    const timer = window.setTimeout(() => {
      dismissDisplayDocument(id)
    }, delay)
    displayDismissTimers.set(id, timer)
  }

  function addPendingUpload(fileKey: string, file: File) {
    const clientId = `pending:${fileKey}`
    const nextDismissed = new Set(dismissedDisplayIds.value)
    nextDismissed.delete(clientId)
    dismissedDisplayIds.value = nextDismissed

    pendingUploads.value = [
      ...pendingUploads.value,
      {
        clientId,
        filename: file.name,
        fileSize: file.size,
        createdAt: Date.now(),
        status: 'pending',
      },
    ]
  }

  function linkPendingUpload(fileKey: string, documentId: Id<'documents'>) {
    const clientId = `pending:${fileKey}`
    pendingUploads.value = pendingUploads.value.map(upload =>
      upload.clientId === clientId ? { ...upload, documentId } : upload,
    )
  }

  function markPendingUploadFailed(fileKey: string, failureReason: string) {
    const clientId = `pending:${fileKey}`
    pendingUploads.value = pendingUploads.value.map(upload =>
      upload.clientId === clientId
        ? { ...upload, status: 'failed', failureReason }
        : upload,
    )
    scheduleDisplayDismiss(clientId)
  }

  function removePendingUpload(fileKey: string) {
    const clientId = `pending:${fileKey}`
    clearDisplayDismissTimer(clientId)
    pendingUploads.value = pendingUploads.value.filter(upload => upload.clientId !== clientId)
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

  function getProcessingFailureMessage(filename: string, failureReason?: string) {
    return failureReason
      ? `${filename}: ${failureReason}`
      : `${filename}: Processing failed`
  }

  async function waitForDocumentToSettle(documentId: Id<'documents'>, filename: string) {
    if (!import.meta.client) return

    await new Promise<void>((resolve, reject) => {
      let seenDocument = false
      let settled = false
      let stop = () => {}
      let timeoutId = 0

      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        stop()
        clearTimeout(timeoutId)
        callback()
      }

      stop = watch(
        () => {
          const docs = documentsData.value
          if (!docs) return undefined
          const doc = docs.find((candidate: Doc<'documents'>) => candidate._id === documentId)
          if (!doc) return null
          return {
            status: doc.status,
            failureReason: doc.failureReason,
            filename: doc.filename,
          }
        },
        (snapshot) => {
          if (snapshot === undefined) return
          if (snapshot) seenDocument = true

          if (snapshot?.status === 'success') {
            finish(resolve)
            return
          }

          if (snapshot?.status === 'failed') {
            finish(() => reject(new Error(getProcessingFailureMessage(snapshot.filename || filename, snapshot.failureReason))))
            return
          }

          if (snapshot === null && seenDocument) {
            finish(() => reject(new Error(getProcessingFailureMessage(filename))))
          }
        },
        { immediate: true },
      )

      timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error(`${filename}: Processing timed out`)))
      }, DOCUMENT_TERMINAL_TIMEOUT_MS)
    })
  }

  const trackedDocuments = computed(() => {
    if (recentDocumentIds.value.size === 0) return [] as Doc<'documents'>[]
    const byId = new Map((documentsData.value ?? []).map((doc: Doc<'documents'>) => [doc._id, doc] as const))
    return [...recentDocumentIds.value]
      .map(docId => byId.get(docId))
      .filter((doc): doc is Doc<'documents'> => Boolean(doc))
  })

  const documentsForDisplay = computed<DisplayDocument[]>(() => {
    const persistedDocuments = (documentsData.value ?? []) as Doc<'documents'>[]
    const visibleDocumentIds = new Set(persistedDocuments.map(doc => String(doc._id)))
    const optimisticRows: DisplayDocument[] = pendingUploads.value
      .filter(upload => !upload.documentId || !visibleDocumentIds.has(String(upload.documentId)))
      .filter(upload => !dismissedDisplayIds.value.has(upload.clientId))
      .map(upload => ({
        _id: upload.clientId,
        filename: upload.filename,
        status: upload.status,
        fileSize: upload.fileSize,
        _creationTime: upload.createdAt,
        failureReason: upload.failureReason,
      }))

    const persistedRows = persistedDocuments.filter((doc) => {
      if (doc.status !== 'failed') return true
      return !dismissedDisplayIds.value.has(String(doc._id))
    })

    return [...optimisticRows, ...persistedRows]
  })

  const attachmentStatus = computed<AttachmentStatus>(() => {
    const progressStates = [...uploadProgress.value.values()]
    const pendingCount = progressStates.filter(state => state === 'pending' || state === 'uploading').length
    const uploadErrorCount = progressStates.filter(state => state === 'error').length

    if (importDocumentFromUrlAction.isLoading.value) {
      return {
        state: 'importing',
        label: 'Importing from link',
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
        scheduleRecentDocumentsClear(10_000)
        return
      }

      cancelClearRecentDocumentsTimer()
    },
    { immediate: true },
  )

  watch(
    () => trackedDocuments.value.map(doc => ({ id: String(doc._id), status: doc.status })),
    (tracked) => {
      for (const doc of tracked) {
        if (doc.status === 'failed') {
          scheduleDisplayDismiss(doc.id)
        } else {
          clearDisplayDismissTimer(doc.id)
        }
      }
    },
    { immediate: true },
  )

  async function uploadFiles(files: File[], targetFolderId: Id<'folders'>) {
    await until(convexAuthUsable).toBe(true, { timeout: 5000 })

    uploading.value = true
    resetTrackedAttachmentState()

    for (const file of files) {
      const fileKey = `${file.name}-${file.size}-${file.lastModified}`
      uploadProgress.value.set(fileKey, 'pending')
      addPendingUpload(fileKey, file)
    }

    const createdDocuments = [] as Array<{ documentId: Id<'documents'>; filename: string }>

    const results = await Promise.allSettled(
      files.map(async (file) => {
        const fileKey = `${file.name}-${file.size}-${file.lastModified}`
        const allowedMimes = new Set([
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain', 'text/markdown', 'text/csv', 'text/html',
          'image/png', 'image/jpeg', 'image/webp', 'image/gif',
        ])
        const allowedExts = new Set(['pdf', 'docx', 'xlsx', 'txt', 'md', 'csv', 'html', 'png', 'jpg', 'jpeg', 'webp', 'gif'])
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (!allowedMimes.has(file.type) && !(ext && allowedExts.has(ext))) {
          uploadProgress.value.set(fileKey, 'error')
          const message = `${file.name}: Unsupported file type`
          markPendingUploadFailed(fileKey, message)
          throw new Error(message)
        }
        if (file.size > MAX_FILE_SIZE) {
          uploadProgress.value.set(fileKey, 'error')
          const message = `${file.name}: File exceeds 50MB limit`
          markPendingUploadFailed(fileKey, message)
          throw new Error(message)
        }
        uploadProgress.value.set(fileKey, 'uploading')

        const uploadUrl = (await generateUploadUrlMutation.mutate({})) as string
        if ((generateUploadUrlMutation as any).error?.value) {
          uploadProgress.value.set(fileKey, 'error')
          const err = (generateUploadUrlMutation as any).error.value
          markPendingUploadFailed(fileKey, err?.message || `${file.name}: Upload failed`)
          throw err
        }

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        })

        if (!response.ok) {
          uploadProgress.value.set(fileKey, 'error')
          const message = `${file.name}: Upload failed`
          markPendingUploadFailed(fileKey, message)
          throw new Error(message)
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
          const err = (createDocumentMutation as any).error.value
          markPendingUploadFailed(fileKey, err?.message || `${file.name}: Upload failed`)
          throw err
        }

        linkPendingUpload(fileKey, documentId)
        rememberRecentDocument(documentId)
        createdDocuments.push({ documentId, filename: file.name })
        uploadProgress.value.set(fileKey, 'done')
      }),
    )

    uploading.value = false

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason?.message || 'Upload failed')

    scheduleUploadProgressClear(errors.length > 0 ? 10_000 : 3500)

    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }

    await Promise.all(createdDocuments.map(async ({ documentId, filename }) => {
      await waitForDocumentToSettle(documentId, filename)
      pendingUploads.value = pendingUploads.value.filter(upload => upload.documentId !== documentId)
    }))
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
    if (result?.documentId) {
      await waitForDocumentToSettle(result.documentId, result.filename)
    }
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

  async function deleteDocuments(docIds: Id<'documents'>[]) {
    const failedIds: Id<'documents'>[] = []
    const failureMessages: string[] = []
    let deletedCount = 0

    for (const docId of docIds) {
      try {
        await deleteDocument(docId)
        deletedCount += 1
      }
      catch (error: any) {
        failedIds.push(docId)
        failureMessages.push(error?.message || 'Failed to delete document')
      }
    }

    return {
      deletedCount,
      failedIds,
      failureMessages,
    }
  }

  async function moveDocuments(docIds: Id<'documents'>[], destinationFolderId: Id<'folders'>) {
    const failedIds: Id<'documents'>[] = []
    const failureMessages: string[] = []
    let movedCount = 0

    for (const docId of docIds) {
      try {
        await moveDocument(docId, destinationFolderId)
        movedCount += 1
      }
      catch (error: any) {
        failedIds.push(docId)
        failureMessages.push(error?.message || 'Failed to move document')
      }
    }

    return {
      movedCount,
      failedIds,
      failureMessages,
    }
  }

  onBeforeUnmount(() => {
    cancelClearUploadProgressTimer()
    cancelClearRecentDocumentsTimer()
    for (const id of displayDismissTimers.keys()) {
      clearDisplayDismissTimer(id)
    }
  })

  return {
    documents: documentsData as Ref<Doc<'documents'>[] | null>,
    documentsForDisplay,
    dismissDisplayDocument,
    attachmentStatus,
    uploading,
    importingLink: importDocumentFromUrlAction.isLoading,
    uploadProgress,
    uploadFiles,
    importDocumentFromUrl,
    deleteDocument,
    moveDocument,
    deleteDocuments,
    moveDocuments,
  }
}
