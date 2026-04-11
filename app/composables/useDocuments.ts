import { until } from '@vueuse/core'
import { api } from '#convex/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'

const MAX_FILE_SIZE = 52_428_800

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

  async function uploadFiles(files: File[], targetFolderId: Id<'folders'>) {
    await until(convexAuthReady).toBe(true, { timeout: 5000 })

    uploading.value = true

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

        await createDocumentMutation.mutate({
          folderId: targetFolderId,
          filename: file.name,
          fileId: storageId,
          fileSize: file.size,
        })
        if ((createDocumentMutation as any).error?.value) {
          uploadProgress.value.set(fileKey, 'error')
          throw (createDocumentMutation as any).error.value
        }

        uploadProgress.value.set(fileKey, 'done')
      }),
    )

    uploading.value = false

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason?.message || 'Upload failed')

    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
  }

  async function deleteDocument(docId: Id<'documents'>) {
    await deleteDocumentMutation.mutate({ id: docId })
  }

  async function moveDocument(docId: Id<'documents'>, destinationFolderId: Id<'folders'>) {
    await moveDocumentMutation.mutate({ id: docId, destinationFolderId })
  }

  return {
    documents: documentsData as Ref<Doc<'documents'>[] | null>,
    uploading,
    uploadProgress,
    uploadFiles,
    deleteDocument,
    moveDocument,
  }
}
