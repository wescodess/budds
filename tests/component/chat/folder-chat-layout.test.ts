import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { defineComponent, h, ref } from 'vue'
import { mockMatchMedia } from '../../support/match-media'

const mockFolder = ref<any>({
  _id: 'folder-1',
  name: 'Biology 101',
  color: null,
})
const mockAllFolders = ref<any[]>([mockFolder.value])
const mockMessages = ref<any[]>([
  { role: 'assistant', content: 'Hello', sources: [] },
])
const mockDocuments = ref<any[]>([])
const mockDocumentsForDisplay = ref<any[]>([])
const mockAttachmentStatus = ref({
  state: 'idle',
  label: 'Add file from link or upload',
})
const mockRouterReplace = vi.fn()
const mockRouterPush = vi.fn()

mockNuxtImport('useRoute', () => {
  return () => ({
    params: { id: 'folder-1' },
    query: {},
  })
})

mockNuxtImport('useRouter', () => {
  return () => ({
    replace: mockRouterReplace,
    push: mockRouterPush,
  })
})

mockNuxtImport('useFolderDetail', () => {
  return () => ({
    folder: mockFolder,
  })
})

mockNuxtImport('useFolders', () => {
  return () => ({
    allFolders: mockAllFolders,
    deleteFolder: vi.fn(),
  })
})

mockNuxtImport('useDocuments', () => {
  return () => ({
    documents: mockDocuments,
    documentsForDisplay: mockDocumentsForDisplay,
    dismissDisplayDocument: vi.fn(),
    attachmentStatus: mockAttachmentStatus,
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

mockNuxtImport('useChat', () => {
  return () => ({
    messages: mockMessages,
    loading: ref(false),
    streaming: ref(false),
    thinking: ref(false),
    error: ref(null),
    hasIndexedDocuments: ref(true),
    selectedModel: ref('gpt-4'),
    sendMessage: vi.fn(),
    selectModel: vi.fn(),
    loadConversation: vi.fn(),
    startNewConversation: vi.fn(),
  })
})

mockNuxtImport('useReferenceScope', () => {
  return () => ({
    hasSelection: ref(false),
    chips: ref([]),
    toPayload: () => ({}),
    removeChip: vi.fn(),
  })
})

mockNuxtImport('useConvexMutation', () => {
  return () => ({
    mutate: vi.fn(),
  })
})

mockNuxtImport('useConvex', () => {
  return () => ({
    query: vi.fn().mockResolvedValue(null),
  })
})

const PassThroughStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.())
  },
})

const FolderShellStub = defineComponent({
  name: 'FolderShell',
  setup(_props, { slots }) {
    return () => h('div', { 'data-testid': 'folder-shell-stub' }, [
      slots['top-bar']?.({
        railCollapsed: false,
        railHidden: false,
        toggleRail: () => undefined,
      }),
      slots.default?.(),
    ])
  },
})

const UiTabsContentStub = defineComponent({
  inheritAttrs: false,
  props: {
    value: {
      type: String,
      required: false,
      default: '',
    },
  },
  setup(props, { attrs, slots }) {
    return () => props.value === 'chat' ? h('div', attrs, slots.default?.()) : null
  },
})

describe('Folder Chat Layout', () => {
  beforeEach(() => {
    mockMatchMedia({ mobile: false })
    mockRouterReplace.mockReset()
    mockRouterPush.mockReset()
    mockFolder.value = {
      _id: 'folder-1',
      name: 'Biology 101',
      color: null,
    }
    mockAllFolders.value = [mockFolder.value]
    mockMessages.value = [{ role: 'assistant', content: 'Hello', sources: [] }]
    mockDocuments.value = []
    mockDocumentsForDisplay.value = []
    mockAttachmentStatus.value = {
      state: 'idle',
      label: 'Add file from link or upload',
    }
  })

  it('[P1] keeps the chat list scrollable and the composer pinned at the bottom', async () => {
    const FolderPage = await import(['~', 'pages', 'app', 'folders', '[id].vue'].join('/'))

    const wrapper = await mountSuspended(FolderPage.default, {
      global: {
        stubs: {
          FolderShell: FolderShellStub,
          UiTabs: PassThroughStub,
          UiTabsList: PassThroughStub,
          UiTabsTrigger: PassThroughStub,
          UiTabsContent: UiTabsContentStub,
          UiSkeleton: PassThroughStub,
          NuxtLink: PassThroughStub,
          VoidsCreateVoidDialog: PassThroughStub,
          ChatMessage: PassThroughStub,
          ChatReferenceChips: PassThroughStub,
          ChatThinkingRow: PassThroughStub,
          ChatModelSelector: PassThroughStub,
          ChatInput: defineComponent({
            template: '<div data-testid="chat-input-stub" />',
          }),
          FlashcardsTab: PassThroughStub,
          QuizTab: PassThroughStub,
          DocumentsFileUploadZone: PassThroughStub,
          FolderShellFilesPanel: PassThroughStub,
          FolderShellFilesList: PassThroughStub,
          Sheet: PassThroughStub,
          SheetContent: PassThroughStub,
          SheetDescription: PassThroughStub,
          SheetHeader: PassThroughStub,
          SheetTitle: PassThroughStub,
          FolderHelperPane: PassThroughStub,
          ResizableHandle: PassThroughStub,
          ResizablePanel: PassThroughStub,
          ResizablePanelGroup: PassThroughStub,
          UiAlertDialog: PassThroughStub,
          UiAlertDialogContent: PassThroughStub,
          UiAlertDialogHeader: PassThroughStub,
          UiAlertDialogTitle: PassThroughStub,
          UiAlertDialogDescription: PassThroughStub,
          UiAlertDialogFooter: PassThroughStub,
          UiAlertDialogCancel: PassThroughStub,
          UiDialog: PassThroughStub,
          UiDialogContent: PassThroughStub,
          UiDialogHeader: PassThroughStub,
          UiDialogTitle: PassThroughStub,
          UiDialogDescription: PassThroughStub,
          UiButton: PassThroughStub,
        },
      },
    })

    const scrollArea = wrapper.get('[data-testid="chat-scroll-area"]')
    const composerFooter = wrapper.get('[data-testid="chat-composer-footer"]')

    expect(scrollArea.classes()).toContain('min-h-0')
    expect(scrollArea.classes()).toContain('overflow-y-auto')
    expect(composerFooter.classes()).toContain('sticky')
    expect(composerFooter.classes()).toContain('bottom-0')
  })
})
