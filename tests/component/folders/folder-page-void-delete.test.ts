import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'

const { mockDeleteCourse, mockToast } = vi.hoisted(() => ({
  mockDeleteCourse: vi.fn(),
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock('vue-sonner', () => ({ toast: mockToast }))

mockNuxtImport('useRoute', () => {
  return () => ({ path: '/app/folders/folder_1/learn', params: { id: 'folder_1' } })
})

vi.mock('~/composables/useFolderPageContext', () => ({
  provideFolderPageContext: () => ({
    folderId: computed(() => 'folder_1'),
    folder: ref({ _id: 'folder_1', name: 'Biology' }),
    seededFolder: computed(() => ({ _id: 'folder_1', name: 'Biology' })),
    allFolders: ref([]),
    documents: ref([]),
    helperPane: { isOpen: ref(false), close: vi.fn(), toggle: vi.fn() },
    isDesktop: computed(() => false),
    togglePodcastMain: vi.fn(),
    indexedDocumentCount: computed(() => 0),
    tasksActiveCount: ref(0),
    deleteDocument: vi.fn(),
    deleteDocuments: vi.fn(),
    moveDocument: vi.fn(),
    moveDocuments: vi.fn(),
    createConversation: vi.fn(),
    createFlashcardRoom: vi.fn(),
    createAudioOverviewRoom: vi.fn(),
    deleteConversation: vi.fn(),
    deleteFlashcardRoom: vi.fn(),
    deleteAudioOverviewRoom: vi.fn(),
    deleteQuiz: vi.fn(),
    deleteCourse: mockDeleteCourse,
  }),
}))

vi.mock('~/composables/useHorizontalSwipeGesture', () => ({ useHorizontalSwipeGesture: vi.fn() }))
vi.mock('~/composables/useGestureGuards', () => ({
  useGestureGuards: () => ({ shouldStartHorizontalGesture: () => false }),
}))

const FolderShellStub = defineComponent({
  name: 'FolderShell',
  emits: ['request-delete-void', 'select-void', 'new-void', 'update:active-tab', 'navigate-learn'],
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  },
})

const pagePath = ['~', 'pages', 'app', 'folders', '[id].vue'].join('/')

describe('folder page Void deletion', () => {
  it('names a V1 record course in the deletion description and toast', async () => {
    mockDeleteCourse.mockResolvedValue(undefined)
    const Comp = await import(pagePath)
    const wrapper = await mountSuspended(Comp.default, {
      attachTo: document.body,
      global: {
        stubs: {
          FolderShell: FolderShellStub,
          NuxtPage: true,
          FolderShellHelperPane: true,
          VoidsCreateVoidDialog: true,
          MoveToFolderDialog: true,
          FoldersFolderFormModal: true,
        },
      },
    })

    wrapper.findComponent(FolderShellStub).vm.$emit('request-delete-void', {
      type: 'course',
      id: 'course_1',
      title: 'Organic Chemistry',
    })

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        'Delete "Organic Chemistry"? This will permanently remove the course.',
      )
    })

    const deleteButton = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.trim() === 'Delete')
    deleteButton!.click()

    await vi.waitFor(() => {
      expect(mockDeleteCourse).toHaveBeenCalledWith('course_1')
      expect(mockToast.success).toHaveBeenCalledWith('Course deleted')
    })
    wrapper.unmount()
  })
})
