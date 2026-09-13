<script setup lang="ts">
import { FileText, ArrowLeftRight } from '@lucide/vue'
import type { Id } from '~~/convex/_generated/dataModel'
import type { InterjectionContext, Source } from '~/composables/useChat'
import FolderTasksPane from '~/components/folders/FolderTasksPane.vue'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const props = defineProps<{
  messages: Array<{ role: 'user' | 'assistant'; content: string; sources?: Source[]; interjectionContext?: InterjectionContext }>
  loading: boolean
  streaming: boolean
  thinking: boolean
  error: string | null
  hasIndexedDocuments: boolean
  selectedModel: string
  interjectionInFlight: boolean
  conversationId?: Id<'conversations'> | null
}>()

const emit = defineEmits<{
  send: [query: string]
  selectModel: [model: string]
  citationClick: [messageIndex: number, citationIndex: number]
  viewAllReferences: [messageIndex: number]
  interjectionBadgeClick: [ctx: InterjectionContext]
  podcastAsk: [ctx: InterjectionContext]
  podcastAskSubmit: [payload: { question: string; context: InterjectionContext }]
  taskViewRoom: [roomId: string]
}>()

const route = useRoute()
const ctx = injectFolderContext()
const {
  folderId, folder, referenceScope, helperPane, isDesktop,
  isPodcastMain: isPodcastMainFolder, audioOverviewShellRef,
  attachmentStatus, uploading, importingLink,
  handleUpload, handleImportLink,
} = ctx

const isChatIndex = computed(() => !route.params.conversationId)
const isPodcastMain = computed(() => isPodcastMainFolder.value && isChatIndex.value)

const chatInputRef = ref<{ focus: () => void } | null>(null)
const chatScrollRef = ref<HTMLElement | null>(null)
const pendingInterjectionContext = ref<InterjectionContext | null>(null)

const sourcePanelOpen = computed({
  get: () => helperPane.activeTabId.value === 'sources',
  set: (v: boolean) => {
    if (v) helperPane.open('sources')
    else helperPane.close()
  },
})
const sourcePanelSide = ref<'left' | 'right'>('right')
const isSourcePanelLeading = computed(() => sourcePanelSide.value === 'left')
const flipPanelAriaLabel = computed(() =>
  isSourcePanelLeading.value ? 'Move sources panel to the right' : 'Move sources panel to the left',
)
const activeCitationIndex = ref<number | null>(null)
const activeMessageIndex = ref<number | null>(null)

const SOURCE_PANEL_SIDE_KEY = 'g4.chat.source-panel.side'
const PANEL_FLIP_DRAG_THRESHOLD = 4
const panelFlipPointerStart = ref<{ x: number; y: number } | null>(null)
const suppressNextPanelFlipClick = ref(false)

const allSources = computed(() => {
  if (activeMessageIndex.value === null) return []
  const msg = props.messages[activeMessageIndex.value]
  return msg?.sources ?? []
})

function handleCitationClick(messageIndex: number, citationIndex: number) {
  activeMessageIndex.value = messageIndex
  activeCitationIndex.value = citationIndex - 1
  sourcePanelOpen.value = true
}

function handleViewAllReferences(messageIndex: number) {
  activeMessageIndex.value = messageIndex
  activeCitationIndex.value = null
  sourcePanelOpen.value = true
}

function toggleSourcePanelSide() {
  sourcePanelSide.value = sourcePanelSide.value === 'left' ? 'right' : 'left'
}

function handlePanelFlipPointerDown(event: PointerEvent) {
  panelFlipPointerStart.value = { x: event.clientX, y: event.clientY }
  suppressNextPanelFlipClick.value = false
}

function handlePanelFlipPointerMove(event: PointerEvent) {
  const start = panelFlipPointerStart.value
  if (!start) return
  if (Math.abs(event.clientX - start.x) > PANEL_FLIP_DRAG_THRESHOLD || Math.abs(event.clientY - start.y) > PANEL_FLIP_DRAG_THRESHOLD) {
    suppressNextPanelFlipClick.value = true
  }
}

