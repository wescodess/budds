import { describe, expect, it, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { provideFolderPageContext, type FolderPageContext } from '~/composables/useFolderPageContext'

const { mockCreateCourse } = vi.hoisted(() => ({
  mockCreateCourse: vi.fn(),
}))

mockNuxtImport('useRoute', () => {
  return () => ({ params: { id: 'folder_1' } })
})

vi.mock('~/composables/useFolders', () => ({
  useFolderDetail: () => ({ folder: ref(null) }),
  useFolders: () => ({ allFolders: ref([]) }),
}))

mockNuxtImport('useDocuments', () => {
  return () => ({
    documents: ref([]),
    documentsForDisplay: computed(() => []),
    dismissDisplayDocument: vi.fn(),
    attachmentStatus: computed(() => 'idle'),
    uploading: ref(false),
    importingLink: ref(false),
    uploadFiles: vi.fn(),
    importDocumentFromUrl: vi.fn(),
    deleteDocument: vi.fn(),
    deleteDocuments: vi.fn(),
    moveDocument: vi.fn(),
    moveDocuments: vi.fn(),
  })
})

mockNuxtImport('useFolderReferenceScope', () => {
  return () => ({})
})

mockNuxtImport('useHelperPane', () => {
  return () => ({ register: vi.fn(), open: vi.fn(), close: vi.fn(), toggle: vi.fn(), isOpen: ref(false) })
})

mockNuxtImport('useTasks', () => {
  return () => ({ activeCount: ref(0) })
})

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: unknown) => {
    const name = getFunctionName(apiRef as any) ?? ''
    if (name === 'courses:create') return { mutate: mockCreateCourse, isLoading: ref(false) }
    return { mutate: vi.fn().mockResolvedValue(undefined), isLoading: ref(false) }
  }
})

mockNuxtImport('useConvexAction', () => {
  return () => ({ mutate: vi.fn().mockResolvedValue(undefined), isLoading: ref(false) })
})

describe('provideFolderPageContext', () => {
  it('defaults an untitled V1 creation to Untitled Void', async () => {
    mockCreateCourse.mockResolvedValue({ courseId: 'course_1', taskId: 'task_1' })
    let ctx: FolderPageContext | undefined
    const Host = defineComponent({
      setup() {
        ctx = provideFolderPageContext()
        return () => h('div')
      },
    })
    await mountSuspended(Host)

    await ctx!.createCourse()

    expect(mockCreateCourse).toHaveBeenCalledWith(expect.objectContaining({ title: 'Untitled Void' }))
  })
})
