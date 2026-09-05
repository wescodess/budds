import type { InjectionKey, ComputedRef, Ref } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { FileText, Headphones, ListChecks } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Doc, Id } from '~~/convex/_generated/dataModel'
import { useFolderDetail, useFolders } from '~/composables/useFolders'
import type { AttachmentStatus, DisplayDocument } from '~/composables/useDocuments'

export interface FolderPageContext {
  folderId: ComputedRef<Id<'folders'>>
  folder: Ref<Doc<'folders'> | null>
  seededFolder: ComputedRef<Doc<'folders'> | null>
  allFolders: ReturnType<typeof useFolders>['allFolders']

  documents: ReturnType<typeof useDocuments>['documents']
  documentsForDisplay: ComputedRef<DisplayDocument[] | undefined>
  dismissDisplayDocument: (id: string) => void
  attachmentStatus: ComputedRef<AttachmentStatus>
  uploading: Ref<boolean>
  importingLink: Ref<boolean>
  uploadFiles: (files: File[], folderId: Id<'folders'>) => Promise<void>
  importDocumentFromUrl: ReturnType<typeof useDocuments>['importDocumentFromUrl']
  deleteDocument: ReturnType<typeof useDocuments>['deleteDocument']
  deleteDocuments: ReturnType<typeof useDocuments>['deleteDocuments']
  moveDocument: ReturnType<typeof useDocuments>['moveDocument']
  moveDocuments: ReturnType<typeof useDocuments>['moveDocuments']

  referenceScope: ReturnType<typeof useFolderReferenceScope>
  helperPane: ReturnType<typeof useHelperPane>
  isDesktop: ComputedRef<boolean>

  isPodcastMain: ComputedRef<boolean>
  togglePodcastMain: () => Promise<void>
  audioOverviewShellRef: Ref<{ startGeneration: () => Promise<void> } | null>

  indexedDocumentCount: ComputedRef<number>
  tasksActiveCount: Ref<number>

  createConversation: (title: string) => Promise<Id<'conversations'>>
  createFlashcardRoom: (title?: string) => Promise<{ roomId: Id<'flashcardRooms'> }>
  createCourse: (title?: string, webSearch?: boolean) => Promise<{ courseId: Id<'courses'>; taskId: Id<'tasks'> }>
  deleteConversation: (id: Id<'conversations'>) => Promise<void>
  deleteFlashcardRoom: (roomId: Id<'flashcardRooms'>) => Promise<void>
  deleteQuiz: (quizId: Id<'quizzes'>) => Promise<void>
  deleteCourse: (courseId: Id<'courses'>) => Promise<void>

  requestDeleteDocuments: (ids: string[]) => void
  requestMoveDocuments: (ids: string[]) => void
  handleUpload: (files: File[]) => Promise<void>
  handleImportLink: (url: string) => Promise<void>
}

const FOLDER_CONTEXT_KEY: InjectionKey<FolderPageContext> = Symbol('folderPageContext')