function handlePanelFlipPointerEnd() {
  panelFlipPointerStart.value = null
}

function handlePanelFlipClick() {
  if (suppressNextPanelFlipClick.value) { suppressNextPanelFlipClick.value = false; return }
  toggleSourcePanelSide()
}

async function handleSendMessage(query: string) {
  activeMessageIndex.value = null
  activeCitationIndex.value = null
  const ctx = pendingInterjectionContext.value ?? undefined
  pendingInterjectionContext.value = null
  if (ctx) emit('podcastAskSubmit', { question: query, context: ctx })
  else emit('send', query)
}

function handlePodcastAsk(context: InterjectionContext) {
  pendingInterjectionContext.value = context
  chatInputRef.value?.focus()
}

function formatInterjectionBadgeTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function handleInterjectionBadgeClick(intCtx: InterjectionContext) {
  emit('interjectionBadgeClick', intCtx)
}

function handleTaskViewRoom(roomId: string) {
  emit('taskViewRoom', roomId)
}

watch(() => props.messages.length, () => {
  nextTick(() => {
    chatScrollRef.value?.scrollTo({ top: chatScrollRef.value.scrollHeight, behavior: 'smooth' })
  })
})

watch(
  () => props.messages[props.messages.length - 1]?.content.length,
  () => {
    if (props.streaming) {
      nextTick(() => {
        chatScrollRef.value?.scrollTo({ top: chatScrollRef.value.scrollHeight, behavior: 'auto' })
      })
    }
  },
)

