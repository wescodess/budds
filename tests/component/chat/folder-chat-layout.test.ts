import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
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
const mockRoute = {
  params: { id: 'folder-1' },
  query: {} as Record<string, unknown>,
}

mockNuxtImport('useRoute', () => {
  return () => mockRoute
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
  setup(_props, { slots, expose }) {
    const railState = ref<'hidden' | 'compact' | 'expanded'>('hidden')

    expose({
      showMobileRailCompact() {
        railState.value = 'compact'
      },
      expandMobileRail() {
        railState.value = 'expanded'
      },
      collapseMobileRailToCompact() {
        railState.value = 'compact'
      },
      hideMobileRail() {
        railState.value = 'hidden'
      },
      getMobileRailState() {
        return railState.value
      },
    })

    return () => h('div', { 'data-testid': 'folder-shell-stub' }, [
      h('div', {
        'data-testid': 'folder-shell-rail-state',
        'data-rail-state': railState.value,
      }, railState.value),
      slots['top-bar']?.({
        railCollapsed: false,
        railHidden: railState.value === 'hidden',
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

function dispatchPointer(target: Element, type: string, init: Record<string, unknown>) {
  const event = typeof PointerEvent === 'function'
    ? new PointerEvent(type, { bubbles: true, ...init })
    : Object.assign(new Event(type, { bubbles: true }), init)
  target.dispatchEvent(event)
}

async function swipeHorizontal(target: Element, startX: number, endX: number, pointerId = 1) {
  dispatchPointer(target, 'pointerdown', {
    pointerId,
    pointerType: 'touch',
    clientX: startX,
    clientY: 48,
    buttons: 1,
  })
  dispatchPointer(target, 'pointermove', {
    pointerId,
    pointerType: 'touch',
    clientX: endX,
    clientY: 48,
    buttons: 1,
  })
  dispatchPointer(target, 'pointerup', {
    pointerId,
    pointerType: 'touch',
    clientX: endX,
    clientY: 48,
    buttons: 0,
  })
  await flushPromises()
}

async function mountFolderPage() {
  const FolderPage = await import(['~', 'pages', 'app', 'folders', '[id].vue'].join('/'))

  return mountSuspended(FolderPage.default, {
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
        ChatMessage: defineComponent({
          template: `
            <div data-testid="chat-message-stub">
              <div data-testid="swipe-reveal-row" data-gesture-owner="swipe-reveal">Swipe row</div>
            </div>
          `,
        }),
        ChatReferenceChips: PassThroughStub,
        ChatThinkingRow: PassThroughStub,
        ChatModelSelector: PassThroughStub,
        ChatInput: defineComponent({
          template: '<button type="button" data-testid="chat-input-control">Composer</button>',
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
}

describe('Folder Chat Layout', () => {
  beforeEach(() => {
    mockMatchMedia({ mobile: false })
    mockRouterReplace.mockReset()
    mockRouterPush.mockReset()
    mockRoute.query = {}
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
    const wrapper = await mountFolderPage()

    const scrollArea = wrapper.get('[data-testid="chat-scroll-area"]')
    const composerFooter = wrapper.get('[data-testid="chat-composer-footer"]')

    expect(scrollArea.classes()).toContain('min-h-0')
    expect(scrollArea.classes()).toContain('overflow-y-auto')
    expect(composerFooter.classes()).toContain('sticky')
    expect(composerFooter.classes()).toContain('bottom-0')
  })

  it('[P1] uses sidebar-first mobile workspace swipes before any tab change', async () => {
    mockMatchMedia({ touch: true, mobile: true })

    const wrapper = await mountFolderPage()
    const scrollArea = wrapper.get('[data-testid="chat-scroll-area"]')
    const railState = () => wrapper.get('[data-testid="folder-shell-rail-state"]').attributes('data-rail-state')

    expect(railState()).toBe('hidden')

    await swipeHorizontal(scrollArea.element, 13, 108)
    expect(railState()).toBe('compact')
    expect(mockRouterReplace).not.toHaveBeenCalled()

    await swipeHorizontal(scrollArea.element, 13, 108, 2)
    expect(railState()).toBe('expanded')
    expect(mockRouterReplace).not.toHaveBeenCalled()

    await swipeHorizontal(scrollArea.element, 108, 13, 3)
    expect(railState()).toBe('compact')
    expect(mockRouterReplace).not.toHaveBeenCalled()

    await swipeHorizontal(scrollArea.element, 108, 13, 4)
    expect(railState()).toBe('hidden')
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })

  it('[P1] keeps workspace swipes blocked on protected interactive targets and swipe-reveal rows', async () => {
    mockMatchMedia({ touch: true, mobile: true })

    const wrapper = await mountFolderPage()
    const railState = () => wrapper.get('[data-testid="folder-shell-rail-state"]').attributes('data-rail-state')

    await swipeHorizontal(wrapper.get('[data-testid="chat-input-control"]').element, 13, 108)
    expect(railState()).toBe('hidden')

    await swipeHorizontal(wrapper.get('[data-testid="swipe-reveal-row"]').element, 13, 108, 2)
    expect(railState()).toBe('hidden')
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })
})