export function provideFolderPageContext(): FolderPageContext {
  const route = useRoute()
  const folderId = computed(() => route.params.id as Id<'folders'>)

  const { folder } = useFolderDetail(folderId)
  const { allFolders } = useFolders()
  const {
    documents, documentsForDisplay, dismissDisplayDocument,
    attachmentStatus, uploading, importingLink,
    uploadFiles, importDocumentFromUrl, deleteDocument,
    deleteDocuments, moveDocument, moveDocuments,
  } = useDocuments(folderId)

  const referenceScope = useFolderReferenceScope({ folderId })

  const helperPane = useHelperPane()
  helperPane.register({ id: 'podcast', label: 'Podcast', icon: Headphones })
  helperPane.register({ id: 'sources', label: 'Sources', icon: FileText })
  helperPane.register({ id: 'tasks', label: 'Tasks', icon: ListChecks })

  const desktopMq = useMediaQuery('(min-width: 1024px)')
  const isDesktopMounted = ref(false)
  onMounted(() => { isDesktopMounted.value = true })
  const isDesktop = computed(() => isDesktopMounted.value && desktopMq.value)

  const seededFolder = computed(() =>
    folder.value
    ?? allFolders.value?.find(candidate => candidate._id === folderId.value)
    ?? null,
  )

  const setPreferredMainPaneMutation = import.meta.client
    ? useConvexMutation(api.folders.setPreferredMainPane)
    : { mutate: async (_args: { folderId: Id<'folders'>; pane: 'chat' | 'podcast' }) => ({ pane: 'chat' as const }) }

  const isPodcastMain = computed(() =>
    (folder.value as any)?.preferredMainPane === 'podcast',
  )

  async function togglePodcastMain() {
    const next = isPodcastMain.value ? 'chat' : 'podcast'
    try {
      await setPreferredMainPaneMutation.mutate({ folderId: folderId.value, pane: next } as any)
    } catch { /* best-effort */ }
  }

  const audioOverviewShellRef = ref<{ startGeneration: () => Promise<void> } | null>(null)

  const { activeCount: tasksActiveCount } = useTasks(folderId)
  const indexedDocumentCount = computed(() =>
    (documents.value ?? []).filter(doc => doc.status === 'success').length,
  )

  const createConversationMutation = import.meta.client
    ? useConvexMutation(api.conversations.createConversation)
    : { mutate: async (_args: { folderId: Id<'folders'>; title: string }) => '' as unknown as Id<'conversations'> }

  const createFlashcardRoomMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.createRoom)
    : { mutate: async (_args: { folderId: Id<'folders'>; title?: string }) => ({ roomId: '' as unknown as Id<'flashcardRooms'> }) }

  const deleteConversationMutation = import.meta.client
    ? useConvexMutation(api.conversations.deleteConversation)
    : { mutate: async (_args: { id: Id<'conversations'> }) => null }

  const deleteFlashcardRoomMutation = import.meta.client
    ? useConvexMutation(api.flashcardRooms.deleteRoom)
    : { mutate: async (_args: { roomId: Id<'flashcardRooms'> }) => null }

  const createCourseMutation = import.meta.client
    ? useConvexMutation(api.courses.create)
    : { mutate: async (_args: { title: string; sourceType: 'folder' | 'web-only'; folderId: Id<'folders'>; webSearchEnabled?: boolean }) => ({ courseId: '' as unknown as Id<'courses'>, taskId: '' as unknown as Id<'tasks'> }) }

  const deleteCourseMutation = import.meta.client
    ? useConvexAction(api.courses.deleteCourse)
    : { mutate: async (_args: { id: Id<'courses'> }) => null }

  const deleteQuizMutation = import.meta.client
    ? useConvexMutation(api.quizzes.deleteQuiz)
    : { mutate: async (_args: { quizId: Id<'quizzes'> }) => null }

  async function createConversation(title: string) {
    return (await createConversationMutation.mutate({
      folderId: folderId.value,
      title,
    })) as Id<'conversations'>
  }

  async function createFlashcardRoom(title?: string) {
    return (await createFlashcardRoomMutation.mutate({
      folderId: folderId.value,
      title,
    })) as { roomId: Id<'flashcardRooms'> }
  }

  async function createCourse(title?: string, webSearch?: boolean) {
    const hasIndexed = indexedDocumentCount.value > 0
    return (await createCourseMutation.mutate({
      title: title || 'Untitled Course',
      sourceType: hasIndexed ? 'folder' : 'web-only',
      folderId: folderId.value,
      webSearchEnabled: webSearch,
    })) as { courseId: Id<'courses'>; taskId: Id<'tasks'> }
  }

  async function deleteCourseFn(courseId: Id<'courses'>) {
    await deleteCourseMutation.mutate({ id: courseId })
  }

  async function deleteConversationFn(id: Id<'conversations'>) {
    await deleteConversationMutation.mutate({ id })
  }

  async function deleteFlashcardRoomFn(roomId: Id<'flashcardRooms'>) {
    await deleteFlashcardRoomMutation.mutate({ roomId })
  }

  async function deleteQuizFn(quizId: Id<'quizzes'>) {
    await deleteQuizMutation.mutate({ quizId })
  }

  const _deleteTargetIds = ref<string[]>([])
  const _moveTargetIds = ref<string[]>([])

  function requestDeleteDocuments(ids: string[]) {
    _deleteTargetIds.value = ids
  }

  function requestMoveDocuments(ids: string[]) {
    _moveTargetIds.value = ids
  }

  async function handleUpload(files: File[]) {
    helperPane.open('tasks')
    try {
      await uploadFiles(files, folderId.value)
    } catch (e: any) {
      const { toast } = await import('vue-sonner')
      toast.error(e.message || 'Upload failed')
    }
  }

  async function handleImportLink(url: string) {
    helperPane.open('tasks')
    try {
      await importDocumentFromUrl(url, folderId.value)
    } catch (e: any) {
      const { toast } = await import('vue-sonner')
      toast.error(e.message || 'Import failed')
    }
  }

  const ctx: FolderPageContext = {
    folderId,
    folder,
    seededFolder,
    allFolders,
    documents,
    documentsForDisplay,
    dismissDisplayDocument,
    attachmentStatus,
    uploading,
    importingLink,
    uploadFiles,
    importDocumentFromUrl,
    deleteDocument,
    deleteDocuments,
    moveDocument,
    moveDocuments,
    referenceScope,
    helperPane,
    isDesktop,
    isPodcastMain,
    togglePodcastMain,
    audioOverviewShellRef,
    indexedDocumentCount,
    tasksActiveCount,
    createConversation,
    createFlashcardRoom,
    createCourse,
    deleteConversation: deleteConversationFn,
    deleteFlashcardRoom: deleteFlashcardRoomFn,
    deleteQuiz: deleteQuizFn,
    deleteCourse: deleteCourseFn,
    requestDeleteDocuments,
    requestMoveDocuments,
    handleUpload,
    handleImportLink,
  }

  provide(FOLDER_CONTEXT_KEY, ctx)
  return ctx
}

export function injectFolderContext(): FolderPageContext {
  const ctx = inject(FOLDER_CONTEXT_KEY)
  if (!ctx) throw new Error('injectFolderContext() called outside of a folder page')
  return ctx
}