onMounted(() => {
  try {
    const stored = localStorage.getItem(SOURCE_PANEL_SIDE_KEY)
    if (stored === 'left' || stored === 'right') sourcePanelSide.value = stored
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  document.addEventListener('pointermove', handlePanelFlipPointerMove)
  document.addEventListener('pointerup', handlePanelFlipPointerEnd)
  document.addEventListener('pointercancel', handlePanelFlipPointerEnd)
})

onUnmounted(() => {
  document.removeEventListener('pointermove', handlePanelFlipPointerMove)
  document.removeEventListener('pointerup', handlePanelFlipPointerEnd)
  document.removeEventListener('pointercancel', handlePanelFlipPointerEnd)
})

watch(sourcePanelSide, (value) => {
  try {
    localStorage.setItem(SOURCE_PANEL_SIDE_KEY, value)
  } catch {
    // Panel placement remains usable for the current session.
  }
})

defineExpose({ focus: () => chatInputRef.value?.focus() })
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div v-if="isPodcastMain && !isDesktop" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AudioOverviewShell
        ref="audioOverviewShellRef"
        :folder-id="folderId"
        :conversation-id="props.conversationId ?? undefined"
        :scope="referenceScope"
        :interjection-in-flight="interjectionInFlight"
        @podcast-ask="handlePodcastAsk"
        @podcast-ask-submit="(p) => emit('podcastAskSubmit', p)"
      />
    </div>

    <div v-else-if="isPodcastMain && isDesktop" class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ResizablePanelGroup direction="horizontal" class="min-w-0 flex-1">
        <ResizablePanel :default-size="72" :min-size="40" class="min-h-0 min-w-0">
          <AudioOverviewShell
            ref="audioOverviewShellRef"
            :folder-id="folderId"
            :conversation-id="props.conversationId ?? undefined"
            :scope="referenceScope"
            :interjection-in-flight="interjectionInFlight"
            @generation-started="() => { if (isDesktop) helperPane.open('podcast') }"
            @podcast-ask="handlePodcastAsk"
            @podcast-ask-submit="(p) => emit('podcastAskSubmit', p)"
          />
        </ResizablePanel>
        <ResizableHandle with-handle>
          <button type="button" data-testid="source-panel-flip" :aria-label="flipPanelAriaLabel" class="inline-flex h-6 w-6 items-center justify-center rounded border bg-background text-foreground shadow-sm transition-all hover:bg-accent hover:shadow-[0_0_8px_rgba(215,165,51,0.3)]" @pointerdown="handlePanelFlipPointerDown" @click.stop="handlePanelFlipClick">
            <ArrowLeftRight class="h-3.5 w-3.5" />
          </button>
        </ResizableHandle>
        <ResizablePanel :default-size="28" :min-size="20" :max-size="45" class="min-w-[18rem]">
          <template v-if="helperPane.isOpen.value">
            <FolderShellHelperPane>
              <template #default="{ activeTabId: tid }">
                <ChatSourcePanel v-if="tid === 'sources'" :sources="allSources" :active-citation-index="activeCitationIndex" :open="true" side="right" class="min-h-0 flex-1" @close="helperPane.close()" />
                <FolderTasksPane v-else-if="tid === 'tasks'" :folder-id="folderId" embedded @close="helperPane.close()" @view-room="handleTaskViewRoom" />
              </template>
            </FolderShellHelperPane>
          </template>
          <div v-else class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <template v-if="!hasIndexedDocuments">
              <div class="flex flex-1 items-center justify-center text-muted-foreground">
                <div class="text-center">
                  <FileText class="mx-auto mb-3 h-12 w-12 opacity-40 animate-float-idle" />
                  <p class="text-lg font-medium">Upload documents to start chatting</p>
                </div>
              </div>
            </template>
            <template v-else>
              <div ref="chatScrollRef" data-testid="chat-scroll-area" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" class="keyboard-scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <template v-for="(msg, i) in messages" :key="i">
                  <button
                    v-if="msg.interjectionContext && msg.role === 'user'"
                    type="button"
                    data-testid="chat-interjection-badge"
                    class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-inter text-[11px] text-primary transition-colors hover:bg-primary/20"
                    @click="handleInterjectionBadgeClick(msg.interjectionContext!)"
                  >
                    🎙 Asked while listening @ {{ formatInterjectionBadgeTime(msg.interjectionContext.timeMs) }} · "{{ msg.interjectionContext.quotedText.slice(0, 40) }}{{ msg.interjectionContext.quotedText.length > 40 ? '…' : '' }}"
                  </button>
                  <ChatMessage
                    :role="msg.role"
                    :content="msg.content"
                    :sources="msg.sources"
                    :streaming="streaming && i === messages.length - 1"
                    @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                    @citation-long-press="(citIndex: number) => handleCitationClick(i, citIndex)"
                  />
                  <ChatReferenceChips
                    v-if="msg.role === 'assistant' && (msg.sources?.length ?? 0) > 0"
                    :sources="msg.sources ?? []"
                    @view-all="handleViewAllReferences(i)"
                    @chip-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                  />
                </template>
                <ChatThinkingRow v-if="thinking" :model="selectedModel" />
                <div v-if="error" class="text-center text-sm text-destructive">{{ error }}</div>
              </div>
            </template>
            <div data-testid="chat-composer-footer" class="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div class="flex items-center px-4 pt-2">
                <ChatModelSelector :model-value="selectedModel" :disabled="loading" @update:model-value="(m) => emit('selectModel', m)" />
              </div>
              <ChatInput
                ref="chatInputRef"
                :disabled="!hasIndexedDocuments || loading"
                :attachment-status="attachmentStatus"
                :busy="uploading || importingLink"
                :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
                :folder-id="folderId"
                :scope="referenceScope"
                :interjection-context="pendingInterjectionContext"
                @upload-files="handleUpload"
                @import-link="handleImportLink"
                @submit="handleSendMessage"
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>

    <div v-else class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <template v-if="isDesktop && helperPane.isOpen.value">
        <ResizablePanelGroup direction="horizontal" class="min-w-0 flex-1">
          <template v-if="isSourcePanelLeading">
            <ResizablePanel :default-size="28" :min-size="20" :max-size="45" class="min-w-[18rem]">
              <FolderShellHelperPane>
                <template #default="{ activeTabId: tid }">
                  <AudioOverviewShell v-if="tid === 'podcast'" :folder-id="folderId" :conversation-id="props.conversationId ?? undefined" :scope="referenceScope" :interjection-in-flight="interjectionInFlight" @podcast-ask="handlePodcastAsk" @podcast-ask-submit="(p) => emit('podcastAskSubmit', p)" />
                  <ChatSourcePanel v-else-if="tid === 'sources'" :sources="allSources" :active-citation-index="activeCitationIndex" :open="true" side="left" class="min-h-0 flex-1" @close="helperPane.close()" />
                  <FolderTasksPane v-else-if="tid === 'tasks'" :folder-id="folderId" embedded @close="helperPane.close()" @view-room="handleTaskViewRoom" />
                </template>
              </FolderShellHelperPane>
            </ResizablePanel>
            <ResizableHandle with-handle>
              <button type="button" data-testid="source-panel-flip" :aria-label="flipPanelAriaLabel" class="inline-flex h-6 w-6 items-center justify-center rounded border bg-background text-foreground shadow-sm transition-all hover:bg-accent hover:shadow-[0_0_8px_rgba(215,165,51,0.3)]" @pointerdown="handlePanelFlipPointerDown" @click.stop="handlePanelFlipClick">
                <ArrowLeftRight class="h-3.5 w-3.5" />
              </button>
            </ResizableHandle>
          </template>

          <ResizablePanel :default-size="72" :min-size="40" class="min-h-0 min-w-0">
            <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <template v-if="!hasIndexedDocuments">
                <div class="flex flex-1 items-center justify-center text-muted-foreground">
                  <div class="text-center">
                    <FileText class="mx-auto mb-3 h-12 w-12 opacity-40 animate-float-idle" />
                    <p class="text-lg font-medium">Upload documents to start chatting</p>
                  </div>
                </div>
              </template>
              <template v-else>
                <div ref="chatScrollRef" data-testid="chat-scroll-area" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" class="keyboard-scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  <template v-for="(msg, i) in messages" :key="i">
                    <button
                      v-if="msg.interjectionContext && msg.role === 'user'"
                      type="button"
                      data-testid="chat-interjection-badge"
                      class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-inter text-[11px] text-primary transition-colors hover:bg-primary/20"
                      @click="handleInterjectionBadgeClick(msg.interjectionContext!)"
                    >
                      🎙 Asked while listening @ {{ formatInterjectionBadgeTime(msg.interjectionContext.timeMs) }} · "{{ msg.interjectionContext.quotedText.slice(0, 40) }}{{ msg.interjectionContext.quotedText.length > 40 ? '…' : '' }}"
                    </button>
                    <ChatMessage
                      :role="msg.role"
                      :content="msg.content"
                      :sources="msg.sources"
                      :streaming="streaming && i === messages.length - 1"
                      @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                      @citation-long-press="(citIndex: number) => handleCitationClick(i, citIndex)"
                    />
                    <ChatReferenceChips
                      v-if="msg.role === 'assistant' && (msg.sources?.length ?? 0) > 0"
                      :sources="msg.sources ?? []"
                      @view-all="handleViewAllReferences(i)"
                      @chip-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                    />
                  </template>
                  <ChatThinkingRow v-if="thinking" :model="selectedModel" />
                  <div v-if="error" class="text-center text-sm text-destructive">{{ error }}</div>
                </div>
              </template>
              <div data-testid="chat-composer-footer" class="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <div class="flex items-center px-4 pt-2">
                  <ChatModelSelector :model-value="selectedModel" :disabled="loading" @update:model-value="(m) => emit('selectModel', m)" />
                </div>
                <ChatInput
                  ref="chatInputRef"
                  :disabled="!hasIndexedDocuments || loading"
                  :attachment-status="attachmentStatus"
                  :busy="uploading || importingLink"
                  :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
                  :folder-id="folderId"
                  :scope="referenceScope"
                  :interjection-context="pendingInterjectionContext"
                  @upload-files="handleUpload"
                  @import-link="handleImportLink"
                  @submit="handleSendMessage"
                />
              </div>
            </div>
          </ResizablePanel>

          <template v-if="!isSourcePanelLeading">
            <ResizableHandle with-handle>
              <button type="button" data-testid="source-panel-flip" :aria-label="flipPanelAriaLabel" class="inline-flex h-6 w-6 items-center justify-center rounded border bg-background text-foreground shadow-sm transition-all hover:bg-accent hover:shadow-[0_0_8px_rgba(215,165,51,0.3)]" @pointerdown="handlePanelFlipPointerDown" @click.stop="handlePanelFlipClick">
                <ArrowLeftRight class="h-3.5 w-3.5" />
              </button>
            </ResizableHandle>
            <ResizablePanel :default-size="28" :min-size="20" :max-size="45" class="min-w-[18rem]">
              <FolderShellHelperPane>
                <template #default="{ activeTabId: tid }">
                  <AudioOverviewShell v-if="tid === 'podcast'" :folder-id="folderId" :conversation-id="props.conversationId ?? undefined" :scope="referenceScope" :interjection-in-flight="interjectionInFlight" @podcast-ask="handlePodcastAsk" @podcast-ask-submit="(p) => emit('podcastAskSubmit', p)" />
                  <ChatSourcePanel v-else-if="tid === 'sources'" :sources="allSources" :active-citation-index="activeCitationIndex" :open="true" side="right" class="min-h-0 flex-1" @close="helperPane.close()" />
                  <FolderTasksPane v-else-if="tid === 'tasks'" :folder-id="folderId" embedded @close="helperPane.close()" @view-room="handleTaskViewRoom" />
                </template>
              </FolderShellHelperPane>
            </ResizablePanel>
          </template>
        </ResizablePanelGroup>
      </template>

      <div v-else class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <template v-if="!hasIndexedDocuments">
          <div class="flex flex-1 items-center justify-center text-muted-foreground">
            <div class="text-center">
              <FileText class="mx-auto mb-3 h-12 w-12 opacity-40 animate-float-idle" />
              <p class="text-lg font-medium">Upload documents to start chatting</p>
            </div>
          </div>
        </template>
        <template v-else>
          <div ref="chatScrollRef" data-testid="chat-scroll-area" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" class="keyboard-scroll-area min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <template v-for="(msg, i) in messages" :key="i">
              <button
                v-if="msg.interjectionContext && msg.role === 'user'"
                type="button"
                data-testid="chat-interjection-badge"
                class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-inter text-[11px] text-primary transition-colors hover:bg-primary/20"
                @click="handleInterjectionBadgeClick(msg.interjectionContext!)"
              >
                🎙 Asked while listening @ {{ formatInterjectionBadgeTime(msg.interjectionContext.timeMs) }} · "{{ msg.interjectionContext.quotedText.slice(0, 40) }}{{ msg.interjectionContext.quotedText.length > 40 ? '…' : '' }}"
              </button>
              <ChatMessage
                :role="msg.role"
                :content="msg.content"
                :sources="msg.sources"
                :streaming="streaming && i === messages.length - 1"
                @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                @citation-long-press="(citIndex: number) => handleCitationClick(i, citIndex)"
              />
              <ChatReferenceChips
                v-if="msg.role === 'assistant' && (msg.sources?.length ?? 0) > 0"
                :sources="msg.sources ?? []"
                @view-all="handleViewAllReferences(i)"
                @chip-click="(citIndex: number) => handleCitationClick(i, citIndex)"
              />
            </template>
            <ChatThinkingRow v-if="thinking" :model="selectedModel" />
            <div v-if="error" class="text-center text-sm text-destructive">{{ error }}</div>
          </div>
        </template>
        <div data-testid="chat-composer-footer" class="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div class="flex items-center px-4 pt-2">
            <ChatModelSelector :model-value="selectedModel" :disabled="loading" @update:model-value="(m) => emit('selectModel', m)" />
          </div>
          <ChatInput
            ref="chatInputRef"
            :disabled="!hasIndexedDocuments || loading"
            :attachment-status="attachmentStatus"
            :busy="uploading || importingLink"
            :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
            :folder-id="folderId"
            :scope="referenceScope"
            :interjection-context="pendingInterjectionContext"
            @upload-files="handleUpload"
            @import-link="handleImportLink"
            @submit="handleSendMessage"
          />
        </div>
      </div>
    </div>
  </div>
</template>
